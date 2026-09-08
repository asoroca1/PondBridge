"""Restore a synthetic application backup into a NEW disposable local database.

Requires the existing Supabase local Docker container. Reads only its schema;
never reads its application rows or connects to a hosted project. No credentials.
Run from any directory: python3 scripts/rehearseRecovery.py
"""
import hashlib
import json
import os
import pathlib
import secrets
import subprocess
import time

CONTAINER = 'supabase_db_pondbridge-local-staging'
ROOT = pathlib.Path(__file__).resolve().parents[1]
PREFIX = 'pb_recovery_' + secrets.token_hex(8)
SOURCE, TARGET = PREFIX + '_source', PREFIX + '_restore'
CREATED = []


def docker(command, data=None):
    result = subprocess.run(
        ['docker', 'exec', '-i', CONTAINER] + command,
        input=data, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError(result.stderr.decode(errors='replace'))
    return result.stdout


def query(sql, database):
    return docker(['psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database,
                   '-v', 'ON_ERROR_STOP=1'], sql.encode()).decode().strip()


def expect(sql, value, database=TARGET):
    actual = query(sql, database)
    if actual != value:
        raise AssertionError(f'Expected {value!r}; got {actual!r}')


# Only catalog metadata; captures security attributes as well as object counts.
CATALOG = """
SELECT jsonb_build_object(
 'tables', (SELECT jsonb_agg(jsonb_build_array(c.relname,c.relrowsecurity,
   c.relforcerowsecurity,c.relacl) ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind='r'),
 'policies', (SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname)
   FROM pg_policies p WHERE schemaname='public'),
 'functions', (SELECT jsonb_agg(jsonb_build_array(p.proname,
   pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid),p.proacl)
   ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'),
 'constraints', (SELECT jsonb_agg(jsonb_build_array(c.relname,k.conname,
   pg_get_constraintdef(k.oid)) ORDER BY c.relname,k.conname)
   FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'));
"""

FIXTURE = """
INSERT INTO public.tenants (id,name,slug) VALUES
 ('recovery-camp-a','Synthetic Camp A','synthetic-recovery-a'),
 ('recovery-camp-b','Synthetic Camp B','synthetic-recovery-b');
INSERT INTO public.users (id,tenant_id,email,password_hash) VALUES
 ('recovery-admin','recovery-camp-a','admin@recovery.invalid','unusable-synthetic-fixture'),
 ('recovery-user-a','recovery-camp-a','a@recovery.invalid','unusable-synthetic-fixture'),
 ('recovery-user-b','recovery-camp-b','b@recovery.invalid','unusable-synthetic-fixture');
INSERT INTO public.import_reports (id,tenant_id,created_by_user_id) VALUES
 ('recovery-report','recovery-camp-a','recovery-admin');
INSERT INTO public.profiles
 (id,tenant_id,user_id,first_name,last_name,status,socials) VALUES
 ('recovery-profile-a','recovery-camp-a','recovery-user-a','Synthetic','A','pending',
  '{"importedFrom":{"reportId":"recovery-report"}}'),
 ('recovery-profile-b','recovery-camp-b','recovery-user-b','Synthetic','B','active','{}');
UPDATE public.users SET profile_id='recovery-profile-a' WHERE id='recovery-user-a';
UPDATE public.users SET profile_id='recovery-profile-b' WHERE id='recovery-user-b';
"""


def data_fingerprint(database):
    # The database was created empty by this process and contains only our fixture.
    return query("""SELECT md5(jsonb_build_array(
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.tenants t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.users t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.profiles t),
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.import_reports t))::text);""",
      database)


def run():
    started = time.monotonic()
    endpoint = os.environ.get('DOCKER_HOST')
    if not endpoint:
        endpoint = subprocess.check_output(
            ['docker', 'context', 'inspect', '--format', '{{(index .Endpoints "docker").Host}}'],
            text=True, timeout=10).strip()
    if not endpoint.startswith('unix://'):
        raise RuntimeError('This rehearsal requires a local Unix-socket Docker engine')
    schema = docker(['pg_dump', '-U', 'supabase_admin', '-d', 'postgres',
                     '--schema-only', '--no-owner'])
    for database in [SOURCE, TARGET]:
        # Never adopt an existing database, even after a collision or failed run.
        query(f'CREATE DATABASE {database} TEMPLATE template0;', 'postgres')
        CREATED.append(database)
    query(schema.decode(), SOURCE)
    # Test the release RPC even when the existing local schema predates the release.
    query((ROOT / 'supabase/migrations/20260908195000_atomic_import_undo.sql').read_text(), SOURCE)
    query(FIXTURE, SOURCE)
    catalog_before = query(CATALOG, SOURCE)
    data_before = data_fingerprint(SOURCE)
    # In-memory archive: synthetic data only, no plaintext backup left on disk.
    archive = docker(['pg_dump', '-U', 'supabase_admin', '-d', SOURCE,
                      '--format=custom', '--no-owner'])
    docker(['pg_restore', '-U', 'supabase_admin', '-d', TARGET,
            '--exit-on-error', '--no-owner'], archive)
    expect(CATALOG, catalog_before)
    assert data_fingerprint(TARGET) == data_before, 'Restored fixture differs'
    expect('SELECT count(*) FROM public.tenants;', '2')
    expect('SELECT count(*) FROM public.users;', '3')
    expect('SELECT count(*) FROM public.profiles;', '2')
    expect('SELECT count(*) FROM public.import_reports;', '1')

    # The application denies direct client table access in addition to RLS. Prove
    # that restored ACL first, then grant within a rolled-back transaction solely
    # to exercise the actual restored tenant JWT helper and RLS policies.
    expect("SELECT has_table_privilege('authenticated','public.profiles','SELECT');", 'f')
    policy_probe = 'BEGIN; GRANT SELECT,UPDATE ON public.profiles TO authenticated; SET LOCAL ROLE authenticated; '
    for tenant, visible in [('recovery-camp-a', 'recovery-profile-a'),
                            ('recovery-camp-b', 'recovery-profile-b'), ('', '')]:
        claims = json.dumps({'tenantId': tenant, 'role': 'authenticated'})
        expect(policy_probe + f"SET LOCAL request.jwt.claims='{claims}'; "
               'SELECT id FROM public.profiles ORDER BY id; ROLLBACK;', visible)
    expect(policy_probe + "SET LOCAL request.jwt.claims='{" + '"tenantId":"recovery-camp-a"' + "}'; "
           "WITH changed AS (UPDATE public.profiles SET bio='forbidden' "
           "WHERE tenant_id='recovery-camp-b' RETURNING id) SELECT count(*) FROM changed; ROLLBACK;", '0')
    expect(CATALOG, catalog_before)
    expect("SELECT has_function_privilege('anon',"
           "'public.delete_unclaimed_import_profile(text,text,text)','EXECUTE') OR "
           "has_function_privilege('authenticated',"
           "'public.delete_unclaimed_import_profile(text,text,text)','EXECUTE');", 'f')
    expect("SET ROLE service_role; SELECT public.delete_unclaimed_import_profile("
           "'recovery-camp-b','recovery-profile-a','recovery-report');", 'not_found')
    expect("SET ROLE service_role; SELECT public.delete_unclaimed_import_profile("
           "'recovery-camp-a','recovery-profile-a','recovery-report');", 'removed')
    expect('SELECT count(*) FROM public.profiles;', '1')
    expect('SELECT count(*) FROM public.users;', '2')
    catalog = json.loads(catalog_before)
    return {
        'checked_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'scope': 'new disposable local databases; schema-only source plus synthetic fixture',
        'postgres_version': query('SHOW server_version;', TARGET),
        'archive_bytes': len(archive), 'archive_sha256': hashlib.sha256(archive).hexdigest(),
        'public_tables': len(catalog['tables']), 'public_policies': len(catalog['policies']),
        'public_functions': len(catalog['functions']),
        'checks': ['full custom archive restored without errors',
                   'public catalog, RLS, policies, function definitions, ACLs and constraints equal',
                   'all synthetic data equal before behavioral checks',
                   'client table SELECT denied by restored ACL',
                   'transaction-only grant probes RLS: each camp sees its own profile; absent tenant sees zero',
                   'RLS cross-tenant update changes zero rows; probe grants rolled back',
                   'anon and authenticated cannot execute import undo',
                   'service-role wrong-tenant undo denied; correct-tenant undo removes only its stub'],
        'elapsed_seconds': round(time.monotonic() - started, 2)
    }


if __name__ == '__main__':
    try:
        evidence = run()
    finally:
        for database in reversed(CREATED):
            if database not in (SOURCE, TARGET) or not database.startswith(PREFIX):
                raise RuntimeError('Refusing cleanup of an unowned database')
            query(f'DROP DATABASE {database} WITH (FORCE);', 'postgres')
    evidence['disposable_databases_removed'] = True
    print(json.dumps(evidence, indent=2))
