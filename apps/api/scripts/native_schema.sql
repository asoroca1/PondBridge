-- ============================================================
-- PondBridge Native Supabase Schema
-- Replaces the single pb_mongo_mirror JSONB table with
-- proper relational tables for all 20 models.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION public.lower_immutable(input_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(COALESCE(input_text, '') COLLATE "C");
$$;

CREATE OR REPLACE FUNCTION public.join_text_array_immutable(input_values text[], delimiter text DEFAULT ' ')
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT array_to_string(COALESCE(input_values, '{}'::text[]), delimiter);
$$;

-- 1. TENANTS
CREATE TABLE IF NOT EXISTS public.tenants (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  plan_tier text NOT NULL DEFAULT 'base' CHECK (plan_tier IN ('base', 'premium')),
  onboarding_status text NOT NULL DEFAULT 'not_started'
    CHECK (onboarding_status IN ('not_started', 'in_progress', 'live')),
  onboarding_step text NOT NULL DEFAULT 'name_branding',
  onboarding_checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  onboarding_fee_amount numeric NOT NULL DEFAULT 0,
  onboarding_fee_paid boolean NOT NULL DEFAULT false,
  onboarding_fee_invoice_id text NOT NULL DEFAULT '',
  stripe_customer_id text NOT NULL DEFAULT '',
  stripe_subscription_id text NOT NULL DEFAULT '',
  stripe_price_id text NOT NULL DEFAULT '',
  billing_status text NOT NULL DEFAULT 'trialing'
    CHECK (billing_status IN ('trialing', 'active', 'past_due', 'canceled')),
  billing_grace_until timestamptz,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  modules jsonb NOT NULL DEFAULT '{}'::jsonb,
  access_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  launch jsonb NOT NULL DEFAULT '{}'::jsonb,
  onboarding_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  billing_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  director_legal_agreement jsonb NOT NULL DEFAULT '{}'::jsonb,
  notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  deletion_request jsonb NOT NULL DEFAULT '{}'::jsonb,
  add_ons text[] NOT NULL DEFAULT '{}',
  custom_domain text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON public.tenants (slug);
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON public.tenants (stripe_customer_id)
  WHERE stripe_customer_id != '';
CREATE INDEX IF NOT EXISTS idx_tenants_stripe_subscription ON public.tenants (stripe_subscription_id)
  WHERE stripe_subscription_id != '';
CREATE INDEX IF NOT EXISTS idx_tenants_billing_status ON public.tenants (billing_status);

-- 2. USERS
CREATE TABLE IF NOT EXISTS public.users (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text REFERENCES public.tenants(id),
  clerk_user_id text,
  email text NOT NULL,
  password_hash text NOT NULL,
  roles text[] NOT NULL DEFAULT '{user}',
  profile_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS clerk_user_id text;

CREATE INDEX IF NOT EXISTS idx_users_tenant ON public.users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email_roles ON public.users (email, roles);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_scope_clerk_user_unique
  ON public.users ((COALESCE(tenant_id, '__global__')), clerk_user_id)
  WHERE clerk_user_id IS NOT NULL AND clerk_user_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_global_email_unique
  ON public.users ((public.lower_immutable(email)))
  WHERE tenant_id IS NULL;

-- Enforce one active tenant membership per identity (email or Clerk user id).
CREATE OR REPLACE FUNCTION public.enforce_single_tenant_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  conflicting_tenant_id text;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'active' THEN
    RETURN NEW;
  END IF;

  SELECT u.tenant_id
  INTO conflicting_tenant_id
  FROM public.users u
  WHERE u.id <> COALESCE(NEW.id, '')
    AND u.tenant_id IS NOT NULL
    AND u.status = 'active'
    AND (
      (NEW.clerk_user_id IS NOT NULL AND NEW.clerk_user_id <> '' AND u.clerk_user_id = NEW.clerk_user_id)
      OR lower(u.email) = lower(NEW.email)
    )
    AND u.tenant_id <> NEW.tenant_id
  LIMIT 1;

  IF conflicting_tenant_id IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'identity is already bound to a different tenant',
      DETAIL = format('existing_tenant_id=%s new_tenant_id=%s', conflicting_tenant_id, NEW.tenant_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_single_tenant_membership ON public.users;
CREATE TRIGGER trigger_enforce_single_tenant_membership
BEFORE INSERT OR UPDATE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.enforce_single_tenant_membership();

-- 3. PROFILES
CREATE TABLE IF NOT EXISTS public.profiles (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  user_id text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  emails text[] NOT NULL DEFAULT '{}',
  phones text[] NOT NULL DEFAULT '{}',
  city_state text NOT NULL DEFAULT '',
  role_at_camp text NOT NULL DEFAULT '',
  high_school text NOT NULL DEFAULT '',
  colleges text[] NOT NULL DEFAULT '{}',
  college_years text[] NOT NULL DEFAULT '{}',
  current_jobs jsonb NOT NULL DEFAULT '[]'::jsonb,
  past_jobs jsonb NOT NULL DEFAULT '[]'::jsonb,
  industry text NOT NULL DEFAULT '',
  socials jsonb NOT NULL DEFAULT '{}'::jsonb,
  avatar_url text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'pending', 'flagged', 'removed')),
  flagged_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_tenant ON public.profiles (tenant_id);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_name ON public.profiles (tenant_id, last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_status ON public.profiles (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_role ON public.profiles (tenant_id, role_at_camp);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_industry ON public.profiles (tenant_id, industry);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_city ON public.profiles (tenant_id, city_state);
CREATE INDEX IF NOT EXISTS idx_profiles_tenant_created ON public.profiles (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_college_years_gin ON public.profiles
  USING gin (college_years);
CREATE INDEX IF NOT EXISTS idx_profiles_name_trgm ON public.profiles
  USING gin ((public.lower_immutable(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_role_trgm ON public.profiles
  USING gin ((public.lower_immutable(coalesce(role_at_camp, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_industry_trgm ON public.profiles
  USING gin ((public.lower_immutable(coalesce(industry, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_city_trgm ON public.profiles
  USING gin ((public.lower_immutable(coalesce(city_state, ''))) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_profiles_emails_trgm ON public.profiles
  USING gin ((public.lower_immutable(public.join_text_array_immutable(emails, ' '))) gin_trgm_ops);

CREATE OR REPLACE FUNCTION public.enforce_profile_user_tenant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_tenant_id text;
BEGIN
  SELECT tenant_id
  INTO user_tenant_id
  FROM public.users
  WHERE id = NEW.user_id
  LIMIT 1;

  IF user_tenant_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '23503',
      MESSAGE = 'profile user_id must reference a tenant-scoped user';
  END IF;

  IF user_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'profile tenant_id must match users.tenant_id';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_enforce_profile_user_tenant_consistency ON public.profiles;
CREATE TRIGGER trigger_enforce_profile_user_tenant_consistency
BEFORE INSERT OR UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_user_tenant_consistency();

-- 4. INVITES
CREATE TABLE IF NOT EXISTS public.invites (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  email text NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  role_to_assign text NOT NULL DEFAULT 'user'
    CHECK (role_to_assign IN ('user', 'tenant_admin')),
  created_by_user_id text,
  used_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, token)
);

CREATE INDEX IF NOT EXISTS idx_invites_tenant ON public.invites (tenant_id);
CREATE INDEX IF NOT EXISTS idx_invites_tenant_email ON public.invites (tenant_id, email, used_at, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_invites_token ON public.invites (token);

-- 5. ACCESS REQUESTS
CREATE TABLE IF NOT EXISTS public.access_requests (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  email text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  password_hash text NOT NULL DEFAULT '',
  self_reported_role text NOT NULL DEFAULT '',
  request_message text NOT NULL DEFAULT '',
  profile_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by_user_id text,
  approved_user_id text,
  denial_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_access_requests_tenant ON public.access_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_tenant_status ON public.access_requests (tenant_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_requests_tenant_email ON public.access_requests (tenant_id, email, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_pending_unique
  ON public.access_requests (tenant_id, public.lower_immutable(email))
  WHERE status = 'pending';

-- 6. MAGIC LINK TOKENS
CREATE TABLE IF NOT EXISTS public.magic_link_tokens (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  user_id text NOT NULL,
  email text NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_tenant ON public.magic_link_tokens (tenant_id);
CREATE INDEX IF NOT EXISTS idx_magic_link_tokens_tenant_email ON public.magic_link_tokens (tenant_id, email, used_at, expires_at DESC);

-- 7. CONVERSATIONS
CREATE TABLE IF NOT EXISTS public.conversations (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  type text NOT NULL CHECK (type IN ('dm', 'group')),
  participant_ids text[] NOT NULL DEFAULT '{}',
  name text NOT NULL DEFAULT '',
  created_by text NOT NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  last_message jsonb,
  members jsonb NOT NULL DEFAULT '[]'::jsonb,
  read_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON public.conversations (tenant_id);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_participants ON public.conversations
  USING gin (participant_ids);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last_msg ON public.conversations (tenant_id, last_message_at DESC);

-- 8. MESSAGES
CREATE TABLE IF NOT EXISTS public.messages (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  conversation_id text NOT NULL REFERENCES public.conversations(id),
  sender_id text NOT NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'file')),
  text text NOT NULL DEFAULT '',
  media jsonb,
  client_message_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant_convo ON public.messages (tenant_id, conversation_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_dedup
  ON public.messages (tenant_id, conversation_id, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

-- 9. FORUMS
CREATE TABLE IF NOT EXISTS public.forums (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  created_by text NOT NULL,
  creator_id text NOT NULL,
  member_ids text[] NOT NULL DEFAULT '{}',
  moderators text[] NOT NULL DEFAULT '{}',
  posts_count integer NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_forums_tenant ON public.forums (tenant_id);
CREATE INDEX IF NOT EXISTS idx_forums_tenant_activity ON public.forums (tenant_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_forums_member_ids ON public.forums USING gin (member_ids);

-- 10. FORUM POSTS
CREATE TABLE IF NOT EXISTS public.forum_posts (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  forum_id text NOT NULL REFERENCES public.forums(id),
  author_id text NOT NULL,
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'image', 'file')),
  text text NOT NULL DEFAULT '',
  media jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_forum_posts_tenant_forum ON public.forum_posts (tenant_id, forum_id, created_at DESC);

-- 11. PHOTOS
CREATE TABLE IF NOT EXISTS public.photos (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  owner_id text NOT NULL,
  owner_name text NOT NULL DEFAULT '',
  image_url text NOT NULL DEFAULT '',
  thumb_url text NOT NULL DEFAULT '',
  caption text NOT NULL DEFAULT '',
  caption_mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  likes text[] NOT NULL DEFAULT '{}',
  comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photos_tenant ON public.photos (tenant_id, created_at DESC);

-- 12. NEWSLETTERS
CREATE TABLE IF NOT EXISTS public.newsletters (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  title text NOT NULL DEFAULT '',
  season text NOT NULL DEFAULT '',
  year integer,
  pdf_name text NOT NULL DEFAULT '',
  pdf_mime_type text NOT NULL DEFAULT 'application/pdf',
  pdf_data bytea,
  cover_image_name text NOT NULL DEFAULT '',
  cover_image_mime_type text NOT NULL DEFAULT '',
  cover_image_data bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS cover_image_name text NOT NULL DEFAULT '';
ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS cover_image_mime_type text NOT NULL DEFAULT '';
ALTER TABLE public.newsletters
  ADD COLUMN IF NOT EXISTS cover_image_data bytea;

CREATE INDEX IF NOT EXISTS idx_newsletters_tenant ON public.newsletters (tenant_id, year DESC, season, created_at DESC);

-- 13. EVENTS
CREATE TABLE IF NOT EXISTS public.events (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  slug text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'canceled')),
  title text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  cover_image_url text NOT NULL DEFAULT '',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  timezone text NOT NULL DEFAULT 'America/New_York',
  location_name text NOT NULL DEFAULT '',
  location_address text NOT NULL DEFAULT '',
  rsvp_deadline_at timestamptz,
  published_at timestamptz,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_status_start ON public.events (tenant_id, status, starts_at ASC);
CREATE INDEX IF NOT EXISTS idx_events_tenant_published_start ON public.events (tenant_id, published_at DESC, starts_at ASC);

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'attending'
    CHECK (status IN ('attending', 'maybe', 'not_attending')),
  responded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, profile_id),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_event_rsvps_tenant_event ON public.event_rsvps (tenant_id, event_id, responded_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_tenant_profile ON public.event_rsvps (tenant_id, profile_id, responded_at DESC);

CREATE TABLE IF NOT EXISTS public.event_messages (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  kind text NOT NULL
    CHECK (kind IN ('invite', 'reminder', 'update', 'cancellation')),
  subject text NOT NULL DEFAULT '',
  body_html text NOT NULL DEFAULT '',
  recipient_profile_ids text[] NOT NULL DEFAULT '{}',
  recipient_count integer NOT NULL DEFAULT 0,
  delivery_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  sent_at timestamptz,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_messages_tenant_event ON public.event_messages (tenant_id, event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_messages_tenant_kind ON public.event_messages (tenant_id, kind, sent_at DESC);

-- 14. EMAIL BROADCASTS
CREATE TABLE IF NOT EXISTS public.email_broadcasts (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  created_by_user_id text,
  subject text NOT NULL,
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sent', 'failed')),
  targeting jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_count integer NOT NULL DEFAULT 0,
  excluded_count integer NOT NULL DEFAULT 0,
  recipients_preview text[] NOT NULL DEFAULT '{}',
  scheduled_for timestamptz,
  sent_at timestamptz,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_broadcasts_tenant ON public.email_broadcasts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_broadcasts_tenant_status ON public.email_broadcasts (tenant_id, status, sent_at DESC);

-- 15. FAMILY TREES
CREATE TABLE IF NOT EXISTS public.family_trees (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  created_by_user_id text NOT NULL,
  members jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_family_trees_tenant ON public.family_trees (tenant_id, name);

-- 16. ANALYTICS EVENTS
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  user_id text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant ON public.analytics_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_type ON public.analytics_events (tenant_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tenant_user ON public.analytics_events (tenant_id, user_id, created_at DESC);

-- 17. IMPORT REPORTS
CREATE TABLE IF NOT EXISTS public.import_reports (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  created_by_user_id text NOT NULL,
  file_name text NOT NULL DEFAULT 'import.csv',
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  failure_csv text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_import_reports_tenant ON public.import_reports (tenant_id, created_at DESC);

-- 18. TENANT ADMIN AUDIT LOGS
CREATE TABLE IF NOT EXISTS public.tenant_admin_audit_logs (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  actor_user_id text,
  event text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON public.tenant_admin_audit_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_event ON public.tenant_admin_audit_logs (tenant_id, event, created_at DESC);

-- 19. RESUME PARSE RESULTS
CREATE TABLE IF NOT EXISTS public.resume_parse_results (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  created_by_user_id text,
  file_hash text NOT NULL,
  file_name text NOT NULL DEFAULT 'resume.pdf',
  mime_type text NOT NULL DEFAULT 'application/pdf',
  file_size_bytes integer NOT NULL DEFAULT 0,
  prompt_version text NOT NULL DEFAULT 'v1',
  parser_engine text NOT NULL DEFAULT 'heuristic'
    CHECK (parser_engine IN ('openai', 'heuristic')),
  parser_model text NOT NULL DEFAULT '',
  extraction_strategy text NOT NULL DEFAULT 'unknown',
  extracted_text text NOT NULL DEFAULT '',
  extracted_text_length integer NOT NULL DEFAULT 0,
  parsed_profile jsonb NOT NULL,
  cache_hits integer NOT NULL DEFAULT 0,
  reparse_count integer NOT NULL DEFAULT 0,
  last_parsed_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, file_hash, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_resume_parse_results_tenant ON public.resume_parse_results (tenant_id, updated_at DESC);

-- 19. CITY GEO (NOT tenant-scoped)
CREATE TABLE IF NOT EXISTS public.city_geo (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  key text NOT NULL UNIQUE,
  city text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  population integer NOT NULL DEFAULT 0,
  lat double precision,
  lng double precision,
  source text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.city_geo ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '';
ALTER TABLE public.city_geo ADD COLUMN IF NOT EXISTS population integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_city_geo_city_lower
  ON public.city_geo (lower(city));
CREATE INDEX IF NOT EXISTS idx_city_geo_population
  ON public.city_geo (population DESC);

-- 20. ACTIVITY ITEMS
CREATE TABLE IF NOT EXISTS public.activity_items (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  actor_user_id text NOT NULL,
  actor jsonb NOT NULL DEFAULT '{}'::jsonb,
  type text NOT NULL DEFAULT 'announcement.post',
  message text NOT NULL DEFAULT '',
  target jsonb NOT NULL DEFAULT '{}'::jsonb,
  pinned boolean NOT NULL DEFAULT false,
  pinned_at timestamptz,
  ts timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_items_tenant ON public.activity_items (tenant_id, pinned DESC, pinned_at DESC, ts DESC);

-- 21. MOBILE NOTIFICATIONS
CREATE TABLE IF NOT EXISTS public.mobile_notifications (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  user_id text NOT NULL REFERENCES public.users(id),
  batch_id text NOT NULL DEFAULT '',
  created_by_user_id text,
  kind text NOT NULL DEFAULT 'custom_admin',
  category text NOT NULL DEFAULT 'announcements',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  deep_link text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  archived_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_notifications_user_inbox
  ON public.mobile_notifications (tenant_id, user_id, archived_at, read_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobile_notifications_batch
  ON public.mobile_notifications (tenant_id, batch_id, created_at DESC);

-- 22. MOBILE NOTIFICATION DEVICES
CREATE TABLE IF NOT EXISTS public.mobile_notification_devices (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  user_id text NOT NULL REFERENCES public.users(id),
  platform text NOT NULL DEFAULT 'ios',
  token text NOT NULL UNIQUE,
  app_id text NOT NULL DEFAULT '',
  environment text NOT NULL DEFAULT 'sandbox',
  permission_state text NOT NULL DEFAULT 'prompt',
  is_active boolean NOT NULL DEFAULT true,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  last_delivered_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_notification_devices_user
  ON public.mobile_notification_devices (tenant_id, user_id, is_active, updated_at DESC);

-- 23. MOBILE NOTIFICATION PREFERENCES
CREATE TABLE IF NOT EXISTS public.mobile_notification_preferences (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  user_id text NOT NULL REFERENCES public.users(id),
  push_enabled boolean NOT NULL DEFAULT true,
  categories jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_notification_preferences_user
  ON public.mobile_notification_preferences (tenant_id, user_id);

-- 23b. MOBILE NOTIFICATION TEMPLATES
CREATE TABLE IF NOT EXISTS public.mobile_notification_templates (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'announcements',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  deep_link text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'all_active_members',
  user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_notification_templates_tenant
  ON public.mobile_notification_templates (tenant_id, updated_at DESC);

-- 23c. MOBILE NOTIFICATION SCHEDULES
CREATE TABLE IF NOT EXISTS public.mobile_notification_schedules (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  tenant_id text NOT NULL REFERENCES public.tenants(id),
  run_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  category text NOT NULL DEFAULT 'announcements',
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  deep_link text NOT NULL DEFAULT '',
  audience text NOT NULL DEFAULT 'all_active_members',
  user_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  push_requested boolean NOT NULL DEFAULT true,
  created_by_user_id text,
  batch_id text NOT NULL DEFAULT '',
  attempted_at timestamptz,
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mobile_notification_schedules_due
  ON public.mobile_notification_schedules (status, run_at);
CREATE INDEX IF NOT EXISTS idx_mobile_notification_schedules_tenant
  ON public.mobile_notification_schedules (tenant_id, run_at DESC);

-- 24. RESEND WEBHOOK EVENTS
CREATE TABLE IF NOT EXISTS public.resend_webhook_events (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  svix_id text NOT NULL,
  event_type text NOT NULL DEFAULT '',
  email_id text NOT NULL DEFAULT '',
  broadcast_id text NOT NULL DEFAULT '',
  recipient_email text NOT NULL DEFAULT '',
  tenant_id text REFERENCES public.tenants(id),
  tenant_slug text NOT NULL DEFAULT '',
  occurred_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (svix_id, recipient_email)
);

CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_event_type
  ON public.resend_webhook_events (event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_tenant
  ON public.resend_webhook_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_email_id
  ON public.resend_webhook_events (email_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_resend_webhook_events_recipient
  ON public.resend_webhook_events (recipient_email, occurred_at DESC);

-- 25. STRIPE WEBHOOK EVENTS
CREATE TABLE IF NOT EXISTS public.stripe_webhook_events (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  stripe_event_id text NOT NULL UNIQUE,
  event_type text NOT NULL DEFAULT '',
  processing_status text NOT NULL DEFAULT 'received'
    CHECK (processing_status IN ('received', 'processed', 'failed')),
  processed_at timestamptz,
  failed_at timestamptz,
  tenant_id text REFERENCES public.tenants(id),
  tenant_slug text NOT NULL DEFAULT '',
  stripe_customer_id text NOT NULL DEFAULT '',
  stripe_subscription_id text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text NOT NULL DEFAULT '',
  error_message text NOT NULL DEFAULT '',
  attempts integer NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status
  ON public.stripe_webhook_events (processing_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_tenant
  ON public.stripe_webhook_events (tenant_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_customer
  ON public.stripe_webhook_events (stripe_customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_subscription
  ON public.stripe_webhook_events (stripe_subscription_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_event_type
  ON public.stripe_webhook_events (event_type, updated_at DESC);

-- 26. EMAIL SUPPRESSIONS
CREATE TABLE IF NOT EXISTS public.email_suppressions (
  id text PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'lifted')),
  reason text NOT NULL DEFAULT '',
  source_event_type text NOT NULL DEFAULT '',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_email_id text NOT NULL DEFAULT '',
  last_broadcast_id text NOT NULL DEFAULT '',
  tenant_id text REFERENCES public.tenants(id),
  tenant_slug text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_status
  ON public.email_suppressions (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_suppressions_tenant
  ON public.email_suppressions (tenant_id, updated_at DESC);

-- ============================================================
-- RPC Functions
-- ============================================================

-- Profile search across text and array columns
CREATE OR REPLACE FUNCTION public.search_profiles(
  p_tenant_id text,
  p_query text,
  p_role_at_camp text DEFAULT NULL,
  p_industry text DEFAULT NULL,
  p_city_state text DEFAULT NULL,
  p_limit integer DEFAULT 30
)
RETURNS SETOF public.profiles
LANGUAGE sql STABLE
AS $$
  WITH normalized AS (
    SELECT
      trim(coalesce(p_query, '')) AS raw_query,
      lower(trim(coalesce(p_query, ''))) AS query_lc
  ),
  base AS (
    SELECT
      p.id,
      lower(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, ''))) AS full_name,
      lower(coalesce(p.city_state, '')) AS city_state_lc,
      lower(coalesce(p.role_at_camp, '')) AS role_lc,
      lower(coalesce(p.industry, '')) AS industry_lc,
      lower(array_to_string(coalesce(p.emails, '{}'::text[]), ' ')) AS emails_lc,
      lower(array_to_string(coalesce(p.colleges, '{}'::text[]), ' ')) AS colleges_lc,
      lower(coalesce(p.current_jobs::text, '')) AS jobs_lc
    FROM public.profiles p
    WHERE p.tenant_id = p_tenant_id
      AND p.status <> 'removed'
      AND (p_role_at_camp IS NULL OR p.role_at_camp ILIKE '%' || p_role_at_camp || '%')
      AND (p_industry IS NULL OR p.industry ILIKE '%' || p_industry || '%')
      AND (p_city_state IS NULL OR p.city_state ILIKE '%' || p_city_state || '%')
  ),
  scored AS (
    SELECT
      b.id,
      CASE WHEN n.query_lc <> '' AND b.full_name = n.query_lc THEN 1 ELSE 0 END AS exact_name_rank,
      CASE
        WHEN n.query_lc <> '' AND (
          b.full_name LIKE n.query_lc || '%'
          OR b.emails_lc LIKE n.query_lc || '%'
        ) THEN 1
        ELSE 0
      END AS prefix_rank,
      CASE
        WHEN n.query_lc <> '' AND (
          b.full_name ILIKE '%' || n.raw_query || '%'
          OR b.city_state_lc ILIKE '%' || n.query_lc || '%'
          OR b.role_lc ILIKE '%' || n.query_lc || '%'
          OR b.industry_lc ILIKE '%' || n.query_lc || '%'
          OR b.emails_lc ILIKE '%' || n.query_lc || '%'
          OR b.colleges_lc ILIKE '%' || n.query_lc || '%'
          OR b.jobs_lc ILIKE '%' || n.query_lc || '%'
        ) THEN 1
        ELSE 0
      END AS contains_rank,
      CASE
        WHEN n.query_lc = '' THEN 0::double precision
        ELSE GREATEST(
          similarity(b.full_name, n.query_lc),
          similarity(b.emails_lc, n.query_lc),
          similarity(b.city_state_lc, n.query_lc),
          similarity(b.role_lc, n.query_lc),
          similarity(b.industry_lc, n.query_lc),
          similarity(b.colleges_lc, n.query_lc),
          similarity(b.jobs_lc, n.query_lc)
        )
      END AS fuzzy_score
    FROM base b
    CROSS JOIN normalized n
    WHERE n.query_lc = ''
      OR (
        b.full_name ILIKE '%' || n.raw_query || '%'
        OR b.city_state_lc ILIKE '%' || n.query_lc || '%'
        OR b.role_lc ILIKE '%' || n.query_lc || '%'
        OR b.industry_lc ILIKE '%' || n.query_lc || '%'
        OR b.emails_lc ILIKE '%' || n.query_lc || '%'
        OR b.colleges_lc ILIKE '%' || n.query_lc || '%'
        OR b.jobs_lc ILIKE '%' || n.query_lc || '%'
        OR GREATEST(
          similarity(b.full_name, n.query_lc),
          similarity(b.emails_lc, n.query_lc),
          similarity(b.city_state_lc, n.query_lc),
          similarity(b.role_lc, n.query_lc),
          similarity(b.industry_lc, n.query_lc),
          similarity(b.colleges_lc, n.query_lc),
          similarity(b.jobs_lc, n.query_lc)
        ) >= (
          CASE
            WHEN char_length(n.query_lc) <= 3 THEN 0.40
            WHEN char_length(n.query_lc) <= 5 THEN 0.30
            ELSE 0.22
          END
        )
      )
  )
  SELECT p.*
  FROM scored s
  JOIN public.profiles p ON p.id = s.id
  CROSS JOIN normalized n
  ORDER BY
    s.exact_name_rank DESC,
    s.prefix_rank DESC,
    s.contains_rank DESC,
    s.fuzzy_score DESC,
    p.last_name ASC,
    p.first_name ASC
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 30), 100));
$$;

-- Top search terms from analytics
CREATE OR REPLACE FUNCTION public.top_search_terms(
  p_tenant_id text,
  p_since timestamptz,
  p_limit integer DEFAULT 25
)
RETURNS TABLE(term text, count bigint)
LANGUAGE sql STABLE
AS $$
  SELECT
    metadata->>'term' AS term,
    COUNT(*) AS count
  FROM public.analytics_events
  WHERE tenant_id = p_tenant_id
    AND event_type = 'directory_search'
    AND created_at >= p_since
    AND metadata->>'term' IS NOT NULL
    AND metadata->>'term' != ''
  GROUP BY metadata->>'term'
  ORDER BY count DESC, term ASC
  LIMIT p_limit;
$$;

-- Distinct active user IDs from analytics
CREATE OR REPLACE FUNCTION public.distinct_active_user_ids(
  p_tenant_id text,
  p_event_types text[],
  p_since timestamptz
)
RETURNS text[]
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(ARRAY(
    SELECT DISTINCT user_id
    FROM public.analytics_events
    WHERE tenant_id = p_tenant_id
      AND user_id IS NOT NULL
      AND event_type = ANY(p_event_types)
      AND created_at >= p_since
  ), '{}');
$$;

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to all tables that have updated_at
DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tenants', 'users', 'profiles', 'invites', 'access_requests',
      'magic_link_tokens', 'conversations', 'forums', 'photos',
      'newsletters', 'events', 'event_rsvps', 'event_messages', 'email_broadcasts', 'family_trees', 'analytics_events',
      'import_reports', 'tenant_admin_audit_logs', 'resume_parse_results',
      'city_geo', 'activity_items', 'mobile_notifications', 'mobile_notification_devices', 'mobile_notification_preferences', 'mobile_notification_templates', 'mobile_notification_schedules',
      'resend_webhook_events', 'stripe_webhook_events', 'email_suppressions'
    ])
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_updated_at ON public.%I; CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ============================================================
-- Row Level Security (Defense in Depth)
-- ============================================================
-- The API uses the service_role key server-side, but RLS is still enabled on
-- all public tables so direct client access remains blocked by default.

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tenants', 'users', 'profiles', 'invites', 'access_requests',
      'magic_link_tokens', 'conversations', 'messages', 'forums', 'forum_posts',
      'photos', 'newsletters', 'events', 'event_rsvps', 'event_messages', 'email_broadcasts', 'family_trees',
      'analytics_events', 'import_reports', 'tenant_admin_audit_logs',
      'resume_parse_results', 'city_geo', 'activity_items', 'mobile_notifications', 'mobile_notification_devices', 'mobile_notification_preferences', 'mobile_notification_templates', 'mobile_notification_schedules',
      'resend_webhook_events', 'stripe_webhook_events', 'email_suppressions'
    ])
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
  END LOOP;
END;
$$;

DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'tenants', 'users', 'profiles', 'invites', 'access_requests',
      'magic_link_tokens', 'conversations', 'messages', 'forums', 'forum_posts',
      'photos', 'newsletters', 'events', 'event_rsvps', 'event_messages', 'email_broadcasts', 'family_trees',
      'analytics_events', 'import_reports', 'tenant_admin_audit_logs',
      'resume_parse_results', 'city_geo', 'activity_items', 'mobile_notifications', 'mobile_notification_devices', 'mobile_notification_preferences', 'mobile_notification_templates', 'mobile_notification_schedules',
      'resend_webhook_events', 'stripe_webhook_events', 'email_suppressions'
    ])
  LOOP
    policy_name := format('%s_service_role_all', tbl);
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND policyname = policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
        policy_name,
        tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- Legacy compatibility: lock down pb_mongo_mirror if it still exists in runtime DBs.
DO $$
BEGIN
  IF to_regclass('public.pb_mongo_mirror') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pb_mongo_mirror ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'ALTER TABLE public.pb_mongo_mirror FORCE ROW LEVEL SECURITY;';

    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'pb_mongo_mirror'
        AND policyname = 'pb_mongo_mirror_service_role_all'
    ) THEN
      EXECUTE
        'CREATE POLICY pb_mongo_mirror_service_role_all ON public.pb_mongo_mirror
         FOR ALL TO service_role USING (true) WITH CHECK (true);';
    END IF;
  END IF;
END;
$$;

-- ============================================================
-- Authenticated Role RLS (Tenant-Scoped JWT claims)
-- ============================================================

CREATE OR REPLACE FUNCTION public.jwt_tenant_id()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(auth.jwt() ->> 'tenantId', ''),
    NULLIF(auth.jwt() ->> 'tenant_id', ''),
    NULLIF(auth.jwt() ->> 'orgId', ''),
    NULLIF(auth.jwt() ->> 'org_id', ''),
    NULLIF(auth.jwt() -> 'public_metadata' ->> 'tenantId', ''),
    NULLIF(auth.jwt() -> 'public_metadata' ->> 'tenant_id', ''),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_roles()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT jsonb_array_elements_text(
        COALESCE(auth.jwt() -> 'roles', auth.jwt() -> 'public_metadata' -> 'roles', '[]'::jsonb)
      )
    ),
    ARRAY[]::text[]
  );
$$;

CREATE OR REPLACE FUNCTION public.jwt_has_role(p_role text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT lower(trim(COALESCE(p_role, ''))) = ANY (
    ARRAY(
      SELECT lower(trim(role_name))
      FROM unnest(public.jwt_roles()) AS role_name
    )
  )
  OR lower(trim(COALESCE(auth.jwt() ->> 'role', ''))) = lower(trim(COALESCE(p_role, '')))
  OR lower(trim(COALESCE(auth.jwt() ->> 'tenantRole', ''))) = lower(trim(COALESCE(p_role, '')));
$$;

DROP POLICY IF EXISTS tenants_authenticated_scope_select ON public.tenants;
CREATE POLICY tenants_authenticated_scope_select
ON public.tenants
FOR SELECT
TO authenticated
USING (
  public.jwt_tenant_id() <> ''
  AND id = public.jwt_tenant_id()
);

DROP POLICY IF EXISTS tenants_authenticated_scope_update ON public.tenants;
CREATE POLICY tenants_authenticated_scope_update
ON public.tenants
FOR UPDATE
TO authenticated
USING (
  public.jwt_tenant_id() <> ''
  AND id = public.jwt_tenant_id()
  AND (
    public.jwt_has_role('tenant_admin')
    OR public.jwt_has_role('admin')
    OR public.jwt_has_role('super_admin')
  )
)
WITH CHECK (
  public.jwt_tenant_id() <> ''
  AND id = public.jwt_tenant_id()
);

DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'users', 'profiles', 'invites', 'access_requests', 'magic_link_tokens',
      'conversations', 'messages', 'forums', 'forum_posts', 'photos',
      'newsletters', 'events', 'event_rsvps', 'event_messages', 'email_broadcasts', 'family_trees', 'analytics_events',
      'import_reports', 'tenant_admin_audit_logs', 'resume_parse_results',
      'activity_items', 'mobile_notifications', 'mobile_notification_devices', 'mobile_notification_preferences', 'mobile_notification_templates', 'mobile_notification_schedules',
      'resend_webhook_events', 'stripe_webhook_events', 'email_suppressions'
    ])
  LOOP
    policy_name := format('%s_authenticated_tenant_scope', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', policy_name, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (public.jwt_tenant_id() <> '''' AND tenant_id = public.jwt_tenant_id()) WITH CHECK (public.jwt_tenant_id() <> '''' AND tenant_id = public.jwt_tenant_id());',
      policy_name,
      tbl
    );
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.pb_mongo_mirror') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pb_mongo_mirror_authenticated_tenant_scope ON public.pb_mongo_mirror;';
    EXECUTE
      'CREATE POLICY pb_mongo_mirror_authenticated_tenant_scope ON public.pb_mongo_mirror
       FOR ALL TO authenticated
       USING (public.jwt_tenant_id() <> '''' AND tenant_id = public.jwt_tenant_id())
       WITH CHECK (public.jwt_tenant_id() <> '''' AND tenant_id = public.jwt_tenant_id());';
  END IF;
END;
$$;
