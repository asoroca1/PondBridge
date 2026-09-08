-- A director can approve a recovered verified signup before the person has
-- accepted current legal terms. This records the human decision without creating
-- any identity, user, membership, or profile until the same verified Clerk user
-- submits a complete agreement.
BEGIN;

ALTER TABLE public.access_requests
  ADD COLUMN IF NOT EXISTS director_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS director_approved_by_user_id text;
ALTER TABLE public.access_requests
  DROP CONSTRAINT IF EXISTS access_requests_director_preapproval_pair;
ALTER TABLE public.access_requests
  ADD CONSTRAINT access_requests_director_preapproval_pair CHECK (
    (director_approved_at IS NULL AND director_approved_by_user_id IS NULL)
    OR (director_approved_at IS NOT NULL AND nullif(btrim(director_approved_by_user_id),'') IS NOT NULL)
  );
CREATE INDEX IF NOT EXISTS idx_access_requests_preapproved_pending
  ON public.access_requests(tenant_id,director_approved_at)
  WHERE status='pending' AND director_approved_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.clear_access_request_preapproval_on_denial()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF NEW.status='denied' THEN
    NEW.director_approved_at := NULL;
    NEW.director_approved_by_user_id := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trigger_clear_access_request_preapproval_on_denial ON public.access_requests;
CREATE TRIGGER trigger_clear_access_request_preapproval_on_denial
BEFORE INSERT OR UPDATE OF status ON public.access_requests
FOR EACH ROW EXECUTE FUNCTION public.clear_access_request_preapproval_on_denial();

-- The same atomic activation function serves an immediate director approval and
-- the later consent completion of a committed preapproval. A committed decision
-- keeps its original attribution even if that director later leaves the camp.
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
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active') THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_APPROVAL_FORBIDDEN');
 END IF;
 SELECT * INTO r FROM public.access_requests WHERE id=p_request AND tenant_id=p_tenant FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending' THEN RETURN jsonb_build_object('ok',false,'code','ACCESS_REQUEST_CHANGED'); END IF;
 IF r.director_approved_at IS NOT NULL THEN
   IF r.director_approved_by_user_id IS DISTINCT FROM p_actor THEN
     RETURN jsonb_build_object('ok',false,'code','RECOVERY_APPROVAL_ATTRIBUTION_MISMATCH');
   END IF;
 ELSIF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND status='active'
     AND roles && ARRAY['tenant_admin','super_admin']::text[]
     AND (tenant_id=p_tenant OR 'super_admin'=ANY(roles))) THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_APPROVAL_FORBIDDEN');
 END IF;
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

CREATE OR REPLACE FUNCTION public.preapprove_recovered_signup_review(p_tenant text,p_request text,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.access_requests%ROWTYPE; seed jsonb; result jsonb;
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
 IF r.recovered_clerk_user_id IS NULL OR r.recovered_clerk_user_id !~ '^user_[A-Za-z0-9]+$'
   OR seed#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM r.recovered_clerk_user_id THEN
   RETURN jsonb_build_object('ok',false,'code','RECOVERY_PROVENANCE_REQUIRED');
 END IF;
 IF seed#>'{socials,legalAgreement,accepted}' IS NOT DISTINCT FROM 'true'::jsonb
   AND seed#>'{socials,legalAgreement,ageEligibilityConfirmed}' IS NOT DISTINCT FROM 'true'::jsonb THEN
   result := public.approve_recovered_signup_review(p_tenant,p_request,p_actor);
   IF coalesce((result->>'ok')::boolean,false) IS DISTINCT FROM true THEN RETURN result; END IF;
   RETURN result || jsonb_build_object('activated',true,'pendingApproval',false,'directorApproved',true);
 END IF;
 IF r.director_approved_at IS NOT NULL THEN
   RETURN jsonb_build_object('ok',true,'requestId',r.id,'awaitingConsent',true,'directorApproved',true,
     'directorApprovedAt',r.director_approved_at,'directorApprovedByUserId',r.director_approved_by_user_id);
 END IF;
 UPDATE public.access_requests SET director_approved_at=now(),director_approved_by_user_id=p_actor,updated_at=now()
   WHERE id=r.id RETURNING * INTO r;
 RETURN jsonb_build_object('ok',true,'requestId',r.id,'awaitingConsent',true,'directorApproved',true,
   'directorApprovedAt',r.director_approved_at,'directorApprovedByUserId',r.director_approved_by_user_id);
END $$;

-- Called only after the API has freshly verified the Clerk identity and primary
-- email. The submitted legal agreement and member activation commit together.
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

-- Extend the durable approval outbox with a separate, accurate preapproval phase.
CREATE OR REPLACE FUNCTION public.enqueue_access_approval_email()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE frozen_payload jsonb; frozen_fingerprint text; job_key text;
BEGIN
 IF NEW.status='pending' AND NEW.director_approved_at IS NOT NULL AND OLD.director_approved_at IS NULL THEN
   IF nullif(btrim(NEW.director_approved_by_user_id),'') IS NULL OR nullif(btrim(NEW.email),'') IS NULL
      OR nullif(btrim(NEW.recovered_clerk_user_id),'') IS NULL
      OR NEW.profile_payload#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM NEW.recovered_clerk_user_id THEN
     RAISE EXCEPTION 'Recovered preapproval requires verified provenance, reviewer, and recipient';
   END IF;
   frozen_payload := jsonb_build_object('version',1,'phase','consent_pending','requestId',NEW.id,
     'recoveredClerkUserId',NEW.recovered_clerk_user_id,'email',lower(btrim(NEW.email)),
     'firstName',coalesce(nullif(btrim(NEW.first_name),''),nullif(btrim(NEW.profile_payload->>'firstName'),''),''),
     'directorApprovedAt',NEW.director_approved_at);
   job_key := 'access-preapproval/' || NEW.id;
 ELSIF NEW.status IS NOT DISTINCT FROM 'approved' AND OLD.status IS DISTINCT FROM 'approved' THEN
   IF nullif(btrim(NEW.approved_user_id),'') IS NULL THEN RAISE EXCEPTION 'Approved access request requires approved_user_id'; END IF;
   IF nullif(btrim(NEW.email),'') IS NULL THEN RAISE EXCEPTION 'Approved access request requires recipient email'; END IF;
   IF nullif(btrim(NEW.reviewed_by_user_id),'') IS NULL THEN RETURN NEW; END IF;
   frozen_payload := jsonb_build_object('version',1,'phase','active','requestId',NEW.id,
     'approvedUserId',NEW.approved_user_id,'email',lower(btrim(NEW.email)),
     'firstName',coalesce(nullif(btrim(NEW.first_name),''),nullif(btrim(NEW.profile_payload->>'firstName'),''),''),
     'approvedAt',coalesce(NEW.reviewed_at,now()));
   job_key := 'access-approval/' || NEW.id;
 ELSE RETURN NEW;
 END IF;
 frozen_fingerprint := encode(extensions.digest(convert_to(frozen_payload::text,'UTF8'),'sha256'),'hex');
 INSERT INTO public.tenant_background_jobs(tenant_id,actor_user_id,kind,idempotency_key,fingerprint,request_fingerprint,payload,total,run_at)
 VALUES(NEW.tenant_id,coalesce(NEW.director_approved_by_user_id,NEW.reviewed_by_user_id),'approval_email',job_key,
   frozen_fingerprint,frozen_fingerprint,frozen_payload,1,now())
 ON CONFLICT(tenant_id,kind,idempotency_key) DO NOTHING;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trigger_enqueue_access_approval_email ON public.access_requests;
CREATE TRIGGER trigger_enqueue_access_approval_email
AFTER UPDATE OF status,approved_user_id,reviewed_by_user_id,director_approved_at,director_approved_by_user_id
ON public.access_requests FOR EACH ROW EXECUTE FUNCTION public.enqueue_access_approval_email();

REVOKE ALL ON FUNCTION public.clear_access_request_preapproval_on_denial() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.preapprove_recovered_signup_review(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.submit_recovered_signup_consent(text,text,text,text,jsonb,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_recovered_signup_review(text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.enqueue_access_approval_email() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preapprove_recovered_signup_review(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_recovered_signup_consent(text,text,text,text,jsonb,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_recovered_signup_review(text,text,text) TO service_role;

COMMIT;
