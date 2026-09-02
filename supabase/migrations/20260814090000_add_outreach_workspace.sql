BEGIN;

-- Global, operator-only CRM records. These tables are deliberately not
-- tenant-scoped: prospects may not have a PondBridge tenant yet. Browser roles
-- have no direct access; the authenticated super-admin API is authoritative.
CREATE TABLE IF NOT EXISTS public.outreach_accounts (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'identified'
    CHECK (stage IN (
      'identified', 'researching', 'ready_to_contact', 'contacted', 'engaged',
      'proposal', 'verbal_commit', 'signed', 'nurture', 'lost'
    )),
  website_url text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  owner_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  owner_label text NOT NULL DEFAULT '',
  next_action text NOT NULL DEFAULT '',
  next_action_due_at timestamptz,
  last_contact_at timestamptz,
  linked_tenant_id text REFERENCES public.tenants(id) ON DELETE SET NULL,
  research_summary text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  lost_reason text NOT NULL DEFAULT '',
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_accounts_stage
  ON public.outreach_accounts (stage, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_outreach_accounts_next_action
  ON public.outreach_accounts (next_action_due_at ASC)
  WHERE next_action_due_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_accounts_linked_tenant
  ON public.outreach_accounts (linked_tenant_id)
  WHERE linked_tenant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.outreach_contacts (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  account_id text NOT NULL REFERENCES public.outreach_accounts(id) ON DELETE CASCADE,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  linkedin_url text NOT NULL DEFAULT '',
  is_primary boolean NOT NULL DEFAULT false,
  notes text NOT NULL DEFAULT '',
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_contacts_account
  ON public.outreach_contacts (account_id, is_primary DESC, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_contacts_account_email
  ON public.outreach_contacts (account_id, lower(email))
  WHERE email <> '';

CREATE TABLE IF NOT EXISTS public.outreach_interactions (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  account_id text NOT NULL REFERENCES public.outreach_accounts(id) ON DELETE CASCADE,
  contact_id text REFERENCES public.outreach_contacts(id) ON DELETE SET NULL,
  interaction_type text NOT NULL
    CHECK (interaction_type IN (
      'note', 'research', 'email', 'call', 'meeting', 'linkedin', 'proposal',
      'status_change'
    )),
  direction text NOT NULL DEFAULT 'internal'
    CHECK (direction IN ('inbound', 'outbound', 'internal')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  summary text NOT NULL,
  outcome text NOT NULL DEFAULT '',
  follow_up_at timestamptz,
  external_message_id text NOT NULL DEFAULT '',
  created_by_user_id text REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_interactions_account_occurred
  ON public.outreach_interactions (account_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.outreach_conversations (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  operator_user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Outreach workspace',
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_conversations_operator
  ON public.outreach_conversations (operator_user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.outreach_messages (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  conversation_id text NOT NULL REFERENCES public.outreach_conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_conversation
  ON public.outreach_messages (conversation_id, created_at ASC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'outreach_accounts', 'outreach_contacts', 'outreach_interactions',
    'outreach_conversations', 'outreach_messages'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', table_name);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at()',
      table_name
    );
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', table_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', table_name);
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = table_name
        AND policyname = table_name || '_service_role_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        table_name || '_service_role_all', table_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
