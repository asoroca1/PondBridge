-- Undo may delete only the untouched tenant-local account stub created by an
-- import. Serialize with profile claiming, and roll back both deletes together.
CREATE OR REPLACE FUNCTION public.delete_unclaimed_import_profile(
  p_tenant_id text, p_profile_id text, p_report_id text
) RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_user public.users%ROWTYPE;
BEGIN
  IF NULLIF(p_tenant_id, '') IS NULL OR NULLIF(p_profile_id, '') IS NULL
     OR NULLIF(p_report_id, '') IS NULL THEN
    RAISE EXCEPTION 'Tenant, profile and import report are required';
  END IF;
  PERFORM 1 FROM public.import_reports
    WHERE id = p_report_id AND tenant_id = p_tenant_id FOR KEY SHARE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;

  SELECT * INTO v_profile FROM public.profiles
    WHERE id = p_profile_id AND tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_profile.socials #>> '{importedFrom,reportId}' IS DISTINCT FROM p_report_id THEN
    RETURN 'not_found';
  END IF;
  IF v_profile.status IS DISTINCT FROM 'pending' THEN RETURN 'claimed'; END IF;

  SELECT * INTO v_user FROM public.users
    WHERE id = v_profile.user_id AND tenant_id = p_tenant_id FOR UPDATE;
  -- Protect corrupt references, global identities, signed-in accounts, elevated
  -- users and membership-backed accounts. Undo never deletes a Clerk identity.
  IF NOT FOUND THEN RETURN 'protected'; END IF;
  IF v_user.profile_id IS DISTINCT FROM v_profile.id
     OR v_user.roles IS DISTINCT FROM ARRAY['user']::text[]
     OR NULLIF(v_user.clerk_user_id, '') IS NOT NULL
     OR v_user.last_login_at IS NOT NULL
     OR v_profile.tenant_membership_id IS NOT NULL
     OR EXISTS (SELECT 1 FROM public.tenant_memberships WHERE legacy_user_id = v_user.id)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user.id AND id <> v_profile.id)
  THEN RETURN 'protected'; END IF;

  DELETE FROM public.profiles WHERE id = v_profile.id AND tenant_id = p_tenant_id;
  DELETE FROM public.users WHERE id = v_user.id AND tenant_id = p_tenant_id;
  RETURN 'removed';
END;
$$;

REVOKE ALL ON FUNCTION public.delete_unclaimed_import_profile(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_unclaimed_import_profile(text, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unclaimed_import_profile(text, text, text) TO service_role;
