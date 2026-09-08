-- Service-only durable work. Payloads may contain recipient PII, never auth codes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.tenant_background_jobs (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('broadcast','invites','import')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 200),
  fingerprint text NOT NULL,
  request_fingerprint text NOT NULL DEFAULT '',
  payload jsonb NOT NULL,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  total integer NOT NULL CHECK (total BETWEEN 1 AND 5000),
  cursor integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  lease_token uuid,
  lease_until timestamptz,
  run_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '23 hours',
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, idempotency_key),
  CHECK (cursor BETWEEN 0 AND total)
);
CREATE INDEX IF NOT EXISTS idx_tenant_jobs_due ON public.tenant_background_jobs(status,run_at,created_at);
CREATE INDEX IF NOT EXISTS idx_tenant_jobs_scope ON public.tenant_background_jobs(tenant_id,created_at DESC);
ALTER TABLE public.tenant_background_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_background_jobs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tenant_background_jobs TO service_role;
CREATE TABLE IF NOT EXISTS public.tenant_job_dispatch_clock (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), last_claim_at timestamptz NOT NULL DEFAULT '-infinity'
);
INSERT INTO public.tenant_job_dispatch_clock(singleton) VALUES(true) ON CONFLICT DO NOTHING;
ALTER TABLE public.tenant_job_dispatch_clock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_job_dispatch_clock FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.tenant_job_dispatch_clock TO service_role;

CREATE OR REPLACE FUNCTION public.enqueue_tenant_job(p_tenant text,p_actor text,p_kind text,p_key text,p_fingerprint text,p_payload jsonb,p_total integer,p_run_at timestamptz DEFAULT now())
RETURNS public.tenant_background_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE result public.tenant_background_jobs;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_actor AND u.status='active'
    AND ((u.tenant_id=p_tenant AND 'tenant_admin'=ANY(u.roles)) OR 'super_admin'=ANY(u.roles))) THEN
    RAISE EXCEPTION 'Job actor is not authorized for this tenant' USING ERRCODE='42501';
  END IF;
  IF octet_length(p_payload::text)>2097152 THEN RAISE EXCEPTION 'Job payload too large'; END IF;
  INSERT INTO public.tenant_background_jobs(tenant_id,actor_user_id,kind,idempotency_key,fingerprint,request_fingerprint,payload,total,run_at)
  VALUES(p_tenant,p_actor,p_kind,p_key,p_fingerprint,coalesce(p_payload->>'requestFingerprint',''),p_payload,p_total,greatest(now(),p_run_at))
  ON CONFLICT (tenant_id,kind,idempotency_key) DO NOTHING;
  SELECT * INTO STRICT result FROM public.tenant_background_jobs WHERE tenant_id=p_tenant AND kind=p_kind AND idempotency_key=p_key;
  IF result.fingerprint<>p_fingerprint OR result.actor_user_id<>p_actor THEN
    RAISE EXCEPTION 'Idempotency key already used for different work' USING ERRCODE='22023';
  END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.claim_tenant_job()
RETURNS SETOF public.tenant_background_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE selected_id text;
BEGIN
  -- Expiration is shorter than Resend's idempotency window. Never retry an
  -- uncertain email after that protection may have expired; scrub the payload.
  UPDATE public.tenant_background_jobs SET status=CASE WHEN status IN ('queued','running') THEN 'failed' ELSE status END,
    payload='{}',state=state-'prepared',lease_token=NULL,lease_until=NULL,
    last_error=CASE WHEN status IN ('queued','running') THEN 'JOB_EXPIRED' ELSE last_error END,updated_at=now()
    WHERE expires_at<=now() AND (status IN ('queued','running') OR payload<>'{}'::jsonb);
  UPDATE public.tenant_background_jobs SET status='failed',lease_token=NULL,lease_until=NULL,last_error='RETRY_LIMIT',updated_at=now()
    WHERE status='running' AND lease_until<now() AND attempts>=3;
  -- Across API replicas, bulk starts at most once per second, leaving capacity
  -- for essential account mail, which never waits behind this queue.
  PERFORM 1 FROM public.tenant_job_dispatch_clock WHERE singleton AND last_claim_at<=now()-interval '1 second' FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT id INTO selected_id FROM public.tenant_background_jobs
    WHERE ((status='queued' AND run_at<=now()) OR (status='running' AND lease_until<now()))
      AND attempts<3 AND expires_at>now()
    ORDER BY run_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF selected_id IS NULL THEN RETURN; END IF;
  UPDATE public.tenant_job_dispatch_clock SET last_claim_at=now() WHERE singleton;
  RETURN QUERY UPDATE public.tenant_background_jobs SET status='running',attempts=attempts+1,
    lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now()
    WHERE id=selected_id RETURNING *;
END $$;

CREATE OR REPLACE FUNCTION public.checkpoint_tenant_job(p_tenant text,p_id text,p_lease uuid,p_cursor integer,p_state jsonb,p_release boolean DEFAULT false,p_error text DEFAULT '')
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  IF octet_length(p_state::text)>6000000 THEN RAISE EXCEPTION 'Job state too large'; END IF;
  UPDATE public.tenant_background_jobs SET cursor=p_cursor,state=p_state,
    status=CASE WHEN p_error<>'' THEN CASE WHEN attempts>=3 OR p_error LIKE 'PERMANENT:%' THEN 'failed' ELSE 'queued' END
      WHEN p_cursor=total AND p_release THEN 'succeeded' WHEN p_release THEN 'queued' ELSE 'running' END,
    payload=CASE WHEN p_cursor=total AND p_release THEN '{}'::jsonb ELSE payload END,
    lease_token=CASE WHEN p_release OR p_error<>'' THEN NULL ELSE lease_token END,
    lease_until=CASE WHEN p_release OR p_error<>'' THEN NULL ELSE now()+interval '90 seconds' END,
    attempts=CASE WHEN p_release AND p_error='' THEN 0 ELSE attempts END,
    run_at=CASE WHEN p_error<>'' THEN now()+make_interval(secs=>least(60,5*attempts*attempts)) ELSE now() END,
    last_error=p_error,updated_at=now()
    WHERE tenant_id=p_tenant AND id=p_id AND status='running' AND lease_token=p_lease AND lease_until>now()
      AND p_cursor>=cursor AND p_cursor<=total;
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public.heartbeat_tenant_job(p_tenant text,p_id text,p_lease uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
  UPDATE public.tenant_background_jobs SET lease_until=now()+interval '90 seconds'
  WHERE tenant_id=p_tenant AND id=p_id AND status='running' AND lease_token=p_lease AND lease_until>now() AND expires_at>now();
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.heartbeat_tenant_job(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.heartbeat_tenant_job(text,text,uuid) TO service_role;

REVOKE ALL ON FUNCTION public.enqueue_tenant_job(text,text,text,text,text,jsonb,integer,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.claim_tenant_job() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.checkpoint_tenant_job(text,text,uuid,integer,jsonb,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_tenant_job(text,text,text,text,text,jsonb,integer,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_tenant_job() TO service_role;
GRANT EXECUTE ON FUNCTION public.checkpoint_tenant_job(text,text,uuid,integer,jsonb,boolean,text) TO service_role;
COMMIT;
