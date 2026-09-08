-- Approval notification intent is committed with the winning approval. Existing
-- approved rows are deliberately not backfilled because delivery already occurred.
BEGIN;

ALTER TABLE public.tenant_background_jobs
  DROP CONSTRAINT IF EXISTS tenant_background_jobs_kind_check;
ALTER TABLE public.tenant_background_jobs
  ADD CONSTRAINT tenant_background_jobs_kind_check
  CHECK (kind IN ('broadcast','invites','import','approval_email'));

CREATE OR REPLACE FUNCTION public.enqueue_access_approval_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  frozen_payload jsonb;
  frozen_fingerprint text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'approved' OR OLD.status IS NOT DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF nullif(btrim(NEW.approved_user_id),'') IS NULL THEN
    RAISE EXCEPTION 'Approved access request requires approved_user_id';
  END IF;
  IF nullif(btrim(NEW.email),'') IS NULL THEN
    RAISE EXCEPTION 'Approved access request requires recipient email';
  END IF;
  -- Gate-off auto-join records reviewed_by_user_id=NULL and needs no "approved"
  -- email because the member is already inside the product.
  IF nullif(btrim(NEW.reviewed_by_user_id),'') IS NULL THEN RETURN NEW; END IF;

  frozen_payload := jsonb_build_object(
    'version', 1,
    'requestId', NEW.id,
    'approvedUserId', NEW.approved_user_id,
    'email', lower(btrim(NEW.email)),
    'firstName', coalesce(nullif(btrim(NEW.first_name),''), nullif(btrim(NEW.profile_payload->>'firstName'),''), ''),
    'approvedAt', coalesce(NEW.reviewed_at, now())
  );
  frozen_fingerprint := encode(extensions.digest(convert_to(frozen_payload::text, 'UTF8'), 'sha256'), 'hex');

  INSERT INTO public.tenant_background_jobs(
    tenant_id, actor_user_id, kind, idempotency_key, fingerprint,
    request_fingerprint, payload, total, run_at
  ) VALUES (
    NEW.tenant_id, NEW.reviewed_by_user_id, 'approval_email',
    'access-approval/' || NEW.id, frozen_fingerprint, frozen_fingerprint,
    frozen_payload, 1, now()
  )
  ON CONFLICT (tenant_id, kind, idempotency_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enqueue_access_approval_email ON public.access_requests;
CREATE TRIGGER trigger_enqueue_access_approval_email
AFTER UPDATE OF status, approved_user_id, reviewed_by_user_id
ON public.access_requests
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_access_approval_email();

-- Essential account mail shares the global provider throttle with optional bulk
-- jobs, while p_include_optional=false leaves paused broadcasts untouched.
CREATE OR REPLACE FUNCTION public.claim_tenant_job_for_worker(p_include_optional boolean DEFAULT false)
RETURNS SETOF public.tenant_background_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE selected_id text;
BEGIN
  UPDATE public.tenant_background_jobs
  SET status=CASE WHEN status IN ('queued','running') THEN 'failed' ELSE status END,
      payload='{}',state=state-'prepared',lease_token=NULL,lease_until=NULL,
      last_error=CASE WHEN status IN ('queued','running') THEN 'JOB_EXPIRED' ELSE last_error END,
      updated_at=now()
  WHERE expires_at<=now() AND (status IN ('queued','running') OR payload<>'{}'::jsonb);

  UPDATE public.tenant_background_jobs
  SET status='failed',lease_token=NULL,lease_until=NULL,last_error='RETRY_LIMIT',updated_at=now()
  WHERE status='running' AND lease_until<now()
    AND attempts>=CASE WHEN kind='approval_email' THEN 15 ELSE 3 END;

  PERFORM 1 FROM public.tenant_job_dispatch_clock
  WHERE singleton AND last_claim_at<=now()-interval '1 second'
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT id INTO selected_id
  FROM public.tenant_background_jobs
  WHERE ((status='queued' AND run_at<=now()) OR (status='running' AND lease_until<now()))
    AND attempts<CASE WHEN kind='approval_email' THEN 15 ELSE 3 END
    AND (kind='approval_email' OR p_include_optional)
  ORDER BY CASE WHEN kind='approval_email' THEN 0 ELSE 1 END, run_at, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;
  IF selected_id IS NULL THEN RETURN; END IF;

  UPDATE public.tenant_job_dispatch_clock SET last_claim_at=now() WHERE singleton;
  RETURN QUERY
  UPDATE public.tenant_background_jobs
  SET status='running',attempts=attempts+1,lease_token=gen_random_uuid(),
      lease_until=now()+interval '90 seconds',updated_at=now()
  WHERE id=selected_id
  RETURNING *;
END;
$$;

-- Approval mail gets bounded retries over several hours; optional bulk work
-- keeps the existing three-attempt behavior.
CREATE OR REPLACE FUNCTION public.checkpoint_tenant_job(p_tenant text,p_id text,p_lease uuid,p_cursor integer,p_state jsonb,p_release boolean DEFAULT false,p_error text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job_kind text; attempt_count integer;
BEGIN
  IF octet_length(p_state::text)>6000000 THEN RAISE EXCEPTION 'Job state too large'; END IF;
  SELECT kind,attempts INTO job_kind,attempt_count FROM public.tenant_background_jobs
    WHERE tenant_id=p_tenant AND id=p_id AND status='running' AND lease_token=p_lease AND lease_until>now()
    FOR UPDATE;
  IF NOT FOUND OR p_cursor<0 THEN RETURN false; END IF;
  UPDATE public.tenant_background_jobs SET cursor=p_cursor,state=p_state,
    status=CASE WHEN p_error<>'' THEN CASE
      WHEN attempt_count>=CASE WHEN job_kind='approval_email' THEN 15 ELSE 3 END OR p_error LIKE 'PERMANENT:%' THEN 'failed'
      ELSE 'queued' END
      WHEN p_cursor=total AND p_release THEN 'succeeded' WHEN p_release THEN 'queued' ELSE 'running' END,
    payload=CASE WHEN p_cursor=total AND p_release THEN '{}'::jsonb ELSE payload END,
    lease_token=CASE WHEN p_release OR p_error<>'' THEN NULL ELSE lease_token END,
    lease_until=CASE WHEN p_release OR p_error<>'' THEN NULL ELSE now()+interval '90 seconds' END,
    attempts=CASE WHEN p_release AND p_error='' THEN 0 ELSE attempts END,
    run_at=CASE WHEN p_error<>'' AND job_kind='approval_email'
      THEN now()+make_interval(secs=>least(7200,30*(2^least(8,greatest(0,attempt_count-1)))))
      WHEN p_error<>'' THEN now()+make_interval(secs=>least(60,5*attempt_count*attempt_count)) ELSE now() END,
    last_error=p_error,updated_at=now()
    WHERE tenant_id=p_tenant AND id=p_id AND status='running' AND lease_token=p_lease AND lease_until>now()
      AND p_cursor>=cursor AND p_cursor<=total;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.approval_email_jobs_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$ SELECT true $$;

REVOKE ALL ON FUNCTION public.enqueue_access_approval_email() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_tenant_job_for_worker(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_tenant_job(text,text,uuid,integer,jsonb,boolean,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.approval_email_jobs_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tenant_job_for_worker(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_tenant_job(text,text,uuid,integer,jsonb,boolean,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.approval_email_jobs_ready() TO service_role;

COMMIT;
