BEGIN;

-- Durable, tenant-scoped ledger for every billable AI generation. Raw prompts
-- and generated content are intentionally excluded; the application stores
-- hashes, byte counts, provider metadata, token usage, and estimated cost.
CREATE TABLE IF NOT EXISTS public.ai_generations (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  feature_key text NOT NULL
    CHECK (feature_key ~ '^[a-z][a-z0-9_]{2,80}$'),
  resource_type text NOT NULL DEFAULT '',
  resource_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'started'
    CHECK (status IN ('started', 'succeeded', 'failed')),
  provider text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  prompt_version text NOT NULL DEFAULT '',
  request_hash text NOT NULL DEFAULT '',
  request_bytes integer NOT NULL DEFAULT 0 CHECK (request_bytes >= 0),
  response_hash text NOT NULL DEFAULT '',
  response_bytes integer NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens integer NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  estimated_cost_microusd bigint
    CHECK (estimated_cost_microusd IS NULL OR estimated_cost_microusd >= 0),
  pricing_version text NOT NULL DEFAULT '',
  provider_request_id text NOT NULL DEFAULT '',
  error_code text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_generations_tenant_feature
  ON public.ai_generations (tenant_id, feature_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generations_tenant_status
  ON public.ai_generations (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_generations_resource
  ON public.ai_generations (tenant_id, resource_type, resource_id)
  WHERE resource_id <> '';

-- Local source of truth for camp-scoped marketing preferences. Delivery
-- failures remain in email_suppressions; this table represents recipient
-- choice and therefore must never be lifted by a director.
CREATE TABLE IF NOT EXISTS public.email_preferences (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  topic_key text NOT NULL DEFAULT 'community_updates'
    CHECK (topic_key ~ '^[a-z][a-z0-9_]{2,80}$'),
  status text NOT NULL DEFAULT 'subscribed'
    CHECK (status IN ('subscribed', 'unsubscribed')),
  source text NOT NULL DEFAULT 'recipient',
  unsubscribed_at timestamptz,
  resubscribed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_preferences_tenant_email_topic
  ON public.email_preferences (tenant_id, public.lower_immutable(email), topic_key);
CREATE INDEX IF NOT EXISTS idx_email_preferences_tenant_status
  ON public.email_preferences (tenant_id, status, updated_at DESC);

-- Durable pre-member alumni directory. Account credentials and member profile
-- data remain in their existing tables; direct client access stays disabled.
CREATE TABLE IF NOT EXISTS public.alumni_contacts (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  email text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'director_entry',
  contact_status text NOT NULL DEFAULT 'active'
    CHECK (contact_status IN ('active', 'do_not_contact', 'archived')),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  camp_years jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  last_invited_at timestamptz,
  invite_count integer NOT NULL DEFAULT 0 CHECK (invite_count >= 0),
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_alumni_contacts_tenant_email
  ON public.alumni_contacts (tenant_id, public.lower_immutable(email));
CREATE INDEX IF NOT EXISTS idx_alumni_contacts_tenant_status
  ON public.alumni_contacts (tenant_id, contact_status, updated_at DESC);

-- Additive broadcast fields used by the new communications workspace. The
-- existing delivery lifecycle remains compatible during staged rollout.
ALTER TABLE public.email_broadcasts
  ADD COLUMN IF NOT EXISTS preheader text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS campaign_type text NOT NULL DEFAULT 'marketing',
  ADD COLUMN IF NOT EXISTS ai_generation_id text REFERENCES public.ai_generations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS compliance_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.email_broadcasts
  DROP CONSTRAINT IF EXISTS email_broadcasts_campaign_type_check;
ALTER TABLE public.email_broadcasts
  ADD CONSTRAINT email_broadcasts_campaign_type_check
  CHECK (campaign_type IN ('marketing', 'transactional'));

CREATE INDEX IF NOT EXISTS idx_email_broadcasts_tenant_campaign
  ON public.email_broadcasts (tenant_id, campaign_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_broadcasts_ai_generation
  ON public.email_broadcasts (ai_generation_id)
  WHERE ai_generation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ai_usage_summary(
  p_tenant_id text,
  p_feature_key text DEFAULT NULL,
  p_since timestamptz DEFAULT date_trunc('month', now())
)
RETURNS TABLE (
  generation_count bigint,
  input_tokens bigint,
  cached_input_tokens bigint,
  output_tokens bigint,
  total_tokens bigint,
  estimated_cost_microusd bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT
    count(*) FILTER (WHERE status = 'succeeded')::bigint,
    coalesce(sum(input_tokens) FILTER (WHERE status = 'succeeded'), 0)::bigint,
    coalesce(sum(cached_input_tokens) FILTER (WHERE status = 'succeeded'), 0)::bigint,
    coalesce(sum(output_tokens) FILTER (WHERE status = 'succeeded'), 0)::bigint,
    coalesce(sum(total_tokens) FILTER (WHERE status = 'succeeded'), 0)::bigint,
    coalesce(sum(estimated_cost_microusd) FILTER (WHERE status = 'succeeded'), 0)::bigint
  FROM public.ai_generations
  WHERE tenant_id = p_tenant_id
    AND created_at >= p_since
    AND (p_feature_key IS NULL OR feature_key = p_feature_key);
$$;

REVOKE ALL ON FUNCTION public.ai_usage_summary(text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(text, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql
SET search_path = pg_catalog;

DROP TRIGGER IF EXISTS set_updated_at ON public.ai_generations;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.ai_generations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.email_preferences;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.email_preferences
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.alumni_contacts;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.alumni_contacts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE public.ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_generations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.alumni_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alumni_contacts FORCE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.ai_generations, public.email_preferences, public.alumni_contacts
  TO service_role;
REVOKE ALL
  ON public.ai_generations, public.email_preferences, public.alumni_contacts
  FROM anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'ai_generations'
      AND policyname = 'ai_generations_service_role_all'
  ) THEN
    CREATE POLICY ai_generations_service_role_all
      ON public.ai_generations FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'email_preferences'
      AND policyname = 'email_preferences_service_role_all'
  ) THEN
    CREATE POLICY email_preferences_service_role_all
      ON public.email_preferences FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'alumni_contacts'
      AND policyname = 'alumni_contacts_service_role_all'
  ) THEN
    CREATE POLICY alumni_contacts_service_role_all
      ON public.alumni_contacts FOR ALL TO service_role
      USING (true) WITH CHECK (true);
  END IF;
END;
$$;

COMMIT;
