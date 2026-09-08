"""Real-schema recovery tests in a NEW disposable local DB; no hosted access."""
import concurrent.futures
import pathlib
import secrets
import subprocess

CONTAINER = 'supabase_db_pondbridge-local-staging'
DATABASE = 'pb_signup_review_' + secrets.token_hex(8)
ROOT = pathlib.Path(__file__).resolve().parents[3]


def command(args, data=None):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER] + args,
                            input=data, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def query(sql, database=DATABASE):
    return command(['psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database,
                    '-v', 'ON_ERROR_STOP=1'], sql)


def reconcile(email='new@recovery.invalid', apply=False, tenant='gl', clerk_id=None):
    clerk_id = clerk_id or 'user_' + email.split('@')[0].replace('-', '')
    return query(f"SELECT outcome FROM public.reconcile_verified_signup_review('{tenant}',"
                 f"'{clerk_id}','{email}','Real','Name','operator_repair',{str(apply).lower()});")


schema = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--no-owner'])
query('CREATE DATABASE ' + DATABASE + ' TEMPLATE template0', 'postgres')
try:
    query(schema)
    query((ROOT / 'supabase/migrations/20260909010000_verified_signup_review_reconciliation.sql').read_text())
    query("""INSERT INTO tenants(id,name,slug,settings) VALUES
      ('gl','Synthetic Green Lane','greenlane','{"signupMode":"open","requireSignupApproval":true}'),
      ('cedar','Synthetic Cedar','cedar','{"signupMode":"open","requireSignupApproval":true}');
      INSERT INTO feature_rollouts(feature_key,state,kill_switch,tenant_ids)
      VALUES('verified_signup_review_reconciliation_v1','pilot',false,ARRAY['gl']);""")
    assert reconcile() == 'would_create'
    assert query('SELECT count(*) FROM access_requests') == '0', 'Dry-run wrote a request'
    assert reconcile(tenant='cedar') == 'disabled'
    assert reconcile(apply=True) == 'created'
    assert reconcile(apply=True) == 'existing_request'
    assert query("SELECT profile_payload->'socials' ? 'legalAgreement' FROM access_requests") == 'f'
    assert query("SELECT profile_payload#>>'{socials,signupRecovery,requiresConsent}' FROM access_requests") == 'true'
    assert query("SELECT first_name||':'||last_name||':'||request_message FROM access_requests") == 'Real:Name:'
    query("UPDATE access_requests SET status='denied'")
    assert reconcile('changed@recovery.invalid', True, clerk_id='user_new') == 'existing_request'
    assert reconcile(apply=True) == 'existing_request'
    query("UPDATE access_requests SET status='approved'")
    assert reconcile(apply=True) == 'existing_request'
    assert query('SELECT count(*) FROM access_requests') == '1'

    query("""INSERT INTO users(id,tenant_id,email,password_hash,status) VALUES
      ('existing','cedar','other@recovery.invalid','synthetic-only','active');""")
    assert reconcile('other@recovery.invalid', True) == 'existing_membership_or_account'
    query("UPDATE users SET status='inactive',tenant_id='gl'")
    assert reconcile('other@recovery.invalid', True) == 'existing_membership_or_account'
    query("""INSERT INTO identities(id,clerk_user_id,primary_email) VALUES
      ('identity-existing','user_else','identity@recovery.invalid');
      INSERT INTO tenant_memberships(tenant_id,identity_id,status) VALUES('cedar','identity-existing','inactive');""")
    assert reconcile('identity@recovery.invalid', True) == 'existing_membership_or_account'

    query("UPDATE tenants SET settings=jsonb_set(settings,'{signupMode}','\"invite_only\"') WHERE id='gl'")
    assert reconcile('invited@recovery.invalid', True) == 'invitation_required'
    query("""INSERT INTO invites(tenant_id,email,token,expires_at,role_to_assign,created_by_user_id)
      VALUES('gl','invited@recovery.invalid','synthetic-token',now()+interval '1 day','user','existing');""")
    assert reconcile('invited@recovery.invalid', True) == 'created'
    query("UPDATE tenants SET settings=jsonb_set(settings,'{signupMode}','\"open\"') WHERE id='gl'")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: reconcile('race@recovery.invalid', True), range(2)))
    assert sorted(outcomes) == ['created', 'existing_request']
    assert query("SELECT count(*) FROM access_requests WHERE email='race@recovery.invalid'") == '1'

    query("INSERT INTO users(id,tenant_id,email,password_hash,roles) VALUES('director','gl','director@recovery.invalid','unusable',ARRAY['tenant_admin'])")
    def approve(request_id, actor='director'):
        return query(f"SELECT public.approve_recovered_signup_review('gl','{request_id}','{actor}')->>'code'")
    def pending_id(email):
        assert reconcile(email, True) == 'created'
        return query(f"SELECT id FROM access_requests WHERE email='{email}'")
    def consent(request_id):
        query(f"UPDATE access_requests SET profile_payload=jsonb_set(profile_payload,'{{socials,legalAgreement}}','{{\"accepted\":true,\"ageEligibilityConfirmed\":true}}') WHERE id='{request_id}'")
    target = pending_id('approval@recovery.invalid')
    assert approve(target) == 'RECOVERED_SIGNUP_CONSENT_REQUIRED'
    consent(target)
    assert approve(target, 'existing') == 'RECOVERY_APPROVAL_FORBIDDEN'
    assert query(f"SELECT public.approve_recovered_signup_review('gl','{target}','director')->>'ok'") == 'true'
    assert query("SELECT count(*) FROM users u JOIN tenant_memberships m ON m.legacy_user_id=u.id JOIN identities i ON i.id=m.identity_id JOIN profiles p ON p.tenant_membership_id=m.id WHERE u.clerk_user_id='user_approval' AND i.clerk_user_id=u.clerk_user_id AND p.user_id=u.id AND u.profile_id=p.id AND m.join_method='approval'") == '1'
    assert query("SELECT socials ? 'signupRecovery' FROM profiles WHERE emails[1]='approval@recovery.invalid'") == 'f'
    assert query("SELECT socials#>>'{legalAgreement,accepted}' FROM profiles WHERE emails[1]='approval@recovery.invalid'") == 'true'
    assert approve(target) == 'ACCESS_REQUEST_CHANGED'
    assert query(f"WITH d AS (UPDATE access_requests SET status='denied' WHERE id='{target}' AND status='pending' RETURNING id) SELECT count(*) FROM d") == '0'
    forged = pending_id('forged@recovery.invalid'); consent(forged)
    query(f"UPDATE access_requests SET recovered_clerk_user_id=NULL WHERE id='{forged}'")
    assert approve(forged) == 'RECOVERY_PROVENANCE_REQUIRED'
    denied = pending_id('deniedrace@recovery.invalid'); consent(denied)
    def deny_race():
        return query(f"BEGIN; UPDATE access_requests SET status='denied' WHERE id='{denied}' AND status='pending'; SELECT pg_sleep(0.15); COMMIT;")
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(deny_race), pool.submit(approve, denied)]
        [future.result() for future in futures]
    status = query(f"SELECT status FROM access_requests WHERE id='{denied}'")
    count = query("SELECT count(*) FROM users WHERE clerk_user_id='user_deniedrace'")
    assert (status, count) in [('approved', '1'), ('denied', '0')], 'Decision and membership diverged'
    twice = pending_id('twice@recovery.invalid'); consent(twice)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(lambda _: approve(twice), range(2)))
    assert sorted(outcomes) == ['', 'ACCESS_REQUEST_CHANGED']
    assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_twice'") == '1'
    # A failure after creating the user must roll back every write in the RPC.
    rollback = pending_id('rollback@recovery.invalid'); consent(rollback)
    query("CREATE FUNCTION public.reject_synthetic_profile() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.emails[1]='rollback@recovery.invalid' THEN RAISE EXCEPTION 'synthetic profile failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_synthetic BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION public.reject_synthetic_profile();")
    try:
        approve(rollback)
        raise AssertionError('Expected synthetic database failure')
    except RuntimeError as error:
        assert 'synthetic profile failure' in str(error)
    assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_rollback'") == '0'
    assert query("SELECT count(*) FROM identities WHERE clerk_user_id='user_rollback'") == '0'
    assert query(f"SELECT status FROM access_requests WHERE id='{rollback}'") == 'pending'

    assert query("SELECT count(*) FROM public.claim_signup_review_scan('gl')") == '1'
    assert query("SELECT count(*) FROM public.claim_signup_review_scan('gl')") == '0'
    token = query("SELECT lease_token FROM signup_review_scan_state WHERE tenant_id='gl'")
    assert query(f"SELECT public.finish_signup_review_scan('cedar','{token}',100,'')") == 'f'
    assert query(f"SELECT public.finish_signup_review_scan('gl','{token}',100,'SYNTHETIC_FAILURE')") == 't'
    assert query("SELECT scan_offset||':'||last_error||':'||(last_success_at IS NULL) FROM signup_review_scan_state") == '0:SYNTHETIC_FAILURE:true'
    query("UPDATE signup_review_scan_state SET run_at=now()-interval '1 second'")
    query("SELECT count(*) FROM public.claim_signup_review_scan('gl')")
    token = query("SELECT lease_token FROM signup_review_scan_state WHERE tenant_id='gl'")
    assert query(f"SELECT public.finish_signup_review_scan('gl','{token}',0,'')") == 't'
    assert query("SELECT last_error='' AND last_success_at IS NOT NULL AND last_completed_cycle_at IS NOT NULL FROM signup_review_scan_state") == 't'
    for role in ['anon', 'authenticated']:
        assert query(f"SELECT has_function_privilege('{role}','public.approve_recovered_signup_review(text,text,text)','EXECUTE')") == 'f'
        assert query(f"SELECT has_table_privilege('{role}','public.signup_review_scan_state','SELECT')") == 'f'
        assert query(f"SELECT has_function_privilege('{role}','public.reconcile_verified_signup_review(text,text,text,text,text,text,boolean)','EXECUTE')") == 'f'
    print('PASS: full local schema, dry-run, pending-only idempotency, history/account/control protection, invitation gate, concurrent insert, atomic approval/denial, stable Clerk binding, forged provenance, transaction rollback, cursor lease/health, service-only grants')
finally:
    query('DROP DATABASE ' + DATABASE + ' WITH (FORCE)', 'postgres')
