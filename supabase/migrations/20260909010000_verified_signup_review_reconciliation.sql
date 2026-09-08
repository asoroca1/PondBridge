BEGIN;
ALTER TABLE public.access_requests ADD COLUMN IF NOT EXISTS recovered_clerk_user_id text;
CREATE INDEX IF NOT EXISTS idx_access_requests_recovered_identity
  ON public.access_requests(tenant_id,recovered_clerk_user_id) WHERE recovered_clerk_user_id IS NOT NULL;

-- Only service-role workers can read or advance this cursor. It contains no
-- email, OTP, session token or user profile. The rollout remains off by default.
CREATE TABLE IF NOT EXISTS public.signup_review_scan_state (
  tenant_id text PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  last_success_at timestamptz,
  last_completed_cycle_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  scan_offset integer NOT NULL DEFAULT 0 CHECK (scan_offset >= 0),
  lease_token uuid,
  lease_until timestamptz,
  run_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.signup_review_scan_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_review_scan_state FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_review_scan_state FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.signup_review_scan_state TO service_role;
CREATE POLICY signup_review_scan_state_service_role_all ON public.signup_review_scan_state
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.claim_signup_review_scan(p_tenant text)
RETURNS SETOF public.signup_review_scan_state LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active') THEN RETURN; END IF;
  INSERT INTO public.signup_review_scan_state(tenant_id) VALUES(p_tenant) ON CONFLICT DO NOTHING;
  RETURN QUERY UPDATE public.signup_review_scan_state SET lease_token=gen_random_uuid(),
    lease_until=now()+interval '4 minutes',updated_at=now()
    WHERE tenant_id=p_tenant AND run_at<=now() AND (lease_until IS NULL OR lease_until<now()) RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.finish_signup_review_scan(p_tenant text,p_lease uuid,p_offset integer,p_error text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  UPDATE public.signup_review_scan_state SET scan_offset=CASE WHEN p_error='' THEN p_offset ELSE scan_offset END,lease_token=NULL,lease_until=NULL,
    last_success_at=CASE WHEN p_error='' THEN now() ELSE last_success_at END,
    last_completed_cycle_at=CASE WHEN p_error='' AND p_offset=0 THEN now() ELSE last_completed_cycle_at END,
    last_error=left(p_error,100),
    run_at=now()+interval '1 minute',updated_at=now()
    WHERE tenant_id=p_tenant AND lease_token=p_lease AND lease_until>now();
  RETURN FOUND;
END $$;

-- p_clerk_user_id/email originate from a fresh verified Clerk Backend API User,
-- never from a submitted HTTP body. This RPC creates pending rows only.
CREATE OR REPLACE FUNCTION public.reconcile_verified_signup_review(
 p_tenant text,p_clerk_user_id text,p_email text,p_first_name text,p_last_name text,p_source text,p_apply boolean DEFAULT false)
RETURNS TABLE(outcome text,request_id text) LANGUAGE plpgsql
SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  tenant_row public.tenants%ROWTYPE;
  normalized_email text := lower(btrim(p_email));
  signup_mode text;
  existing_id text;
  inserted_id text;
BEGIN
  IF nullif(btrim(p_clerk_user_id),'') IS NULL OR normalized_email IS NULL OR normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     OR p_source IS NULL OR p_source NOT IN ('operator_repair','periodic_scan','clerk_user_created','clerk_user_updated') THEN
    RAISE EXCEPTION 'Invalid signup reconciliation evidence';
  END IF;
  SELECT * INTO tenant_row FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active' FOR KEY SHARE;
  IF NOT FOUND THEN RETURN QUERY SELECT 'disabled'::text,NULL::text; RETURN; END IF;
  signup_mode := coalesce(nullif(tenant_row.settings->>'signupMode',''),tenant_row.access_settings->>'signupMode','open');
  IF NOT (coalesce(tenant_row.settings->>'requireSignupApproval','false')='true' OR signup_mode='approval_queue') THEN
    RETURN QUERY SELECT 'review_disabled'::text,NULL::text; RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.feature_rollouts f
    WHERE f.feature_key='verified_signup_review_reconciliation_v1' AND f.kill_switch=false
      AND NOT (p_tenant=ANY(coalesce(f.excluded_tenant_ids,'{}'::text[])))
      AND (f.state='enabled' OR (f.state='pilot' AND p_tenant=ANY(f.tenant_ids)))) THEN
    RETURN QUERY SELECT 'disabled'::text,NULL::text; RETURN;
  END IF;

  -- Serialize the absence check with ordinary callback inserts and director
  -- decisions, which do not participate in advisory locks. This short database
  -- transaction contains no network call. A concurrent denial cannot free the
  -- pending-only unique key and accidentally be recreated by recovery.
  PERFORM set_config('lock_timeout','3s',true);
  LOCK TABLE public.access_requests IN SHARE ROW EXCLUSIVE MODE;
  SELECT id INTO existing_id FROM public.access_requests
    WHERE tenant_id=p_tenant AND (lower(email)=normalized_email OR recovered_clerk_user_id=p_clerk_user_id) ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN QUERY SELECT 'existing_request'::text,existing_id; RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE clerk_user_id=p_clerk_user_id OR lower(email)=normalized_email)
     OR EXISTS (SELECT 1 FROM public.tenant_memberships m JOIN public.identities i ON i.id=m.identity_id
       WHERE i.clerk_user_id=p_clerk_user_id OR lower(i.primary_email)=normalized_email) THEN
    RETURN QUERY SELECT 'existing_membership_or_account'::text,NULL::text; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM public.invites WHERE tenant_id=p_tenant AND lower(email)=normalized_email
    AND used_at IS NULL AND expires_at>now() AND role_to_assign='tenant_admin') THEN
    RETURN QUERY SELECT 'director_invite'::text,NULL::text; RETURN;
  END IF;
  IF signup_mode NOT IN ('open','approval_queue') AND NOT EXISTS (
    SELECT 1 FROM public.invites WHERE tenant_id=p_tenant AND lower(email)=normalized_email
      AND used_at IS NULL AND expires_at>now() AND coalesce(role_to_assign,'user')='user') THEN
    RETURN QUERY SELECT 'invitation_required'::text,NULL::text; RETURN;
  END IF;
  IF p_apply IS DISTINCT FROM true THEN RETURN QUERY SELECT 'would_create'::text,NULL::text; RETURN; END IF;
  INSERT INTO public.access_requests(tenant_id,email,first_name,last_name,password_hash,status,
    self_reported_role,request_message,profile_payload,requested_at,recovered_clerk_user_id)
  VALUES(p_tenant,normalized_email,left(coalesce(p_first_name,''),100),left(coalesce(p_last_name,''),100),
    'clerk_managed','pending','',
    '',
    jsonb_build_object('firstName',left(coalesce(p_first_name,''),100),'lastName',left(coalesce(p_last_name,''),100),
      'emails',jsonb_build_array(normalized_email),'socials',jsonb_build_object('signupRecovery',jsonb_build_object(
        'clerkUserId',p_clerk_user_id,'source',p_source,'recoveredAt',now(),'requiresConsent',true))),now(),p_clerk_user_id)
  RETURNING id INTO inserted_id;
  RETURN QUERY SELECT 'created'::text,inserted_id;
END $$;

REVOKE ALL ON FUNCTION public.claim_signup_review_scan(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.finish_signup_review_scan(text,uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reconcile_verified_signup_review(text,text,text,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_signup_review_scan(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_signup_review_scan(text,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_verified_signup_review(text,text,text,text,text,text,boolean) TO service_role;
-- Recovery approval is one transaction: a denial/second approval that races
-- this row lock cannot create a user or overwrite the winning decision.
CREATE OR REPLACE FUNCTION public.approve_recovered_signup_review(p_tenant text,p_request text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 r public.access_requests%ROWTYPE;
 identity_row public.identities%ROWTYPE;
 seed jsonb;
 clerk_id text;
 user_id text;
 identity_id text;
 membership_id text;
 v_profile_id text;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active')
   OR NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND status='active'
     AND roles && ARRAY['tenant_admin','super_admin']::text[]
     AND (tenant_id=p_tenant OR 'super_admin'=ANY(roles))) THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_APPROVAL_FORBIDDEN');
 END IF;
 SELECT * INTO r FROM public.access_requests WHERE id=p_request AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RETURN jsonb_build_object('ok',false,'code','ACCESS_REQUEST_CHANGED'); END IF;
 seed := coalesce(r.profile_payload,'{}'::jsonb);
 clerk_id := r.recovered_clerk_user_id;
 IF clerk_id IS NULL OR clerk_id !~ '^user_[A-Za-z0-9]+$'
    OR seed#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM clerk_id THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_PROVENANCE_REQUIRED');
 END IF;
 IF seed#>'{socials,legalAgreement,accepted}' IS DISTINCT FROM 'true'::jsonb
   OR seed#>'{socials,legalAgreement,ageEligibilityConfirmed}' IS DISTINCT FROM 'true'::jsonb THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERED_SIGNUP_CONSENT_REQUIRED');
 END IF;
 -- A new account/membership added since recovery requires an explicit review;
 -- never reactivate a removed account or silently attach another identity.
 IF EXISTS(SELECT 1 FROM public.users WHERE clerk_user_id=clerk_id OR lower(email)=lower(r.email))
   OR EXISTS(SELECT 1 FROM public.tenant_memberships m JOIN public.identities i ON i.id=m.identity_id
     WHERE i.clerk_user_id=clerk_id OR lower(i.primary_email)=lower(r.email)) THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_ACCOUNT_CONFLICT');
 END IF;
 SELECT * INTO identity_row FROM public.identities WHERE clerk_user_id=clerk_id OR lower(primary_email)=lower(r.email) FOR UPDATE;
 IF FOUND THEN
   IF identity_row.status<>'active' OR identity_row.clerk_user_id IS DISTINCT FROM clerk_id
     OR lower(identity_row.primary_email)<>lower(r.email)
     OR (SELECT count(*) FROM public.identities WHERE clerk_user_id=clerk_id OR lower(primary_email)=lower(r.email))<>1 THEN
     RETURN jsonb_build_object('ok',false,'code','RECOVERY_ACCOUNT_CONFLICT');
   END IF;
   identity_id := identity_row.id;
 END IF;
 INSERT INTO public.users(tenant_id,clerk_user_id,email,password_hash,roles,status)
 VALUES(p_tenant,clerk_id,lower(r.email),'clerk_managed',ARRAY['user'],'active') RETURNING id INTO user_id;
 IF identity_id IS NULL THEN
   INSERT INTO public.identities(clerk_user_id,primary_email,verified_emails,status)
   VALUES(clerk_id,lower(r.email),ARRAY[lower(r.email)],'active') RETURNING id INTO identity_id;
 END IF;
 INSERT INTO public.tenant_memberships(tenant_id,identity_id,legacy_user_id,roles,status,join_method)
 VALUES(p_tenant,identity_id,user_id,ARRAY['user'],'active','approval') RETURNING id INTO membership_id;
 INSERT INTO public.profiles(tenant_id,user_id,tenant_membership_id,first_name,last_name,emails,phones,
   city_state,role_at_camp,high_school,colleges,college_years,current_jobs,past_jobs,industry,socials,avatar_url,bio,status)
 VALUES(p_tenant,user_id,membership_id,
   coalesce(nullif(btrim(seed->>'firstName'),''),nullif(btrim(r.first_name),''),'Member'),
   coalesce(nullif(btrim(seed->>'lastName'),''),nullif(btrim(r.last_name),''),'Pending'),
   ARRAY[lower(r.email)],ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(seed->'phones')='array' THEN seed->'phones' ELSE '[]'::jsonb END)),
   coalesce(seed->>'cityState',''),coalesce(nullif(r.self_reported_role,''),seed->>'roleAtCamp',''),coalesce(seed->>'highSchool',''),
   ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(seed->'colleges')='array' THEN seed->'colleges' ELSE '[]'::jsonb END)),
   ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(seed->'collegeYears')='array' THEN seed->'collegeYears' ELSE '[]'::jsonb END)),
   coalesce(seed->'currentJobs','[]'::jsonb),coalesce(seed->'pastJobs','[]'::jsonb),coalesce(seed->>'industry',''),
   (coalesce(seed->'socials','{}'::jsonb) - 'signupRecovery'),coalesce(seed->>'avatarUrl',''),coalesce(seed->>'bio',''),'active')
 RETURNING id INTO v_profile_id;
 UPDATE public.users SET profile_id=v_profile_id,updated_at=now() WHERE id=user_id;
 UPDATE public.access_requests SET status='approved',reviewed_at=now(),reviewed_by_user_id=p_actor,
   approved_user_id=user_id,updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'userId',user_id,'profileId',v_profile_id,'membershipId',membership_id,'requestId',r.id);
END $$;
REVOKE ALL ON FUNCTION public.approve_recovered_signup_review(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.approve_recovered_signup_review(text,text,text) TO service_role;

COMMIT;
