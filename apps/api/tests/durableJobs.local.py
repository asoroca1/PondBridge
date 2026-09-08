# Local Docker only. Creates and finally removes its own synthetic database.
import subprocess,pathlib,secrets,concurrent.futures,json
name='pb_queue_review_'+secrets.token_hex(8)
container='supabase_db_pondbridge-local-staging'
def q(sql,db=name,okay=True):
 r=subprocess.run(['docker','exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,timeout=30)
 if okay and r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip() if okay else r
checks=[]
q('CREATE DATABASE '+name+' TEMPLATE template0','postgres')
try:
 q("CREATE EXTENSION pgcrypto; CREATE TABLE tenants(id text PRIMARY KEY); CREATE TABLE users(id text PRIMARY KEY,tenant_id text,status text,roles text[]); INSERT INTO tenants VALUES('camp-a'),('camp-b'); INSERT INTO users VALUES('admin-a','camp-a','active',ARRAY['tenant_admin']),('member-a','camp-a','active',ARRAY['user']);")
 q((pathlib.Path(__file__).resolve().parents[3] / 'supabase/migrations/20260908220000_durable_tenant_jobs.sql').read_text())
 for role in ['anon','authenticated']:
  denied=q('SET ROLE '+role+'; SELECT public.claim_tenant_job();',okay=False)
  assert denied.returncode and 'permission denied' in denied.stderr
  assert q("SELECT has_table_privilege('"+role+"','public.tenant_background_jobs','SELECT')")=='f'
 checks.append('anon/authenticated denied table reads and RPC execution')
 for actor,tenant in [('admin-a','camp-b'),('member-a','camp-a')]:
  r=q(f"SELECT public.enqueue_tenant_job('{tenant}','{actor}','broadcast','request-test','fingerprint','{{}}',40);",okay=False)
  assert r.returncode and 'not authorized' in r.stderr
 checks.append('cross-tenant actor and nonadmin enqueue rejected')
 job=q("SELECT (public.enqueue_tenant_job('camp-a','admin-a','broadcast','request-test','fingerprint','{}',40)).id")
 assert q("SELECT (public.enqueue_tenant_job('camp-a','admin-a','broadcast','request-test','fingerprint','{}',40)).id")==job
 assert q("SELECT count(*) FROM tenant_background_jobs")=='1'
 r=q("SELECT public.enqueue_tenant_job('camp-a','admin-a','broadcast','request-test','changed','{}',40)",okay=False)
 assert r.returncode and 'different work' in r.stderr
 checks.append('same key returns same row; changed fingerprint rejected')
 q("SELECT public.enqueue_tenant_job('camp-a','admin-a','broadcast','request-two','fingerprint','{}',40)")
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  claims=list(pool.map(lambda _:q('SELECT id FROM public.claim_tenant_job()'),range(2)))
 assert len([v for v in claims if v])==1,claims
 leased=[v for v in claims if v][0]
 token=q("SELECT lease_token FROM tenant_background_jobs WHERE id='"+leased+"'")
 checks.append('two concurrent replicas obtain exactly one globally throttled lease')
 assert q(f"SELECT public.checkpoint_tenant_job('camp-b','{leased}','{token}',1,'{{}}')")=='f'
 assert q(f"SELECT public.checkpoint_tenant_job('camp-a','{leased}','00000000-0000-0000-0000-000000000000',1,'{{}}')")=='f'
 assert q(f"SELECT public.checkpoint_tenant_job('camp-a','{leased}','{token}',2,'{{}}')")=='t'
 assert q(f"SELECT public.checkpoint_tenant_job('camp-a','{leased}','{token}',1,'{{}}')")=='f'
 q(f"UPDATE tenant_background_jobs SET lease_until=now()-interval '1 second' WHERE id='{leased}'")
 assert q(f"SELECT public.checkpoint_tenant_job('camp-a','{leased}','{token}',3,'{{}}')")=='f'
 assert q(f"SELECT public.heartbeat_tenant_job('camp-a','{leased}','{token}')")=='f'
 checks.append('wrong tenant, wrong/stale lease and cursor rollback checkpoints denied')
 q(f"UPDATE tenant_background_jobs SET lease_until=now()+interval '90 seconds' WHERE id='{leased}'")
 assert q(f"SELECT public.checkpoint_tenant_job('camp-a','{leased}','{token}',40,'{{\"accepted\":10}}',false,'PERMANENT:BROADCAST_PARTIAL_ACCEPTANCE_REVIEW_REQUIRED')")=='t'
 assert q(f"SELECT status||':'||cursor FROM tenant_background_jobs WHERE id='{leased}'")=='failed:40'
 q("UPDATE tenant_job_dispatch_clock SET last_claim_at='-infinity'")
 assert q('SELECT id FROM public.claim_tenant_job()') != leased
 checks.append('partial acceptance atomically stores terminal failure and cannot be reclaimed')
 q("UPDATE tenant_background_jobs SET expires_at=now()-interval '1 second',payload='{\"synthetic\":true}',state='{\"prepared\":{\"synthetic\":true}}'")
 q('SELECT public.claim_tenant_job()')
 assert q("SELECT count(*) FROM tenant_background_jobs WHERE status='failed' AND payload='{}' AND NOT state ? 'prepared'")=='2'
 checks.append('expiry fails pending work and removes payload/prepared recipients')
 print(json.dumps({'checks':checks,'passed':len(checks)},indent=2))
finally:
 q('DROP DATABASE '+name+' WITH (FORCE)','postgres')
