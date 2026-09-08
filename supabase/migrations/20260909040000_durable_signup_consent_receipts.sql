-- A receipt records the verified user's explicit self-attestation and when the
-- server observed it. It is not verified-age evidence or a director decision.
BEGIN;
CREATE TABLE public.signup_consent_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 clerk_user_id text NOT NULL CHECK(clerk_user_id ~ '^user_[A-Za-z0-9]+$'),
 schema_version integer NOT NULL CHECK(schema_version=1),
 terms_version text NOT NULL,
 privacy_version text NOT NULL,
 age_policy_version text NOT NULL,
 minimum_age integer NOT NULL CHECK(minimum_age=14),
 claimed_accepted_at timestamptz NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT now(),
 source text NOT NULL CHECK(source='clerk_signup_metadata'),
 agreement jsonb NOT NULL CHECK(jsonb_typeof(agreement)='object'),
 UNIQUE(tenant_id,clerk_user_id,schema_version,terms_version,privacy_version,age_policy_version)
);
ALTER TABLE public.signup_consent_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signup_consent_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.signup_consent_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.signup_consent_receipts TO service_role;
CREATE POLICY signup_consent_receipts_service_read ON public.signup_consent_receipts
 FOR SELECT TO service_role USING(true);
-- No direct application INSERT/UPDATE/DELETE permission. Only the validating
-- service-only function appends; tenant erasure cascades through the FK.
CREATE OR REPLACE FUNCTION public.ingest_verified_signup_consent_receipt(
 p_tenant text,p_request text,p_clerk_user_id text,p_verified_email text,p_policy jsonb,p_agreement jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 r public.access_requests%ROWTYPE;
 receipt public.signup_consent_receipts%ROWTYPE;
 claimed_at timestamptz;
 payload jsonb;
 result jsonb;
 inserted boolean := false;
 consent_complete boolean;
BEGIN
 PERFORM set_config('lock_timeout','3s',true);
 -- Prevent a newer API from restoring an old-policy receipt while a required
 -- policy migration is missing, including the metadata-absent replay path.
 IF p_policy IS DISTINCT FROM '{"version":1,"termsVersion":"2026-03-04","privacyVersion":"2026-03-04","agePolicyVersion":"2026-07-14","minimumAge":14}'::jsonb THEN
   RAISE EXCEPTION 'Consent policy version mismatch' USING ERRCODE='P0001';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND slug='greenlane' AND status='active') THEN
   RETURN jsonb_build_object('outcome','ineligible_request');
 END IF;
 SELECT * INTO r FROM public.access_requests WHERE tenant_id=p_tenant AND id=p_request FOR UPDATE;
 IF NOT FOUND OR r.status<>'pending'
   OR p_clerk_user_id IS NULL OR p_clerk_user_id !~ '^user_[A-Za-z0-9]+$'
   OR r.recovered_clerk_user_id IS DISTINCT FROM p_clerk_user_id
   OR lower(btrim(r.email)) IS DISTINCT FROM lower(btrim(p_verified_email))
   OR r.profile_payload#>>'{socials,signupRecovery,clerkUserId}' IS DISTINCT FROM p_clerk_user_id THEN
   RETURN jsonb_build_object('outcome','ineligible_request');
 END IF;
 SELECT * INTO receipt FROM public.signup_consent_receipts
 WHERE tenant_id=p_tenant AND clerk_user_id=p_clerk_user_id AND schema_version=1
   AND terms_version='2026-03-04' AND privacy_version='2026-03-04' AND age_policy_version='2026-07-14';
 IF NOT FOUND THEN
   IF p_agreement IS NULL THEN RETURN jsonb_build_object('outcome','no_receipt'); END IF;
   IF jsonb_typeof(p_agreement) IS DISTINCT FROM 'object'
     OR p_agreement->'version' IS DISTINCT FROM '1'::jsonb
     OR p_agreement->'accepted' IS DISTINCT FROM 'true'::jsonb
     OR p_agreement->'ageEligibilityConfirmed' IS DISTINCT FROM 'true'::jsonb
     OR p_agreement->>'termsVersion' IS DISTINCT FROM '2026-03-04'
     OR p_agreement->>'privacyVersion' IS DISTINCT FROM '2026-03-04'
     OR p_agreement->>'agePolicyVersion' IS DISTINCT FROM '2026-07-14'
     OR p_agreement->'minimumAge' IS DISTINCT FROM '14'::jsonb
     OR jsonb_typeof(p_agreement->'acceptedAt') IS DISTINCT FROM 'string'
     OR coalesce(p_agreement->>'acceptedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$' THEN
     RETURN jsonb_build_object('outcome','invalid_receipt');
   END IF;
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_agreement) k
      WHERE k NOT IN ('version','accepted','ageEligibilityConfirmed','termsVersion','privacyVersion','agePolicyVersion','minimumAge','acceptedAt')) THEN
     RETURN jsonb_build_object('outcome','invalid_receipt');
   END IF;
   BEGIN claimed_at := (p_agreement->>'acceptedAt')::timestamptz;
   EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
     RETURN jsonb_build_object('outcome','invalid_receipt');
   END;
   IF claimed_at<'2026-07-14T00:00:00Z'::timestamptz OR claimed_at>now()+interval '5 minutes' THEN
     RETURN jsonb_build_object('outcome','invalid_receipt');
   END IF;
   INSERT INTO public.signup_consent_receipts(tenant_id,clerk_user_id,schema_version,terms_version,privacy_version,
     age_policy_version,minimum_age,claimed_accepted_at,source,agreement)
   VALUES(p_tenant,p_clerk_user_id,1,'2026-03-04','2026-03-04','2026-07-14',14,claimed_at,'clerk_signup_metadata',p_agreement)
   ON CONFLICT(tenant_id,clerk_user_id,schema_version,terms_version,privacy_version,age_policy_version) DO NOTHING
   RETURNING * INTO receipt;
   inserted := FOUND;
   IF NOT inserted THEN
     SELECT * INTO STRICT receipt FROM public.signup_consent_receipts
     WHERE tenant_id=p_tenant AND clerk_user_id=p_clerk_user_id AND schema_version=1
       AND terms_version='2026-03-04' AND privacy_version='2026-03-04' AND age_policy_version='2026-07-14';
   END IF;
 END IF;
 -- Keep a genuine agreement already on the request unchanged. The new ledger
 -- receipt can coexist as independently observed evidence for the same policy.
 consent_complete := coalesce(r.profile_payload#>'{socials,legalAgreement,accepted}'='true'::jsonb
    AND r.profile_payload#>'{socials,legalAgreement,ageEligibilityConfirmed}'='true'::jsonb
    AND r.profile_payload#>>'{socials,legalAgreement,termsVersion}'='2026-03-04'
    AND r.profile_payload#>>'{socials,legalAgreement,privacyVersion}'='2026-03-04'
    AND r.profile_payload#>>'{socials,legalAgreement,agePolicyVersion}'='2026-07-14'
    AND r.profile_payload#>'{socials,legalAgreement,minimumAge}'='14'::jsonb,false);
 IF consent_complete AND r.director_approved_at IS NULL THEN
   RETURN jsonb_build_object('outcome',CASE WHEN inserted THEN 'recorded' ELSE 'existing_receipt' END,
     'receiptId',receipt.id,'activated',false);
 END IF;
 payload := coalesce(r.profile_payload,'{}'::jsonb);
 payload := jsonb_set(payload,'{socials}',coalesce(payload->'socials','{}'::jsonb),true);
 IF NOT consent_complete THEN
   payload := jsonb_set(payload,'{socials,legalAgreement}',receipt.agreement - 'version',true);
 END IF;
 result := public.submit_recovered_signup_consent(p_tenant,p_request,p_clerk_user_id,p_verified_email,
   payload,r.first_name,r.last_name,r.self_reported_role,r.request_message);
 IF coalesce((result->>'ok')::boolean,false) IS DISTINCT FROM true THEN
   RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='Consent receipt application failed',DETAIL=coalesce(result->>'code','CONSENT_RECEIPT_APPLICATION_FAILED');
 END IF;
 RETURN jsonb_build_object('outcome',CASE WHEN inserted THEN 'recorded' ELSE 'existing_receipt' END,
   'receiptId',receipt.id,'activated',coalesce((result->>'activated')::boolean,false));
END $$;
REVOKE ALL ON FUNCTION public.ingest_verified_signup_consent_receipt(text,text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_verified_signup_consent_receipt(text,text,text,text,jsonb,jsonb) TO service_role;
COMMIT;
