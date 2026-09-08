"""Synthetic receipt/activation tests in a NEW disposable local Supabase DB."""
import concurrent.futures
import json
import pathlib
import secrets
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[3]
CONTAINER = 'supabase_db_pondbridge-local-staging'
DATABASE = 'pb_consent_receipt_' + secrets.token_hex(8)
POLICY = dict(version=1, termsVersion='2026-03-04', privacyVersion='2026-03-04', agePolicyVersion='2026-07-14', minimumAge=14)


def command(args, data=None):
    result = subprocess.run(['docker', 'exec', '-i', CONTAINER] + args,
                            input=data, text=True, capture_output=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def query(sql, database=DATABASE):
    return command(['psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database,
                    '-v', 'ON_ERROR_STOP=1'], sql)


def make_request(name, tenant='g'):
    query(f"""INSERT INTO access_requests(id,tenant_id,email,first_name,last_name,password_hash,status,
      recovered_clerk_user_id,profile_payload) VALUES('{name}','{tenant}','{name}@receipt.invalid','Real','Name',
      'clerk_managed','pending','user_{name}',jsonb_build_object('firstName','Real','lastName','Name',
      'socials',jsonb_build_object('signupRecovery',jsonb_build_object('clerkUserId','user_{name}','requiresConsent',true))));""")


def ingest(name, assertion=None, clerk=None, email=None, tenant='g', policy=None):
    policy_sql = "'" + json.dumps(policy or POLICY).replace("'", "''") + "'::jsonb"
    value = 'NULL' if assertion is None else "'" + json.dumps(assertion).replace("'", "''") + "'::jsonb"
    return json.loads(query(f"SELECT ingest_verified_signup_consent_receipt('{tenant}','{name}',"
                            f"'{clerk or 'user_' + name}','{email or name + '@receipt.invalid'}',{policy_sql},{value})"))


schema = command(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--schema-only', '--no-owner'])
query('CREATE DATABASE ' + DATABASE + ' TEMPLATE template0', 'postgres')
try:
    query(schema)
    for filename in ['20260908220000_durable_tenant_jobs.sql',
                     '20260909010000_verified_signup_review_reconciliation.sql',
                     '20260909020000_durable_access_approval_email.sql',
                     '20260909030000_recovered_signup_director_preapproval.sql',
                     '20260909040000_durable_signup_consent_receipts.sql']:
        query((ROOT / 'supabase/migrations' / filename).read_text())
    query("""INSERT INTO tenants(id,name,slug) VALUES('g','Synthetic G','greenlane'),('c','Synthetic C','cedar');
      INSERT INTO users(id,tenant_id,email,password_hash,roles) VALUES('director','g','director@receipt.invalid','synthetic',ARRAY['tenant_admin']);""")
    claimed_at = query("SELECT to_char(now() AT TIME ZONE 'UTC' - interval '1 minute','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
    assertion = dict(version=1, accepted=True, ageEligibilityConfirmed=True, termsVersion='2026-03-04',
                     privacyVersion='2026-03-04', agePolicyVersion='2026-07-14', minimumAge=14, acceptedAt=claimed_at)
    make_request('missing')
    assert ingest('missing')['outcome'] == 'no_receipt'
    assert query('SELECT count(*) FROM signup_consent_receipts') == '0'
    for patch in [dict(accepted='true'), dict(accepted=False), dict(ageEligibilityConfirmed=False), dict(version='1'),
                  dict(termsVersion='2026-01-01'), dict(privacyVersion='2026-01-01'), dict(minimumAge=13),
                  dict(agePolicyVersion='2026-01-01'), dict(acceptedAt='2099-01-01T00:00:00.000Z'),
                  dict(acceptedAt='2026-07-01T00:00:00.000Z'), dict(acceptedAt='2026-09-31T00:00:00.000Z'),
                  dict(acceptedAt=None), dict(roles=['tenant_admin'])]:
        assert ingest('missing', {**assertion, **patch})['outcome'] == 'invalid_receipt'
    assert query('SELECT count(*) FROM signup_consent_receipts') == '0'
    assert ingest('missing', assertion, clerk='user_else')['outcome'] == 'ineligible_request'
    assert ingest('missing', assertion, email='different@receipt.invalid')['outcome'] == 'ineligible_request'
    make_request('cedar', 'c')
    assert ingest('cedar', assertion, tenant='c')['outcome'] == 'ineligible_request'
    make_request('denied'); query("UPDATE access_requests SET status='denied' WHERE id='denied'")
    assert ingest('denied', assertion)['outcome'] == 'ineligible_request'
    make_request('ordinary'); query("UPDATE access_requests SET recovered_clerk_user_id=NULL WHERE id='ordinary'")
    assert ingest('ordinary', assertion)['outcome'] == 'ineligible_request'

    recorded = ingest('missing', assertion)
    assert recorded['outcome'] == 'recorded' and not recorded['activated']
    assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_missing'") == '0'
    assert query("SELECT profile_payload#>>'{socials,legalAgreement,accepted}' FROM access_requests WHERE id='missing'") == 'true'
    snapshot = query("SELECT row_to_json(r) FROM signup_consent_receipts r WHERE clerk_user_id='user_missing'")
    changed = {**assertion, 'acceptedAt': claimed_at.replace('.000Z', '.001Z')}
    assert ingest('missing', changed)['receiptId'] == recorded['receiptId']
    assert ingest('missing', {**assertion, 'accepted': False})['receiptId'] == recorded['receiptId']
    assert query("SELECT row_to_json(r) FROM signup_consent_receipts r WHERE clerk_user_id='user_missing'") == snapshot
    assert query("SELECT observed_at>claimed_accepted_at AND source='clerk_signup_metadata' FROM signup_consent_receipts WHERE clerk_user_id='user_missing'") == 't'
    # A lost copy on the pending request can be restored from immutable evidence,
    # even after mutable metadata disappeared; identity/tenant checks still run.
    query("UPDATE access_requests SET profile_payload=profile_payload #- '{socials,legalAgreement}' WHERE id='missing'")
    assert ingest('missing')['outcome'] == 'existing_receipt'
    assert query("SELECT profile_payload#>>'{socials,legalAgreement,accepted}' FROM access_requests WHERE id='missing'") == 'true'

    try:
        ingest('missing', policy={**POLICY, 'termsVersion': '2027-01-01'})
        raise AssertionError('Old-policy receipt restored under a newer API policy')
    except RuntimeError as error:
        assert 'Consent policy version mismatch' in str(error)

    make_request('preapproved')
    query("SELECT preapprove_recovered_signup_review('g','preapproved','director')")
    assert ingest('preapproved', assertion)['activated']
    assert query("SELECT count(*) FROM users u JOIN tenant_memberships m ON m.legacy_user_id=u.id JOIN profiles p ON p.tenant_membership_id=m.id WHERE u.clerk_user_id='user_preapproved' AND p.socials#>>'{legalAgreement,accepted}'='true'") == '1'
    assert query("SELECT count(*) FROM tenant_background_jobs WHERE idempotency_key='access-approval/preapproved'") == '1'
    assert ingest('preapproved', assertion)['outcome'] == 'ineligible_request'
    assert query("SELECT count(*) FROM signup_consent_receipts WHERE clerk_user_id='user_preapproved'") == '1'

    # Heal a pre-existing inconsistent state without replacing its real consent.
    make_request('stuck'); ingest('stuck', assertion)
    legal_before = query("SELECT profile_payload#>'{socials,legalAgreement}' FROM access_requests WHERE id='stuck'")
    query("UPDATE access_requests SET director_approved_at=now(),director_approved_by_user_id='director' WHERE id='stuck'")
    assert ingest('stuck')['activated']
    assert query("SELECT profile_payload#>'{socials,legalAgreement}' FROM access_requests WHERE id='stuck'") == legal_before
    assert query("SELECT count(*) FROM signup_consent_receipts WHERE clerk_user_id='user_stuck'") == '1'

    # True checkboxes from an older/partial policy cannot outrank a freshly
    # validated current receipt or flow into the final member profile.
    make_request('stale')
    query("UPDATE access_requests SET profile_payload=jsonb_set(profile_payload,'{socials,legalAgreement}',"
          "'{\"accepted\":true,\"ageEligibilityConfirmed\":true,\"termsVersion\":\"2025-01-01\"}'::jsonb) WHERE id='stale'")
    assert ingest('stale', assertion)['outcome'] == 'recorded'
    assert query("SELECT profile_payload#>>'{socials,legalAgreement,termsVersion}' FROM access_requests WHERE id='stale'") == POLICY['termsVersion']
    query("SELECT preapprove_recovered_signup_review('g','stale','director')")
    assert query("SELECT p.socials#>>'{legalAgreement,agePolicyVersion}' FROM profiles p JOIN users u ON p.user_id=u.id WHERE u.clerk_user_id='user_stale'") == POLICY['agePolicyVersion']

    make_request('duplicate')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: ingest('duplicate', assertion), range(2)))
    assert sorted(r['outcome'] for r in results) == ['existing_receipt', 'recorded']
    assert query("SELECT count(*) FROM signup_consent_receipts WHERE clerk_user_id='user_duplicate'") == '1'
    # Director and receipt arrival can be interleaved without missing activation.
    make_request('ordering')
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        work = [pool.submit(ingest, 'ordering', assertion), pool.submit(query, "SELECT preapprove_recovered_signup_review('g','ordering','director')")]
        [task.result() for task in work]
    assert query("SELECT status FROM access_requests WHERE id='ordering'") == 'approved'
    assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_ordering'") == '1'

    make_request('rollback'); query("SELECT preapprove_recovered_signup_review('g','rollback','director')")
    query("CREATE FUNCTION public.fail_receipt_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.idempotency_key='access-approval/rollback' THEN RAISE EXCEPTION 'synthetic final outbox failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_receipt_outbox BEFORE INSERT ON tenant_background_jobs FOR EACH ROW EXECUTE FUNCTION public.fail_receipt_outbox()")
    try:
        ingest('rollback', assertion)
        raise AssertionError('Expected synthetic transaction failure')
    except RuntimeError as error:
        assert 'synthetic final outbox failure' in str(error)
    assert query("SELECT count(*) FROM signup_consent_receipts WHERE clerk_user_id='user_rollback'") == '0'
    assert query("SELECT count(*) FROM users WHERE clerk_user_id='user_rollback'") == '0'
    assert query("SELECT status='pending' AND profile_payload#>'{socials,legalAgreement}' IS NULL FROM access_requests WHERE id='rollback'") == 't'

    for role in ['anon', 'authenticated']:
        assert query(f"SELECT has_table_privilege('{role}','signup_consent_receipts','select')") == 'f'
        assert query(f"SELECT has_function_privilege('{role}','ingest_verified_signup_consent_receipt(text,text,text,text,jsonb,jsonb)','execute')") == 'f'
    for permission in ['INSERT', 'UPDATE', 'DELETE']:
        assert query(f"SELECT has_table_privilege('service_role','signup_consent_receipts','{permission}')") == 'f'
    assert query("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='signup_consent_receipts'::regclass") == 't'
    assert query("SELECT confdeltype FROM pg_constraint WHERE conrelid='signup_consent_receipts'::regclass AND contype='f'") == 'c'
    print('PASS: full schema; strict metadata; missing/denied/ordinary/Cedar/identity protection; immutable once-per-policy receipt; same-identity replay; activation and phase outbox; concurrent receipt/director; atomic rollback; service-only forced RLS and cascade')
finally:
    query('DROP DATABASE ' + DATABASE + ' WITH (FORCE)', 'postgres')
