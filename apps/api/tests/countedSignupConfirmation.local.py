"""Real-schema, synthetic-only counted cohort rehearsal in a NEW disposable DB."""
import concurrent.futures
import json
import pathlib
import secrets
import subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3]
CONTAINER='supabase_db_pondbridge-local-staging'
DATABASE='pb_counted_'+secrets.token_hex(8)
def command(args,data=None):
 r=subprocess.run(['docker','exec','-i',CONTAINER]+args,input=data,text=True,capture_output=True,timeout=60)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
def query(sql,database=DATABASE):
 return command(['psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1'],sql)
def js(value): return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def admit(name,clerk=None,email=None):
 return json.loads(query(f"SELECT admit_counted_signup_account('g','{name}','{clerk or 'user_'+name}','{email or name+'@synthetic.invalid'}')"))
def confirm(name,agreement):
 uid=query(f"SELECT user_id FROM counted_signup_admissions WHERE request_id='{name}'")
 return json.loads(query(f"SELECT confirm_counted_signup_account('g','{uid}','user_{name}','{name}@synthetic.invalid',{js(agreement)})"))
def create(name,tenant='g'):
 query(f"""INSERT INTO access_requests(id,tenant_id,email,first_name,last_name,password_hash,status,recovered_clerk_user_id,profile_payload)
 VALUES('{name}','{tenant}','{name}@synthetic.invalid','Real','Name','clerk_managed','pending','user_{name}',
 jsonb_build_object('firstName','Real','lastName','Name','socials',jsonb_build_object('signupRecovery',
 jsonb_build_object('clerkUserId','user_{name}','source','operator_repair','requiresConsent',true))));""")
 if tenant=='g': query(f"SELECT preapprove_recovered_signup_review('g','{name}','director')")
def normal_consent(name,agreement):
 payload={'firstName':'Real','lastName':'Name','socials':{'legalAgreement':{k:v for k,v in agreement.items() if k!='version'}}}
 return json.loads(query(f"SELECT submit_recovered_signup_consent('g','{name}','user_{name}','{name}@synthetic.invalid',{js(payload)},'Real','Name','','')"))
schema=command(['pg_dump','-U','supabase_admin','-d','postgres','--schema-only','--no-owner'])
query('CREATE DATABASE '+DATABASE+' TEMPLATE template0','postgres')
try:
 query(schema)
 for filename in ['20260908220000_durable_tenant_jobs.sql','20260909010000_verified_signup_review_reconciliation.sql',
 '20260909020000_durable_access_approval_email.sql','20260909030000_recovered_signup_director_preapproval.sql',
 '20260909040000_durable_signup_consent_receipts.sql','20260909050000_counted_signup_confirmation.sql']:
  query((ROOT/'supabase/migrations'/filename).read_text())
 query("INSERT INTO tenants(id,name,slug) VALUES('g','Synthetic Green','greenlane'),('c','Synthetic Cedar','cedar'); INSERT INTO users(id,tenant_id,email,password_hash,roles) VALUES('director','g','director@synthetic.invalid','synthetic',ARRAY['tenant_admin'])")
 agreement=dict(version=1,accepted=True,ageEligibilityConfirmed=True,termsVersion='2026-03-04',privacyVersion='2026-03-04',agePolicyVersion='2026-07-14',minimumAge=14,
 acceptedAt=query("SELECT to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"))
 names=['happy','duplicate','denied','removed','deleted','memberrevoked','race','outbox','already','declined','denialrace']
 for name in names: create(name)
 create('outside'); create('cedar','c')
 manifest=json.loads(query("SELECT jsonb_agg(jsonb_build_object('requestId',id,'clerkUserId',recovered_clerk_user_id,'email',email,'directorApprovedAt',director_approved_at,'directorApprovedByUserId',director_approved_by_user_id) ORDER BY id) FROM access_requests WHERE id NOT IN ('outside','cedar')"))
 # Two snapshot entries change before registration. They are skipped, not re-gated.
 normal_consent('already',agreement);query("UPDATE access_requests SET status='denied' WHERE id='declined'")
 for key in ['requestId','clerkUserId','email']:
  duplicate_manifest=[dict(manifest[0]),dict(manifest[1])];duplicate_manifest[1][key]=duplicate_manifest[0][key]
  try: query("SELECT register_counted_signup_cohort('g',"+js(duplicate_manifest)+")");raise AssertionError('Duplicate cohort identity accepted')
  except RuntimeError: pass
  assert query('SELECT count(*) FROM counted_signup_manifest')=='0'
 registered=json.loads(query("SELECT register_counted_signup_cohort('g',"+js(manifest)+")"))
 assert registered['registered']==9 and registered['skippedChanged']==2
 assert json.loads(query("SELECT register_counted_signup_cohort('g',"+js(manifest)+")"))['outcome']=='already_registered'
 try: query("SELECT register_counted_signup_cohort('g',"+js(manifest[:-1])+")");raise AssertionError('Expanded/changed manifest accepted')
 except RuntimeError as e: assert 'already sealed' in str(e)
 assert not admit('outside')['ok'];assert not admit('happy',clerk='user_else')['ok'];assert not admit('happy',email='else@synthetic.invalid')['ok']
 baseline=int(query("SELECT count(*) FROM profiles WHERE tenant_id='g' AND status='active'"))
 admitted=admit('happy');assert admitted['outcome']=='admitted'
 assert query("SELECT status='active' AND account_confirmation_request_id='happy' AND last_login_at IS NULL FROM users WHERE id='"+admitted['userId']+"'")=='t'
 assert query("SELECT status='active' AND socials->'legalAgreement' IS NULL AND socials->'signupRecovery' IS NULL FROM profiles WHERE user_id='"+admitted['userId']+"'")=='t'
 assert query("SELECT count(*) FROM tenant_background_jobs WHERE idempotency_key='access-approval/happy'")=='0'
 assert query("SELECT status='pending' AND director_approved_at IS NOT NULL FROM access_requests WHERE id='happy'")=='t'
 assert int(query("SELECT count(*) FROM profiles WHERE tenant_id='g' AND status='active'"))==baseline+1
 assert admit('happy')['outcome']=='already_admitted'
 assert int(query("SELECT count(*) FROM profiles WHERE tenant_id='g' AND status='active'"))==baseline+1
 assert not confirm('happy',{k:v for k,v in agreement.items() if k!='version'})['ok']
 for patch in [{'version':2},{'accepted':False},{'accepted':'true'},{'minimumAge':13},{'termsVersion':'old'},{'acceptedAt':'2099-01-01T00:00:00Z'}]:
  assert not confirm('happy',{**agreement,**patch})['ok']
 assert confirm('happy',agreement)['ok']
 assert confirm('happy',agreement)['alreadyConfirmed']
 assert query("SELECT account_confirmation_request_id IS NULL FROM users WHERE id='"+admitted['userId']+"'")=='t'
 assert query("SELECT count(*) FROM tenant_background_jobs WHERE idempotency_key='access-approval/happy'")=='1'
 assert query("SELECT count(*) FROM counted_signup_confirmation_receipts WHERE request_id='happy'")=='1'
 # Admission/normal consent use the same lock order and cannot duplicate or stick.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  tasks=[pool.submit(admit,'race'),pool.submit(normal_consent,'race',agreement)]
  [t.result() for t in tasks]
 assert query("SELECT status FROM access_requests WHERE id='race'")=='approved'
 assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_race'")=='1'
 assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_race' AND account_confirmation_request_id IS NOT NULL")=='0'
 # A concurrent director denial and real confirmation have one final winner.
 admit('denialrace')
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
  tasks=[pool.submit(confirm,'denialrace',agreement),pool.submit(query,"UPDATE access_requests SET status='denied' WHERE id='denialrace' AND status='pending'")]
  [t.result() for t in tasks]
 final=query("SELECT status FROM access_requests WHERE id='denialrace'")
 assert final in ['approved','denied']
 assert query("SELECT status FROM users WHERE clerk_user_id='user_denialrace'")==('active' if final=='approved' else 'inactive')
 assert query("SELECT count(*) FROM tenant_background_jobs WHERE idempotency_key='access-approval/denialrace'")==('1' if final=='approved' else '0')
 # Concurrent duplicate admissions and confirmations remain exactly-once.
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(lambda _:admit('duplicate'),range(2)))
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: list(pool.map(lambda _:confirm('duplicate',agreement),range(2)))
 assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_duplicate'")=='1'
 assert query("SELECT count(*) FROM counted_signup_confirmation_receipts WHERE request_id='duplicate'")=='1'
 for name in ['denied','removed','deleted','memberrevoked','outbox']: admit(name)
 before_denial=int(query("SELECT count(*) FROM profiles WHERE tenant_id='g' AND status='active'"))
 query("UPDATE access_requests SET status='denied' WHERE id='denied'")
 assert int(query("SELECT count(*) FROM profiles WHERE tenant_id='g' AND status='active'"))==before_denial-1
 assert not confirm('denied',agreement)['ok']
 assert query("SELECT status FROM users WHERE clerk_user_id='user_denied'")=='inactive'
 query("UPDATE users SET status='inactive' WHERE clerk_user_id='user_removed'; UPDATE profiles SET status='removed' WHERE user_id=(SELECT id FROM users WHERE clerk_user_id='user_removed')")
 assert not confirm('removed',agreement)['ok'];assert not normal_consent('removed',agreement)['ok']
 query("UPDATE tenant_memberships SET status='inactive' WHERE legacy_user_id=(SELECT id FROM users WHERE clerk_user_id='user_memberrevoked')")
 assert not confirm('memberrevoked',agreement)['ok']
 # Deletion cannot make old pending preapproval resurrect a second account.
 query("DELETE FROM profiles WHERE user_id=(SELECT id FROM users WHERE clerk_user_id='user_deleted'); DELETE FROM tenant_memberships WHERE legacy_user_id=(SELECT id FROM users WHERE clerk_user_id='user_deleted'); DELETE FROM users WHERE clerk_user_id='user_deleted'")
 assert not normal_consent('deleted',agreement)['ok']; assert not admit('deleted')['ok']
 assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_deleted'")=='0'
 query("CREATE FUNCTION fail_counted_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key='access-approval/outbox' THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_counted_outbox BEFORE INSERT ON tenant_background_jobs FOR EACH ROW EXECUTE FUNCTION fail_counted_outbox()")
 try: confirm('outbox',agreement);raise AssertionError('Outbox failure did not roll back')
 except RuntimeError as e: assert 'synthetic outbox failure' in str(e)
 assert query("SELECT count(*) FROM counted_signup_confirmation_receipts WHERE request_id='outbox'")=='0'
 assert query("SELECT account_confirmation_request_id FROM users WHERE clerk_user_id='user_outbox'")=='outbox'
 for table in ['counted_signup_manifest','counted_signup_cohort','counted_signup_admissions','counted_signup_confirmation_receipts']:
  assert query(f"SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='{table}'::regclass")=='t'
  for role in ['anon','authenticated','service_role']:
   for permission in ['INSERT','UPDATE','DELETE']:assert query(f"SELECT has_table_privilege('{role}','{table}','{permission}')")=='f'
 for fn in ['register_counted_signup_cohort(text,jsonb)','admit_counted_signup_account(text,text,text,text)','confirm_counted_signup_account(text,text,text,text,jsonb)']:
  for role in ['anon','authenticated']: assert query(f"SELECT has_function_privilege('{role}','{fn}','EXECUTE')")=='f'
  assert query(f"SELECT has_function_privilege('service_role','{fn}','EXECUTE')")=='t'
 assert query("SELECT has_function_privilege('service_role','revoke_counted_signup_on_denial()','EXECUTE')")=='f'
 print('PASS: exact sealed cohort; changed snapshot skip; no fake consent/activity; active counted profiles; no admission email; atomic/idempotent real consent; admission/consent races; denial/removal/deletion cannot resurrect; outbox rollback; forced RLS/service-only immutable storage')
finally: query('DROP DATABASE '+DATABASE+' WITH (FORCE)','postgres')
