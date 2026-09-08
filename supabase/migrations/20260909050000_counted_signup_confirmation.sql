-- Exact original GreenLane recovery cohort only. Inert until a reviewed manifest
-- is sealed and individual admissions are applied after all API instances gate it.
BEGIN;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS account_confirmation_request_id text;
CREATE INDEX idx_users_account_confirmation ON public.users(account_confirmation_request_id)
 WHERE account_confirmation_request_id IS NOT NULL;
CREATE TABLE public.counted_signup_manifest (
 tenant_id text PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='array'),
 fingerprint text NOT NULL, registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.counted_signup_cohort (
 request_id text PRIMARY KEY REFERENCES public.access_requests(id) ON DELETE CASCADE,
 tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 clerk_user_id text NOT NULL, verified_email text NOT NULL,
 director_approved_at timestamptz NOT NULL, director_user_id text NOT NULL,
 UNIQUE(tenant_id,clerk_user_id),
 registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.counted_signup_admissions (
 request_id text PRIMARY KEY REFERENCES public.counted_signup_cohort(request_id) ON DELETE CASCADE,
 tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id text NOT NULL, admitted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.counted_signup_confirmation_receipts (
 request_id text PRIMARY KEY REFERENCES public.counted_signup_cohort(request_id) ON DELETE CASCADE,
 tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 clerk_user_id text NOT NULL, agreement jsonb NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL DEFAULT 'authenticated_confirmation' CHECK(source='authenticated_confirmation')
);
ALTER TABLE public.counted_signup_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_admissions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_manifest FORCE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_cohort ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_cohort FORCE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_confirmation_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counted_signup_confirmation_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.counted_signup_manifest,public.counted_signup_cohort,public.counted_signup_admissions,public.counted_signup_confirmation_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.counted_signup_manifest,public.counted_signup_cohort,public.counted_signup_admissions,public.counted_signup_confirmation_receipts TO service_role;
CREATE POLICY counted_admissions_read ON public.counted_signup_admissions FOR SELECT TO service_role USING(true);
CREATE POLICY counted_manifest_read ON public.counted_signup_manifest FOR SELECT TO service_role USING(true);
CREATE POLICY counted_cohort_read ON public.counted_signup_cohort FOR SELECT TO service_role USING(true);
CREATE POLICY counted_receipt_read ON public.counted_signup_confirmation_receipts FOR SELECT TO service_role USING(true);

CREATE FUNCTION public.register_counted_signup_cohort(p_tenant text,p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entry jsonb; r public.access_requests%ROWTYPE; digest_value text; previous text; registered integer:=0; skipped integer:=0;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active')
  OR jsonb_typeof(p_manifest) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid cohort manifest'; END IF;
 IF jsonb_array_length(p_manifest)<1 OR jsonb_array_length(p_manifest)>43
  OR (SELECT count(DISTINCT v->>'requestId') FROM jsonb_array_elements(p_manifest) v)<>jsonb_array_length(p_manifest)
  OR (SELECT count(DISTINCT v->>'clerkUserId') FROM jsonb_array_elements(p_manifest) v)<>jsonb_array_length(p_manifest)
  OR (SELECT count(DISTINCT lower(v->>'email')) FROM jsonb_array_elements(p_manifest) v)<>jsonb_array_length(p_manifest)
 THEN RAISE EXCEPTION 'Invalid cohort manifest size or duplicate request'; END IF;
 -- Serialize registration so a second call cannot expand the first sealed list.
 PERFORM pg_advisory_xact_lock(hashtextextended('greenlane_counted_signup_manifest',0));
 digest_value:=encode(extensions.digest(convert_to(p_manifest::text,'UTF8'),'sha256'),'hex');
 SELECT fingerprint INTO previous FROM public.counted_signup_manifest WHERE tenant_id=p_tenant;
 IF FOUND THEN
  IF previous<>digest_value THEN RAISE EXCEPTION 'Cohort manifest already sealed'; END IF;
  RETURN jsonb_build_object('ok',true,'outcome','already_registered','fingerprint',previous);
 END IF;
 INSERT INTO public.counted_signup_manifest(tenant_id,manifest,fingerprint) VALUES(p_tenant,p_manifest,digest_value);
 FOR entry IN SELECT value FROM jsonb_array_elements(p_manifest) LOOP
  SELECT * INTO r FROM public.access_requests WHERE id=entry->>'requestId' AND tenant_id=p_tenant FOR UPDATE;
  IF NOT FOUND OR r.recovered_clerk_user_id IS DISTINCT FROM entry->>'clerkUserId'
   OR lower(r.email) IS DISTINCT FROM lower(entry->>'email')
   OR r.profile_payload#>>'{socials,signupRecovery,source}' IS DISTINCT FROM 'operator_repair'
   OR r.profile_payload#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM r.recovered_clerk_user_id
   OR r.recovered_clerk_user_id !~ '^user_[A-Za-z0-9]+$' THEN RAISE EXCEPTION 'Cohort provenance mismatch'; END IF;
  IF r.status<>'pending' OR r.director_approved_at IS NULL
   OR r.director_approved_at IS DISTINCT FROM (entry->>'directorApprovedAt')::timestamptz
   OR r.director_approved_by_user_id IS DISTINCT FROM entry->>'directorApprovedByUserId' THEN
    skipped:=skipped+1; CONTINUE;
  END IF;
  INSERT INTO public.counted_signup_cohort(request_id,tenant_id,clerk_user_id,verified_email,director_approved_at,director_user_id)
  VALUES(r.id,p_tenant,r.recovered_clerk_user_id,lower(r.email),r.director_approved_at,r.director_approved_by_user_id);
  registered:=registered+1;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'registered',registered,'skippedChanged',skipped,'fingerprint',digest_value);
END $$;

CREATE FUNCTION public.admit_counted_signup_account(p_tenant text,p_request text,p_clerk_user_id text,p_verified_email text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.access_requests%ROWTYPE; cohort public.counted_signup_cohort%ROWTYPE; identity_row public.identities%ROWTYPE;
 seed jsonb; clerk_id text; user_id text; identity_id text; membership_id text; v_profile_id text;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 SELECT * INTO cohort FROM public.counted_signup_cohort WHERE tenant_id=p_tenant AND request_id=p_request;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active')
  OR cohort.clerk_user_id IS DISTINCT FROM p_clerk_user_id OR cohort.verified_email IS DISTINCT FROM lower(btrim(p_verified_email))
 THEN RETURN jsonb_build_object('ok',false,'code','COUNTED_COHORT_FORBIDDEN'); END IF;
 SELECT * INTO r FROM public.access_requests WHERE id=p_request AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RETURN jsonb_build_object('ok',true,'outcome','skipped_changed'); END IF;
 IF r.director_approved_at IS DISTINCT FROM cohort.director_approved_at OR r.director_approved_by_user_id IS DISTINCT FROM cohort.director_user_id
  OR r.recovered_clerk_user_id IS DISTINCT FROM cohort.clerk_user_id OR lower(r.email) IS DISTINCT FROM cohort.verified_email
  OR r.profile_payload#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM cohort.clerk_user_id
 THEN RETURN jsonb_build_object('ok',true,'outcome','skipped_changed'); END IF;
 IF r.approved_user_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.counted_signup_admissions WHERE request_id=r.id) THEN
  IF EXISTS(SELECT 1 FROM public.users WHERE id=r.approved_user_id AND tenant_id=p_tenant AND status='active' AND account_confirmation_request_id=r.id) THEN
   RETURN jsonb_build_object('ok',true,'outcome','already_admitted','userId',r.approved_user_id);
  END IF;
  RETURN jsonb_build_object('ok',false,'code','COUNTED_ACCOUNT_CONFLICT');
 END IF;
 -- Normal consent won the race: use its ordinary activation, never re-gate it.
 seed:=coalesce(r.profile_payload,'{}'::jsonb); clerk_id:=r.recovered_clerk_user_id;
 IF seed#>'{socials,legalAgreement,accepted}'='true'::jsonb AND seed#>'{socials,legalAgreement,ageEligibilityConfirmed}'='true'::jsonb THEN
  RETURN public.approve_recovered_signup_review(p_tenant,p_request,r.director_approved_by_user_id);
 END IF;
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
 INSERT INTO public.users(tenant_id,clerk_user_id,email,password_hash,roles,status,account_confirmation_request_id)
 VALUES(p_tenant,clerk_id,lower(r.email),'clerk_managed',ARRAY['user'],'active',r.id) RETURNING id INTO user_id;
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
   (coalesce(seed->'socials','{}'::jsonb) - 'signupRecovery' - 'legalAgreement'),coalesce(seed->>'avatarUrl',''),coalesce(seed->>'bio',''),'active')
 RETURNING id INTO v_profile_id;
 UPDATE public.users SET profile_id=v_profile_id,updated_at=now() WHERE id=user_id;

 -- Pending status is only the existing final-consent/outbox state. Active profile
 -- and user make this person counted and visible; the authoritative user gate
 -- blocks all protected HTTP/socket access until actual agreement arrives.
 INSERT INTO public.counted_signup_admissions(request_id,tenant_id,user_id) VALUES(r.id,p_tenant,user_id);
 UPDATE public.access_requests SET approved_user_id=user_id,updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'outcome','admitted','requestId',r.id,'userId',user_id,'profileId',v_profile_id);
END $$;

CREATE FUNCTION public.confirm_counted_signup_account(p_tenant text,p_user text,p_clerk_user_id text,p_verified_email text,p_agreement jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u public.users%ROWTYPE; r public.access_requests%ROWTYPE; c public.counted_signup_cohort%ROWTYPE; claimed_at timestamptz; payload jsonb; prior jsonb;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 -- Always lock request first, matching admission, denial and normal consent.
 SELECT * INTO c FROM public.counted_signup_cohort WHERE tenant_id=p_tenant AND clerk_user_id=p_clerk_user_id;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active') THEN RETURN jsonb_build_object('ok',false,'code','COUNTED_COHORT_FORBIDDEN'); END IF;
 SELECT * INTO r FROM public.access_requests WHERE id=c.request_id AND tenant_id=p_tenant FOR UPDATE;
 SELECT * INTO u FROM public.users WHERE id=p_user AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR u.status<>'active' OR u.clerk_user_id IS DISTINCT FROM c.clerk_user_id
  OR lower(u.email) IS DISTINCT FROM c.verified_email OR lower(btrim(p_verified_email)) IS DISTINCT FROM c.verified_email
  OR r.approved_user_id IS DISTINCT FROM u.id OR r.recovered_clerk_user_id IS DISTINCT FROM c.clerk_user_id
  OR lower(r.email) IS DISTINCT FROM c.verified_email THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_CONFIRMATION_IDENTITY_MISMATCH'); END IF;
 PERFORM 1 FROM public.tenant_memberships WHERE tenant_id=p_tenant AND legacy_user_id=u.id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_CONFIRMATION_REVOKED'); END IF;
 SELECT agreement INTO prior FROM public.counted_signup_confirmation_receipts WHERE request_id=c.request_id;
 IF FOUND AND r.status='approved' AND u.account_confirmation_request_id IS NULL THEN
  RETURN jsonb_build_object('ok',true,'confirmed',true,'alreadyConfirmed',true,'activated',true);
 END IF;
 IF r.status<>'pending' OR u.account_confirmation_request_id IS DISTINCT FROM r.id
  OR r.director_approved_at IS DISTINCT FROM c.director_approved_at OR r.director_approved_by_user_id IS DISTINCT FROM c.director_user_id
 THEN RETURN jsonb_build_object('ok',false,'code','ACCOUNT_CONFIRMATION_CHANGED'); END IF;
 IF jsonb_typeof(p_agreement) IS DISTINCT FROM 'object' OR octet_length(p_agreement::text)>2000
  OR p_agreement->'version' IS DISTINCT FROM '1'::jsonb
  OR p_agreement->'accepted' IS DISTINCT FROM 'true'::jsonb OR p_agreement->'ageEligibilityConfirmed' IS DISTINCT FROM 'true'::jsonb
  OR p_agreement->>'termsVersion' IS DISTINCT FROM '2026-03-04' OR p_agreement->>'privacyVersion' IS DISTINCT FROM '2026-03-04'
  OR p_agreement->>'agePolicyVersion' IS DISTINCT FROM '2026-07-14' OR p_agreement->'minimumAge' IS DISTINCT FROM '14'::jsonb
  OR jsonb_typeof(p_agreement->'acceptedAt') IS DISTINCT FROM 'string'
  OR coalesce(p_agreement->>'acceptedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$'
 THEN RETURN jsonb_build_object('ok',false,'code','LEGAL_AGREEMENT_REQUIRED'); END IF;
 BEGIN claimed_at:=(p_agreement->>'acceptedAt')::timestamptz;
 EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('ok',false,'code','LEGAL_AGREEMENT_REQUIRED'); END;
 IF claimed_at<'2026-07-14T00:00:00Z'::timestamptz OR claimed_at>now()+interval '5 minutes' THEN
  RETURN jsonb_build_object('ok',false,'code','LEGAL_AGREEMENT_REQUIRED'); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_agreement) k WHERE k NOT IN ('version','accepted','ageEligibilityConfirmed','termsVersion','privacyVersion','agePolicyVersion','minimumAge','acceptedAt')) THEN
  RETURN jsonb_build_object('ok',false,'code','LEGAL_AGREEMENT_REQUIRED'); END IF;
 INSERT INTO public.counted_signup_confirmation_receipts(request_id,tenant_id,user_id,clerk_user_id,agreement)
 VALUES(r.id,p_tenant,u.id,c.clerk_user_id,p_agreement - 'version');
 payload:=coalesce(r.profile_payload,'{}'::jsonb);
 payload:=jsonb_set(payload,'{socials}',coalesce(payload->'socials','{}'::jsonb),true);
 payload:=jsonb_set(payload,'{socials,legalAgreement}',p_agreement - 'version',true);
 payload:=jsonb_set(payload,'{socials,signupRecovery,requiresConsent}','false'::jsonb,true);
 UPDATE public.profiles SET socials=jsonb_set(coalesce(socials,'{}'::jsonb),'{legalAgreement}',p_agreement - 'version',true),updated_at=now()
 WHERE user_id=u.id AND tenant_id=p_tenant AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'Active counted profile required'; END IF;
 UPDATE public.users SET account_confirmation_request_id=NULL,updated_at=now() WHERE id=u.id;
 UPDATE public.access_requests SET status='approved',profile_payload=payload,reviewed_at=now(),reviewed_by_user_id=c.director_user_id,updated_at=now() WHERE id=r.id;
 RETURN jsonb_build_object('ok',true,'confirmed',true,'activated',true,'userId',u.id,'requestId',r.id);
END $$;
CREATE OR REPLACE FUNCTION public.submit_recovered_signup_consent(
 p_tenant text,p_request text,p_clerk_user_id text,p_verified_email text,p_profile_payload jsonb,
 p_first_name text,p_last_name text,p_self_reported_role text,p_request_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.access_requests%ROWTYPE; submitted jsonb; recovery jsonb; result jsonb;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 SELECT * INTO r FROM public.access_requests WHERE id=p_request AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN
   RETURN jsonb_build_object('ok',false,'code','ACCESS_REQUEST_CHANGED');
 END IF;
 IF r.recovered_clerk_user_id IS DISTINCT FROM nullif(btrim(p_clerk_user_id),'')
   OR lower(r.email) IS DISTINCT FROM lower(btrim(p_verified_email))
   OR r.profile_payload#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM r.recovered_clerk_user_id THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_IDENTITY_CHANGED');
 END IF;
 IF EXISTS(SELECT 1 FROM public.counted_signup_admissions WHERE request_id=r.id AND tenant_id=p_tenant) THEN
   -- Historical request legalAgreement objects have no envelope version. Supply
   -- only that format marker; preserve/revalidate every actual agreement field
   -- and any explicit version (an incompatible version must still fail).
   RETURN public.confirm_counted_signup_account(p_tenant,(SELECT user_id FROM public.counted_signup_admissions WHERE request_id=r.id),p_clerk_user_id,p_verified_email,
     jsonb_build_object('version',1) || (p_profile_payload#>'{socials,legalAgreement}'));
 END IF;
 submitted := coalesce(p_profile_payload,'{}'::jsonb);
 IF octet_length(submitted::text)>250000
   OR submitted#>'{socials,legalAgreement,accepted}' IS DISTINCT FROM 'true'::jsonb
   OR submitted#>'{socials,legalAgreement,ageEligibilityConfirmed}' IS DISTINCT FROM 'true'::jsonb THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERED_SIGNUP_CONSENT_REQUIRED');
 END IF;
 recovery := jsonb_set(coalesce(r.profile_payload#>'{socials,signupRecovery}','{}'::jsonb),'{requiresConsent}','false'::jsonb,true);
 submitted := jsonb_set(submitted,'{socials}',coalesce(submitted->'socials','{}'::jsonb) - 'signupRecovery',true);
 submitted := jsonb_set(submitted,'{socials,signupRecovery}',recovery,true);
 UPDATE public.access_requests SET
   first_name=left(coalesce(p_first_name,''),100),last_name=left(coalesce(p_last_name,''),100),
   self_reported_role=left(coalesce(p_self_reported_role,''),160),
   request_message=left(coalesce(p_request_message,''),2000),profile_payload=submitted,updated_at=now()
   WHERE id=r.id;
 IF r.director_approved_at IS NULL OR r.director_approved_by_user_id IS NULL THEN
   RETURN jsonb_build_object('ok',true,'requestId',r.id,'activated',false,'pendingApproval',true,'directorApproved',false);
 END IF;
 result := public.approve_recovered_signup_review(p_tenant,p_request,r.director_approved_by_user_id);
 IF coalesce((result->>'ok')::boolean,false) IS DISTINCT FROM true THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Recovered signup activation failed',DETAIL=coalesce(result->>'code','RECOVERY_FINALIZATION_FAILED');
 END IF;
 RETURN result || jsonb_build_object('activated',true,'pendingApproval',false,'directorApproved',true);
END $$;
CREATE FUNCTION public.revoke_counted_signup_on_denial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status='denied' AND OLD.status='pending' AND OLD.approved_user_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.counted_signup_cohort WHERE request_id=OLD.id) THEN
  UPDATE public.users SET status='inactive',updated_at=now() WHERE id=OLD.approved_user_id AND account_confirmation_request_id=OLD.id;
  UPDATE public.profiles SET status='removed',updated_at=now() WHERE user_id=OLD.approved_user_id AND tenant_id=OLD.tenant_id;
  UPDATE public.tenant_memberships SET status='inactive',updated_at=now() WHERE legacy_user_id=OLD.approved_user_id AND tenant_id=OLD.tenant_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trigger_revoke_counted_signup_on_denial AFTER UPDATE OF status ON public.access_requests
 FOR EACH ROW EXECUTE FUNCTION public.revoke_counted_signup_on_denial();
REVOKE ALL ON FUNCTION public.register_counted_signup_cohort(text,jsonb),public.admit_counted_signup_account(text,text,text,text),public.confirm_counted_signup_account(text,text,text,text,jsonb),public.revoke_counted_signup_on_denial() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_counted_signup_cohort(text,jsonb),public.admit_counted_signup_account(text,text,text,text),public.confirm_counted_signup_account(text,text,text,text,jsonb) TO service_role;
COMMIT;
