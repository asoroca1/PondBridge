"""Run real concurrent Postgres regressions in a newly created, isolated local DB.

Requires the local Supabase Docker DB; never connects to a hosted project.
Run: python3 apps/api/tests/atomicImportUndo.local.py
"""
import pathlib
import subprocess
import time

CONTAINER = 'supabase_db_pondbridge-local-staging'
DATABASE = f'pondbridge_import_security_{int(time.time())}'
BASE = ['docker', 'exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']


def query(sql, database=DATABASE):
    result = subprocess.run(BASE + ['-d', database], input=sql, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def fixture():
    query('''TRUNCATE profiles, tenant_memberships, import_reports, users, retained_reference;
      INSERT INTO import_reports VALUES ('report-a', 'camp-a'), ('report-b', 'camp-b');
      INSERT INTO users (id, tenant_id, profile_id) VALUES ('user-a', 'camp-a', 'profile-a');
      INSERT INTO profiles (id, tenant_id, user_id, socials)
      VALUES ('profile-a', 'camp-a', 'user-a', '{"importedFrom":{"reportId":"report-a"}}');''')


def undo():
    return query("SELECT public.delete_unclaimed_import_profile('camp-a','profile-a','report-a');")


def racing_transaction(first_sql, second_sql):
    # The marker arrives only after the first operation holds its row lock.
    first = subprocess.Popen(BASE + ['-d', DATABASE], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    first.stdin.write('BEGIN;\n' + first_sql + '\n\\echo LOCKED\nSELECT pg_sleep(1);\nCOMMIT;\n')
    first.stdin.close()
    for line in first.stdout:
        if line.strip() == 'LOCKED':
            break
    else:
        raise RuntimeError('First transaction failed: ' + first.stderr.read())
    result = query(second_sql)
    assert first.wait(timeout=10) == 0, first.stderr.read()
    return result


query(f'CREATE DATABASE {DATABASE};', 'postgres')
try:
    query('''CREATE TABLE users (
      id text PRIMARY KEY, tenant_id text, profile_id text,
      roles text[] DEFAULT ARRAY['user']::text[], clerk_user_id text, last_login_at timestamptz);
      CREATE TABLE profiles (
        id text PRIMARY KEY, tenant_id text, user_id text UNIQUE, status text DEFAULT 'pending',
        socials jsonb, tenant_membership_id text);
      CREATE TABLE import_reports (id text PRIMARY KEY, tenant_id text);
      CREATE TABLE tenant_memberships (id text, legacy_user_id text REFERENCES users(id));
      CREATE TABLE retained_reference (user_id text REFERENCES users(id));''')
    migration = pathlib.Path(__file__).resolve().parents[3] / 'supabase/migrations/20260908195000_atomic_import_undo.sql'
    query(migration.read_text())

    fixture()
    assert query("SELECT public.delete_unclaimed_import_profile('camp-b','profile-a','report-b');") == 'not_found'
    assert query("SELECT public.delete_unclaimed_import_profile('camp-a','profile-a','report-b');") == 'not_found'
    assert query('SELECT count(*) FROM profiles;') == '1'

    for protection in [
        "UPDATE users SET clerk_user_id='clerk-local';",
        "UPDATE users SET last_login_at=now();",
        "UPDATE users SET roles=ARRAY['tenant_admin'];",
        "UPDATE users SET tenant_id=NULL;",
        "INSERT INTO tenant_memberships VALUES ('membership-local','user-a');",
        "UPDATE profiles SET tenant_membership_id='membership-local';"
    ]:
        fixture()
        query(protection)
        assert undo() == 'protected', protection
        assert query('SELECT count(*) FROM users;') == '1'

    fixture()
    query("INSERT INTO retained_reference VALUES ('user-a');")
    try:
        undo()
        raise AssertionError('Expected dependent account delete to fail')
    except RuntimeError:
        pass
    assert query('SELECT count(*) FROM profiles;') == '1', 'Profile deletion must roll back with user deletion'

    fixture()
    result = racing_transaction(
        "UPDATE profiles SET status='active' WHERE id='profile-a' AND tenant_id='camp-a' AND user_id='user-a' AND status='pending';",
        "SELECT public.delete_unclaimed_import_profile('camp-a','profile-a','report-a');")
    assert result == 'claimed'
    assert query('SELECT count(*) FROM users;') == '1'

    fixture()
    result = racing_transaction(
        "SELECT public.delete_unclaimed_import_profile('camp-a','profile-a','report-a');",
        "UPDATE profiles SET status='active' WHERE id='profile-a' AND tenant_id='camp-a' AND user_id='user-a' AND status='pending' RETURNING id;")
    assert result == 'UPDATE 0', result
    assert query('SELECT count(*) FROM profiles;') == '0'
    assert query('SELECT count(*) FROM users;') == '0'
    assert query("SELECT has_function_privilege('authenticated', 'public.delete_unclaimed_import_profile(text,text,text)', 'EXECUTE');") == 'f'
    assert query("SELECT has_function_privilege('anon', 'public.delete_unclaimed_import_profile(text,text,text)', 'EXECUTE');") == 'f'
    print('PASS: tenant/report isolation, six account protections, atomic rollback, both real claim/undo races, client execute denied')
finally:
    query(f'DROP DATABASE {DATABASE};', 'postgres')
