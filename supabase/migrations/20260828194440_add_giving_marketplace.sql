BEGIN;

CREATE TABLE IF NOT EXISTS public.giving_causes (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  short_description text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  why_it_matters text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'other'
    CHECK (category IN ('camperships', 'facilities', 'traditions', 'programs', 'memorial', 'other')),
  cover_image_url text NOT NULL DEFAULT '',
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_profile_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  creator_name text NOT NULL DEFAULT '',
  creator_affiliation text NOT NULL DEFAULT '',
  origin text NOT NULL DEFAULT 'alumni_led'
    CHECK (origin IN ('official', 'alumni_led')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'changes_requested', 'active', 'completed', 'rejected', 'archived')),
  review_note text NOT NULL DEFAULT '',
  approved_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  goal_amount_cents bigint NOT NULL DEFAULT 0 CHECK (goal_amount_cents >= 0),
  amount_raised_cents bigint NOT NULL DEFAULT 0 CHECK (amount_raised_cents >= 0),
  donor_count integer NOT NULL DEFAULT 0 CHECK (donor_count >= 0),
  featured boolean NOT NULL DEFAULT false,
  fundraising_open boolean NOT NULL DEFAULT true,
  is_general_fund boolean NOT NULL DEFAULT false,
  charity_designation_id text NOT NULL DEFAULT '',
  external_checkout_url text NOT NULL DEFAULT '',
  start_date date,
  end_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_giving_causes_one_general_fund
  ON public.giving_causes (tenant_id)
  WHERE is_general_fund;
CREATE INDEX IF NOT EXISTS idx_giving_causes_tenant_status
  ON public.giving_causes (tenant_id, status, featured DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_causes_tenant_category
  ON public.giving_causes (tenant_id, category, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_causes_creator
  ON public.giving_causes (tenant_id, created_by_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.giving_donations (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cause_id text NOT NULL REFERENCES public.giving_causes(id) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT '',
  provider_donation_id text NOT NULL,
  donor_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  donor_profile_id text REFERENCES public.profiles(id) ON DELETE SET NULL,
  donor_display_name text NOT NULL DEFAULT '',
  donor_affiliation text NOT NULL DEFAULT '',
  donor_email text NOT NULL DEFAULT '',
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  display_preference text NOT NULL DEFAULT 'public'
    CHECK (display_preference IN ('public', 'hide_amount', 'anonymous')),
  donor_message text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'succeeded'
    CHECK (status IN ('pending', 'succeeded', 'refunded', 'reversed')),
  completed_at timestamptz,
  provider_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, provider_donation_id)
);

CREATE INDEX IF NOT EXISTS idx_giving_donations_tenant_cause
  ON public.giving_donations (tenant_id, cause_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_donations_tenant_donor
  ON public.giving_donations (tenant_id, donor_user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_giving_donations_tenant_status
  ON public.giving_donations (tenant_id, status, completed_at DESC);

CREATE TABLE IF NOT EXISTS public.giving_cause_updates (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  cause_id text NOT NULL REFERENCES public.giving_causes(id) ON DELETE CASCADE,
  author_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  milestone_type text NOT NULL DEFAULT 'update'
    CHECK (milestone_type IN ('update', 'amount', 'donors', 'percent', 'completed')),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_giving_cause_updates_tenant_cause
  ON public.giving_cause_updates (tenant_id, cause_id, published_at DESC);

DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  GRANT USAGE ON SCHEMA public TO service_role;

  FOREACH table_name IN ARRAY ARRAY[
    'giving_causes',
    'giving_donations',
    'giving_cause_updates'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', table_name);
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',
      table_name
    );

    policy_name := table_name || '_service_role_all';
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        policy_name,
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
