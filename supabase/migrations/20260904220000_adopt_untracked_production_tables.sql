-- Adopt the production tables that no repo migration creates.
--
-- Generated 2026-09-04 directly from the production catalog (pg_get_constraintdef,
-- pg_get_indexdef, pg_get_functiondef, pg_get_triggerdef), not written by hand.
--
-- Background: a parity check after the hosted staging project was created found
-- production carrying 88 public tables against the 47 that supabase/migrations
-- describes. The other 41 -- the ops/CRM stack, the email-marketing subsystem, and
-- some legacy leftovers -- were created out of band, so their DDL lived nowhere in
-- version control and staging could not reproduce them.
--
-- Everything here is idempotent (IF NOT EXISTS, plus DO blocks that swallow
-- duplicate_object), so applying it to production is a no-op that simply records
-- the existing shape. Constraints are added after all tables exist, so table
-- ordering does not matter and circular foreign keys are fine.
--
-- This migration creates structure only. It carries no data.

do $do$ begin create type public.churn_risk_level as enum ('low', 'medium', 'high'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.client_status as enum ('lead', 'intro_call', 'proposal_sent', 'closed_won', 'onboarding', 'active', 'renewal_watch', 'churned', 'archived'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.email_campaign_status as enum ('draft', 'active', 'paused', 'completed', 'archived'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.email_event_type as enum ('scheduled', 'test_sent', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'unsubscribed', 'failed', 'cancelled'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.email_identity_status as enum ('draft', 'active', 'disabled'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.email_message_status as enum ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.email_recipient_type as enum ('to', 'cc', 'bcc'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.email_segment_type as enum ('static', 'smart'); exception when duplicate_object then null; end $do$;

do $do$ begin create type public.review_status as enum ('pending', 'reviewed', 'exported', 'flagged'); exception when duplicate_object then null; end $do$;

create table if not exists public.accounting_categories (
  id uuid default gen_random_uuid() not null,
  name text not null,
  account_type text not null,
  wave_account_name text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.audit_logs (
  id uuid default gen_random_uuid() not null,
  actor text,
  table_name text not null,
  record_id text not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.category_rules (
  id uuid default gen_random_uuid() not null,
  source text default 'any'::text not null,
  match_field text not null,
  match_operator text not null,
  match_value text not null,
  assign_category_id uuid,
  assign_vendor_id uuid,
  assign_type text,
  priority integer default 100 not null,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.client_contacts (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  full_name text not null,
  role text,
  email text,
  phone text,
  is_primary boolean default false not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.client_interactions (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  interaction_type text default 'note'::text not null,
  occurred_at timestamp with time zone default now() not null,
  summary text not null,
  detail text,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.client_issues (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  title text not null,
  severity text default 'medium'::text not null,
  status text default 'open'::text not null,
  source text default 'client'::text,
  detail text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.client_pipeline_history (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  from_status text,
  to_status text not null,
  reason text not null,
  changed_by text,
  changed_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.clients (
  id uuid default gen_random_uuid() not null,
  name text not null,
  status client_status default 'lead'::client_status not null,
  plan_type text,
  mrr_cents bigint default 0 not null,
  onboarding_fee_paid boolean default false not null,
  onboarding_fee_cents bigint default 0 not null,
  contract_start_date date,
  renewal_date date,
  renewal_notice_days integer default 30 not null,
  churn_risk churn_risk_level default 'low'::churn_risk_level,
  health_score integer,
  stripe_customer_id text,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  contract_end_date date,
  contract_value_cents bigint default 0 not null,
  notice_period_days integer default 30 not null,
  last_engagement_at timestamp with time zone,
  account_owner text,
  lifecycle_note text
);

create table if not exists public.contact_email_preferences (
  id uuid default gen_random_uuid() not null,
  client_contact_id uuid not null,
  tags text[] default '{}'::text[] not null,
  lead_stage text,
  do_not_email boolean default false not null,
  bounced boolean default false not null,
  unsubscribed boolean default false not null,
  last_emailed_at timestamp with time zone,
  last_replied_at timestamp with time zone,
  last_opened_at timestamp with time zone,
  owner text,
  notes text,
  custom_fields jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.credentials_metadata (
  id uuid default gen_random_uuid() not null,
  system_name text not null,
  account_owner text,
  account_email text,
  credential_location text not null,
  last_rotation_date date,
  rotation_interval_days integer default 90 not null,
  next_rotation_date date,
  reminder_enabled boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.decision_journal_entries (
  id uuid default gen_random_uuid() not null,
  parent_entry_id uuid,
  entry_kind text default 'decision'::text not null,
  title text not null,
  context text,
  decision text,
  rationale text,
  impact text,
  owner text,
  status text default 'proposed'::text not null,
  outcome text,
  decided_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.demo_requests (
  id uuid default gen_random_uuid() not null,
  first_name text not null,
  last_name text not null,
  work_email text not null,
  camp_name text not null,
  role text,
  notes text,
  client_id uuid,
  status text default 'new'::text not null,
  raw_payload jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.documents (
  id uuid default gen_random_uuid() not null,
  name text not null,
  file_path text,
  file_type text,
  category text default 'other'::text not null,
  linked_client_id uuid,
  linked_vendor_id uuid,
  tags text[] default '{}'::text[] not null,
  version integer default 1 not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  uploaded_by text,
  size_bytes bigint,
  mime_type text,
  storage_provider text,
  extracted_text text,
  linked_transaction_id uuid
);

create table if not exists public.email_campaign_enrollments (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  client_contact_id uuid,
  email text not null,
  status text default 'queued'::text not null,
  current_step_order integer default 0 not null,
  enrolled_at timestamp with time zone default now() not null,
  completed_at timestamp with time zone,
  last_message_id uuid,
  last_error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.email_campaigns (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  campaign_type text default 'one_off'::text not null,
  status email_campaign_status default 'draft'::email_campaign_status not null,
  segment_id uuid,
  sender_identity_id uuid,
  template_id uuid,
  launch_at timestamp with time zone,
  last_launched_at timestamp with time zone,
  tags text[] default '{}'::text[] not null,
  notes text,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.email_events (
  id uuid default gen_random_uuid() not null,
  email_message_id uuid,
  email_recipient_id uuid,
  provider text,
  provider_message_id text,
  event_type email_event_type not null,
  event_timestamp timestamp with time zone default now() not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.email_messages (
  id uuid default gen_random_uuid() not null,
  created_by text,
  sender_identity_id uuid,
  from_email text not null,
  from_name text,
  reply_to text,
  subject text default ''::text not null,
  header_html text default ''::text not null,
  header_text text default ''::text not null,
  html_body text default ''::text not null,
  text_body text default ''::text not null,
  footer_html text default ''::text not null,
  footer_text text default ''::text not null,
  preview_text text,
  template_id uuid,
  status email_message_status default 'draft'::email_message_status not null,
  scheduled_at timestamp with time zone,
  sent_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  provider text,
  provider_message_id text,
  send_attempt_count integer default 0 not null,
  last_error text,
  notes text,
  internal_notes text,
  campaign_tag text,
  tracking_enabled boolean default false not null,
  unsubscribe_footer_enabled boolean default false not null,
  recipient_count integer default 0 not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  campaign_id uuid,
  sequence_step_id uuid
);

create table if not exists public.email_module_settings (
  id uuid default gen_random_uuid() not null,
  default_sender_identity_id uuid,
  default_reply_to text,
  default_header_html text default ''::text not null,
  default_header_text text default ''::text not null,
  default_signature_html text default ''::text not null,
  default_signature_text text default ''::text not null,
  default_footer_html text default ''::text not null,
  default_footer_text text default ''::text not null,
  tracking_enabled boolean default false not null,
  unsubscribe_footer_enabled boolean default false not null,
  branding_defaults jsonb default '{}'::jsonb not null,
  large_send_threshold integer default 25 not null,
  test_send_recipient text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.email_notes (
  id uuid default gen_random_uuid() not null,
  email_message_id uuid not null,
  body text not null,
  created_by text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.email_recipients (
  id uuid default gen_random_uuid() not null,
  email_message_id uuid not null,
  recipient_type email_recipient_type default 'to'::email_recipient_type not null,
  email text not null,
  full_name text,
  client_id uuid,
  client_contact_id uuid,
  status text default 'pending'::text not null,
  delivery_status text,
  opened_at timestamp with time zone,
  clicked_at timestamp with time zone,
  replied_at timestamp with time zone,
  opt_out boolean default false not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.email_segment_members (
  id uuid default gen_random_uuid() not null,
  segment_id uuid not null,
  client_contact_id uuid,
  raw_email text,
  added_by text,
  created_at timestamp with time zone default now() not null,
  raw_first_name text,
  raw_last_name text,
  raw_company_name text
);

create table if not exists public.email_segments (
  id uuid default gen_random_uuid() not null,
  name text not null,
  description text,
  segment_type email_segment_type default 'static'::email_segment_type not null,
  filter_json jsonb default '{}'::jsonb not null,
  tags text[] default '{}'::text[] not null,
  created_by text,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.email_sender_identities (
  id uuid default gen_random_uuid() not null,
  key text,
  name text not null,
  from_name text not null,
  from_email text not null,
  reply_to text,
  provider text default 'resend'::text not null,
  status email_identity_status default 'draft'::email_identity_status not null,
  is_default boolean default false not null,
  domain text default 'marketing.pondbridgealumni.com'::text not null,
  tracking_domain text,
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.email_sequence_steps (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  step_order integer not null,
  delay_days integer default 0 not null,
  template_id uuid,
  subject_override text,
  header_html_override text,
  header_text_override text,
  body_html_override text,
  body_text_override text,
  footer_html_override text,
  footer_text_override text,
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.email_templates (
  id uuid default gen_random_uuid() not null,
  slug text,
  name text not null,
  category text default 'general'::text not null,
  tags text[] default '{}'::text[] not null,
  subject text not null,
  header_html text default ''::text not null,
  header_text text default ''::text not null,
  body_html text not null,
  body_text text default ''::text not null,
  footer_html text default ''::text not null,
  footer_text text default ''::text not null,
  notes text,
  created_by text,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.infrastructure_assets (
  id uuid default gen_random_uuid() not null,
  asset_type text not null,
  name text not null,
  provider text,
  environment text,
  owner text,
  identifier text,
  url text,
  metadata jsonb default '{}'::jsonb not null,
  status text default 'active'::text not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.knowledge_categories (
  id uuid default gen_random_uuid() not null,
  name text not null,
  slug text,
  parent_id uuid,
  category_type text default 'sop'::text not null,
  sort_order integer default 100 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.knowledge_document_versions (
  id uuid default gen_random_uuid() not null,
  knowledge_document_id uuid not null,
  version_number integer not null,
  title text not null,
  markdown_content text not null,
  change_summary text,
  created_by text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.knowledge_documents (
  id uuid default gen_random_uuid() not null,
  title text not null,
  slug text,
  category_id uuid,
  document_type text default 'note'::text not null,
  markdown_content text default ''::text not null,
  summary text,
  linked_vendor_id uuid,
  linked_client_id uuid,
  status text default 'active'::text not null,
  last_reviewed_at timestamp with time zone default now(),
  review_interval_days integer default 90 not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  sort_order integer default 100 not null
);

create table if not exists public.meeting_prep_notes (
  id uuid default gen_random_uuid() not null,
  client_id uuid not null,
  title text default 'Meeting Prep'::text not null,
  body text not null,
  meeting_date date,
  generated_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.normalized_transactions (
  id uuid default gen_random_uuid() not null,
  source text not null,
  source_id text not null,
  type text not null,
  amount_cents bigint not null,
  currency text default 'usd'::text not null,
  transaction_date date not null,
  description text,
  category_id uuid,
  client_id uuid,
  vendor_id uuid,
  reconciliation_group_id uuid,
  document_id uuid,
  review_status review_status default 'pending'::review_status not null,
  notes text,
  exported_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.outreach_accounts (
  id text default encode(gen_random_bytes(12), 'hex'::text) not null,
  name text not null,
  stage text default 'identified'::text not null,
  website_url text default ''::text not null,
  location text default ''::text not null,
  source text default ''::text not null,
  owner_user_id text,
  owner_label text default ''::text not null,
  next_action text default ''::text not null,
  next_action_due_at timestamp with time zone,
  last_contact_at timestamp with time zone,
  linked_tenant_id text,
  research_summary text default ''::text not null,
  notes text default ''::text not null,
  lost_reason text default ''::text not null,
  created_by_user_id text,
  updated_by_user_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.outreach_contacts (
  id text default encode(gen_random_bytes(12), 'hex'::text) not null,
  account_id text not null,
  first_name text default ''::text not null,
  last_name text default ''::text not null,
  title text default ''::text not null,
  email text default ''::text not null,
  phone text default ''::text not null,
  linkedin_url text default ''::text not null,
  is_primary boolean default false not null,
  notes text default ''::text not null,
  created_by_user_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.outreach_conversations (
  id text default encode(gen_random_bytes(12), 'hex'::text) not null,
  operator_user_id text not null,
  title text default 'Outreach workspace'::text not null,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.outreach_interactions (
  id text default encode(gen_random_bytes(12), 'hex'::text) not null,
  account_id text not null,
  contact_id text,
  interaction_type text not null,
  direction text default 'internal'::text not null,
  occurred_at timestamp with time zone default now() not null,
  summary text not null,
  outcome text default ''::text not null,
  follow_up_at timestamp with time zone,
  external_message_id text default ''::text not null,
  created_by_user_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.outreach_messages (
  id text default encode(gen_random_bytes(12), 'hex'::text) not null,
  conversation_id text not null,
  role text not null,
  content text not null,
  sources jsonb default '[]'::jsonb not null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.pb_mongo_mirror (
  collection text not null,
  id text not null,
  tenant_id text,
  payload jsonb not null,
  created_at timestamp with time zone,
  updated_at timestamp with time zone default now() not null,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.tasks (
  id uuid default gen_random_uuid() not null,
  title text not null,
  task_type text default 'manual'::text not null,
  status text default 'todo'::text not null,
  due_date date,
  priority text default 'medium'::text not null,
  linked_client_id uuid,
  linked_vendor_id uuid,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone,
  parent_task_id uuid,
  recurrence_unit text,
  recurrence_interval integer default 1 not null,
  recurrence_end_date date,
  reminder_at timestamp with time zone,
  reminder_sent_at timestamp with time zone,
  completed_at timestamp with time zone,
  linked_document_id uuid,
  recurrence_parent_task_id uuid,
  recurrence_last_generated_at timestamp with time zone,
  sort_order integer default 100 not null,
  linked_transaction_id uuid
);

create table if not exists public.vendor_subscriptions (
  id uuid default gen_random_uuid() not null,
  vendor_id uuid not null,
  plan_name text not null,
  monthly_cost_cents bigint default 0 not null,
  actual_billed_cents bigint default 0 not null,
  billing_cadence text default 'monthly'::text not null,
  next_renewal_date date,
  payment_method text,
  category text,
  is_active boolean default true not null,
  is_mission_critical boolean default false not null,
  cancellation_notes text,
  replacement_options text,
  merchant_name_exact text,
  merchant_name_contains text[] default '{}'::text[] not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.vendors (
  id uuid default gen_random_uuid() not null,
  name text not null,
  category text,
  website text,
  is_active boolean default true not null,
  notes text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone
);

create table if not exists public.web_vital_events (
  id bigint generated always as identity not null,
  name text not null,
  value double precision not null,
  delta double precision default 0 not null,
  rating text default ''::text not null,
  navigation_type text default ''::text not null,
  route_group text default ''::text not null,
  device_class text default ''::text not null,
  connection_type text default ''::text not null,
  build_id text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

do $do$ begin alter table public.accounting_categories add constraint accounting_categories_name_key UNIQUE (name); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.accounting_categories add constraint accounting_categories_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.audit_logs add constraint audit_logs_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.category_rules add constraint category_rules_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_contacts add constraint client_contacts_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_interactions add constraint client_interactions_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_issues add constraint client_issues_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_pipeline_history add constraint client_pipeline_history_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.clients add constraint clients_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.contact_email_preferences add constraint contact_email_preferences_client_contact_id_key UNIQUE (client_contact_id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.contact_email_preferences add constraint contact_email_preferences_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.credentials_metadata add constraint credentials_metadata_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.decision_journal_entries add constraint decision_journal_entries_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.demo_requests add constraint demo_requests_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.documents add constraint documents_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaign_enrollments add constraint email_campaign_enrollments_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaigns add constraint email_campaigns_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_events add constraint email_events_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_messages add constraint email_messages_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_module_settings add constraint email_module_settings_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_notes add constraint email_notes_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_recipients add constraint email_recipients_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_segment_members add constraint email_segment_members_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_segments add constraint email_segments_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sender_identities add constraint email_sender_identities_from_email_key UNIQUE (from_email); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sender_identities add constraint email_sender_identities_key_key UNIQUE (key); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sender_identities add constraint email_sender_identities_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sequence_steps add constraint email_sequence_steps_campaign_id_step_order_key UNIQUE (campaign_id, step_order); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sequence_steps add constraint email_sequence_steps_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_templates add constraint email_templates_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_templates add constraint email_templates_slug_key UNIQUE (slug); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.infrastructure_assets add constraint infrastructure_assets_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_categories add constraint knowledge_categories_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_categories add constraint knowledge_categories_slug_key UNIQUE (slug); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_document_versions add constraint knowledge_document_versions_knowledge_document_id_version_n_key UNIQUE (knowledge_document_id, version_number); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_document_versions add constraint knowledge_document_versions_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_documents add constraint knowledge_documents_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_documents add constraint knowledge_documents_slug_key UNIQUE (slug); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.meeting_prep_notes add constraint meeting_prep_notes_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.normalized_transactions add constraint normalized_transactions_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.normalized_transactions add constraint normalized_transactions_source_source_id_key UNIQUE (source, source_id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_accounts add constraint outreach_accounts_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_contacts add constraint outreach_contacts_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_conversations add constraint outreach_conversations_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_interactions add constraint outreach_interactions_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_messages add constraint outreach_messages_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.pb_mongo_mirror add constraint pb_mongo_mirror_pkey PRIMARY KEY (collection, id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.vendor_subscriptions add constraint vendor_subscriptions_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.vendors add constraint vendors_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.web_vital_events add constraint web_vital_events_pkey PRIMARY KEY (id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_segment_members add constraint email_segment_members_check CHECK (((client_contact_id IS NOT NULL) OR (raw_email IS NOT NULL))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_accounts add constraint outreach_accounts_stage_check CHECK ((stage = ANY (ARRAY['identified'::text, 'researching'::text, 'ready_to_contact'::text, 'contacted'::text, 'engaged'::text, 'proposal'::text, 'verbal_commit'::text, 'signed'::text, 'nurture'::text, 'lost'::text]))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_interactions add constraint outreach_interactions_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text, 'internal'::text]))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_interactions add constraint outreach_interactions_interaction_type_check CHECK ((interaction_type = ANY (ARRAY['note'::text, 'research'::text, 'email'::text, 'call'::text, 'meeting'::text, 'linkedin'::text, 'proposal'::text, 'status_change'::text]))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_messages add constraint outreach_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text]))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.web_vital_events add constraint web_vital_events_name_check CHECK ((name = ANY (ARRAY['CLS'::text, 'FCP'::text, 'INP'::text, 'LCP'::text, 'TTFB'::text]))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.web_vital_events add constraint web_vital_events_value_check CHECK (((value >= (0)::double precision) AND (value <= (3600000)::double precision))); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.category_rules add constraint category_rules_assign_category_id_fkey FOREIGN KEY (assign_category_id) REFERENCES accounting_categories(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.category_rules add constraint category_rules_assign_vendor_id_fkey FOREIGN KEY (assign_vendor_id) REFERENCES vendors(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_contacts add constraint client_contacts_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_interactions add constraint client_interactions_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_issues add constraint client_issues_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.client_pipeline_history add constraint client_pipeline_history_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.contact_email_preferences add constraint contact_email_preferences_client_contact_id_fkey FOREIGN KEY (client_contact_id) REFERENCES client_contacts(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.decision_journal_entries add constraint decision_journal_entries_parent_entry_id_fkey FOREIGN KEY (parent_entry_id) REFERENCES decision_journal_entries(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.demo_requests add constraint demo_requests_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.documents add constraint documents_linked_client_id_fkey FOREIGN KEY (linked_client_id) REFERENCES clients(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.documents add constraint documents_linked_transaction_id_fkey FOREIGN KEY (linked_transaction_id) REFERENCES normalized_transactions(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.documents add constraint documents_linked_vendor_id_fkey FOREIGN KEY (linked_vendor_id) REFERENCES vendors(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaign_enrollments add constraint email_campaign_enrollments_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaign_enrollments add constraint email_campaign_enrollments_client_contact_id_fkey FOREIGN KEY (client_contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaign_enrollments add constraint email_campaign_enrollments_last_message_id_fkey FOREIGN KEY (last_message_id) REFERENCES email_messages(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaigns add constraint email_campaigns_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES email_segments(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaigns add constraint email_campaigns_sender_identity_id_fkey FOREIGN KEY (sender_identity_id) REFERENCES email_sender_identities(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_campaigns add constraint email_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_events add constraint email_events_email_message_id_fkey FOREIGN KEY (email_message_id) REFERENCES email_messages(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_events add constraint email_events_email_recipient_id_fkey FOREIGN KEY (email_recipient_id) REFERENCES email_recipients(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_messages add constraint email_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_messages add constraint email_messages_sender_identity_id_fkey FOREIGN KEY (sender_identity_id) REFERENCES email_sender_identities(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_messages add constraint email_messages_sequence_step_id_fkey FOREIGN KEY (sequence_step_id) REFERENCES email_sequence_steps(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_messages add constraint email_messages_template_id_fkey FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_module_settings add constraint email_module_settings_default_sender_identity_id_fkey FOREIGN KEY (default_sender_identity_id) REFERENCES email_sender_identities(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_notes add constraint email_notes_email_message_id_fkey FOREIGN KEY (email_message_id) REFERENCES email_messages(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_recipients add constraint email_recipients_client_contact_id_fkey FOREIGN KEY (client_contact_id) REFERENCES client_contacts(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_recipients add constraint email_recipients_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_recipients add constraint email_recipients_email_message_id_fkey FOREIGN KEY (email_message_id) REFERENCES email_messages(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_segment_members add constraint email_segment_members_client_contact_id_fkey FOREIGN KEY (client_contact_id) REFERENCES client_contacts(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_segment_members add constraint email_segment_members_segment_id_fkey FOREIGN KEY (segment_id) REFERENCES email_segments(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sequence_steps add constraint email_sequence_steps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES email_campaigns(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.email_sequence_steps add constraint email_sequence_steps_template_id_fkey FOREIGN KEY (template_id) REFERENCES email_templates(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_categories add constraint knowledge_categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES knowledge_categories(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_document_versions add constraint knowledge_document_versions_knowledge_document_id_fkey FOREIGN KEY (knowledge_document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_documents add constraint knowledge_documents_category_id_fkey FOREIGN KEY (category_id) REFERENCES knowledge_categories(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_documents add constraint knowledge_documents_linked_client_id_fkey FOREIGN KEY (linked_client_id) REFERENCES clients(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.knowledge_documents add constraint knowledge_documents_linked_vendor_id_fkey FOREIGN KEY (linked_vendor_id) REFERENCES vendors(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.meeting_prep_notes add constraint meeting_prep_notes_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.normalized_transactions add constraint normalized_transactions_category_id_fkey FOREIGN KEY (category_id) REFERENCES accounting_categories(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.normalized_transactions add constraint normalized_transactions_client_id_fkey FOREIGN KEY (client_id) REFERENCES clients(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.normalized_transactions add constraint normalized_transactions_document_id_fkey FOREIGN KEY (document_id) REFERENCES documents(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.normalized_transactions add constraint normalized_transactions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_accounts add constraint outreach_accounts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_accounts add constraint outreach_accounts_linked_tenant_id_fkey FOREIGN KEY (linked_tenant_id) REFERENCES tenants(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_accounts add constraint outreach_accounts_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_accounts add constraint outreach_accounts_updated_by_user_id_fkey FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_contacts add constraint outreach_contacts_account_id_fkey FOREIGN KEY (account_id) REFERENCES outreach_accounts(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_contacts add constraint outreach_contacts_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_conversations add constraint outreach_conversations_operator_user_id_fkey FOREIGN KEY (operator_user_id) REFERENCES users(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_interactions add constraint outreach_interactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES outreach_accounts(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_interactions add constraint outreach_interactions_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES outreach_contacts(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_interactions add constraint outreach_interactions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.outreach_messages add constraint outreach_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES outreach_conversations(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_linked_client_id_fkey FOREIGN KEY (linked_client_id) REFERENCES clients(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_linked_document_id_fkey FOREIGN KEY (linked_document_id) REFERENCES documents(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_linked_transaction_id_fkey FOREIGN KEY (linked_transaction_id) REFERENCES normalized_transactions(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_linked_vendor_id_fkey FOREIGN KEY (linked_vendor_id) REFERENCES vendors(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES tasks(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.tasks add constraint tasks_recurrence_parent_task_id_fkey FOREIGN KEY (recurrence_parent_task_id) REFERENCES tasks(id); exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

do $do$ begin alter table public.vendor_subscriptions add constraint vendor_subscriptions_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE; exception when duplicate_table then null; when duplicate_object then null; when invalid_table_definition then null; end $do$;

CREATE INDEX IF NOT EXISTS idx_documents_search ON public.documents USING gin (to_tsvector('english'::regconfig, ((((COALESCE(name, ''::text) || ' '::text) || COALESCE(notes, ''::text)) || ' '::text) || COALESCE(extracted_text, ''::text))));

CREATE INDEX IF NOT EXISTS idx_email_campaign_enrollments_campaign ON public.email_campaign_enrollments USING btree (campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_launch ON public.email_campaigns USING btree (status, launch_at);

CREATE INDEX IF NOT EXISTS idx_email_events_message_timestamp ON public.email_events USING btree (email_message_id, event_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_email_events_recipient_fk ON public.email_events USING btree (email_recipient_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_provider_message_id ON public.email_messages USING btree (provider_message_id);

CREATE INDEX IF NOT EXISTS idx_email_messages_status_scheduled ON public.email_messages USING btree (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_email_recipients_contact ON public.email_recipients USING btree (client_contact_id, email_message_id);

CREATE INDEX IF NOT EXISTS idx_fk_category_rules_8392b20d ON public.category_rules USING btree (assign_vendor_id);

CREATE INDEX IF NOT EXISTS idx_fk_category_rules_f140fa44 ON public.category_rules USING btree (assign_category_id);

CREATE INDEX IF NOT EXISTS idx_fk_client_contacts_ab92dc1c ON public.client_contacts USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_client_interactions_e85bbb50 ON public.client_interactions USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_client_issues_cab1ccc0 ON public.client_issues USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_client_pipeline_history_302be26c ON public.client_pipeline_history USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_decision_journal_entries_9f046790 ON public.decision_journal_entries USING btree (parent_entry_id);

CREATE INDEX IF NOT EXISTS idx_fk_demo_requests_a9af618e ON public.demo_requests USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_documents_65330b1a ON public.documents USING btree (linked_transaction_id);

CREATE INDEX IF NOT EXISTS idx_fk_documents_68e75925 ON public.documents USING btree (linked_client_id);

CREATE INDEX IF NOT EXISTS idx_fk_documents_6b35f415 ON public.documents USING btree (linked_vendor_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_campaign_enrollments_0391f581 ON public.email_campaign_enrollments USING btree (last_message_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_campaign_enrollments_6f0d4ef1 ON public.email_campaign_enrollments USING btree (client_contact_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_campaigns_14892800 ON public.email_campaigns USING btree (sender_identity_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_campaigns_883fbba8 ON public.email_campaigns USING btree (template_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_campaigns_970c5283 ON public.email_campaigns USING btree (segment_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_messages_1fc15891 ON public.email_messages USING btree (template_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_messages_bf2b7ceb ON public.email_messages USING btree (sequence_step_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_messages_c7ce4000 ON public.email_messages USING btree (sender_identity_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_messages_dd88f4b3 ON public.email_messages USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_module_settings_c313d61a ON public.email_module_settings USING btree (default_sender_identity_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_notes_b8fd9863 ON public.email_notes USING btree (email_message_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_recipients_2705d64e ON public.email_recipients USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_recipients_6e7469ae ON public.email_recipients USING btree (email_message_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_segment_members_1cbb4c25 ON public.email_segment_members USING btree (segment_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_segment_members_5f42d9ea ON public.email_segment_members USING btree (client_contact_id);

CREATE INDEX IF NOT EXISTS idx_fk_email_sequence_steps_3e5f0990 ON public.email_sequence_steps USING btree (template_id);

CREATE INDEX IF NOT EXISTS idx_fk_knowledge_categories_62053927 ON public.knowledge_categories USING btree (parent_id);

CREATE INDEX IF NOT EXISTS idx_fk_knowledge_documents_82301fae ON public.knowledge_documents USING btree (linked_vendor_id);

CREATE INDEX IF NOT EXISTS idx_fk_knowledge_documents_a348e2ba ON public.knowledge_documents USING btree (linked_client_id);

CREATE INDEX IF NOT EXISTS idx_fk_knowledge_documents_d10ca3bb ON public.knowledge_documents USING btree (category_id);

CREATE INDEX IF NOT EXISTS idx_fk_meeting_prep_notes_af1e3063 ON public.meeting_prep_notes USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_normalized_transactions_4a0901d6 ON public.normalized_transactions USING btree (client_id);

CREATE INDEX IF NOT EXISTS idx_fk_normalized_transactions_54ab0472 ON public.normalized_transactions USING btree (category_id);

CREATE INDEX IF NOT EXISTS idx_fk_normalized_transactions_9ccf5a3b ON public.normalized_transactions USING btree (document_id);

CREATE INDEX IF NOT EXISTS idx_fk_normalized_transactions_bd913c42 ON public.normalized_transactions USING btree (vendor_id);

CREATE INDEX IF NOT EXISTS idx_fk_outreach_accounts_2cd5d17d ON public.outreach_accounts USING btree (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_fk_outreach_accounts_8db4319d ON public.outreach_accounts USING btree (updated_by_user_id);

CREATE INDEX IF NOT EXISTS idx_fk_outreach_accounts_ba9e9203 ON public.outreach_accounts USING btree (owner_user_id);

CREATE INDEX IF NOT EXISTS idx_fk_outreach_contacts_29e9ddfe ON public.outreach_contacts USING btree (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_fk_outreach_interactions_4759fea0 ON public.outreach_interactions USING btree (created_by_user_id);

CREATE INDEX IF NOT EXISTS idx_fk_outreach_interactions_5c43892d ON public.outreach_interactions USING btree (contact_id);

CREATE INDEX IF NOT EXISTS idx_fk_tasks_19fc838c ON public.tasks USING btree (linked_transaction_id);

CREATE INDEX IF NOT EXISTS idx_fk_tasks_31c7f5da ON public.tasks USING btree (linked_document_id);

CREATE INDEX IF NOT EXISTS idx_fk_tasks_3aaafc87 ON public.tasks USING btree (linked_vendor_id);

CREATE INDEX IF NOT EXISTS idx_fk_tasks_745b5e6c ON public.tasks USING btree (recurrence_parent_task_id);

CREATE INDEX IF NOT EXISTS idx_fk_tasks_b73ce346 ON public.tasks USING btree (linked_client_id);

CREATE INDEX IF NOT EXISTS idx_fk_tasks_dba8df69 ON public.tasks USING btree (parent_task_id);

CREATE INDEX IF NOT EXISTS idx_fk_vendor_subscriptions_d4dc18b1 ON public.vendor_subscriptions USING btree (vendor_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_search ON public.knowledge_documents USING gin (to_tsvector('english'::regconfig, ((COALESCE(title, ''::text) || ' '::text) || COALESCE(markdown_content, ''::text))));

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_accounts_linked_tenant ON public.outreach_accounts USING btree (linked_tenant_id) WHERE (linked_tenant_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_outreach_accounts_next_action ON public.outreach_accounts USING btree (next_action_due_at) WHERE (next_action_due_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_outreach_accounts_stage ON public.outreach_accounts USING btree (stage, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_contacts_account ON public.outreach_contacts USING btree (account_id, is_primary DESC, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_contacts_account_email ON public.outreach_contacts USING btree (account_id, lower(email)) WHERE (email <> ''::text);

CREATE INDEX IF NOT EXISTS idx_outreach_conversations_operator ON public.outreach_conversations USING btree (operator_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_interactions_account_occurred ON public.outreach_interactions USING btree (account_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_messages_conversation ON public.outreach_messages USING btree (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_web_vital_events_metric_created ON public.web_vital_events USING btree (name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_web_vital_events_route_created ON public.web_vital_events USING btree (route_group, created_at DESC);

CREATE INDEX IF NOT EXISTS pb_mongo_mirror_collection_idx ON public.pb_mongo_mirror USING btree (collection);

CREATE INDEX IF NOT EXISTS pb_mongo_mirror_synced_idx ON public.pb_mongo_mirror USING btree (synced_at DESC);

CREATE INDEX IF NOT EXISTS pb_mongo_mirror_tenant_idx ON public.pb_mongo_mirror USING btree (tenant_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.trigger_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

drop trigger if exists set_updated_at_categories on public.accounting_categories;
CREATE TRIGGER set_updated_at_categories BEFORE UPDATE ON public.accounting_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_rules on public.category_rules;
CREATE TRIGGER set_updated_at_rules BEFORE UPDATE ON public.category_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_client_contacts on public.client_contacts;
CREATE TRIGGER set_updated_at_client_contacts BEFORE UPDATE ON public.client_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_client_interactions on public.client_interactions;
CREATE TRIGGER set_updated_at_client_interactions BEFORE UPDATE ON public.client_interactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_client_issues on public.client_issues;
CREATE TRIGGER set_updated_at_client_issues BEFORE UPDATE ON public.client_issues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_client_pipeline_history on public.client_pipeline_history;
CREATE TRIGGER set_updated_at_client_pipeline_history BEFORE UPDATE ON public.client_pipeline_history FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_clients on public.clients;
CREATE TRIGGER set_updated_at_clients BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_contact_email_preferences on public.contact_email_preferences;
CREATE TRIGGER set_updated_at_contact_email_preferences BEFORE UPDATE ON public.contact_email_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_credentials_metadata on public.credentials_metadata;
CREATE TRIGGER set_updated_at_credentials_metadata BEFORE UPDATE ON public.credentials_metadata FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_decision_journal_entries on public.decision_journal_entries;
CREATE TRIGGER set_updated_at_decision_journal_entries BEFORE UPDATE ON public.decision_journal_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_demo_requests_updated_at on public.demo_requests;
CREATE TRIGGER set_demo_requests_updated_at BEFORE UPDATE ON public.demo_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_documents on public.documents;
CREATE TRIGGER set_updated_at_documents BEFORE UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_campaign_enrollments on public.email_campaign_enrollments;
CREATE TRIGGER set_updated_at_email_campaign_enrollments BEFORE UPDATE ON public.email_campaign_enrollments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_campaigns on public.email_campaigns;
CREATE TRIGGER set_updated_at_email_campaigns BEFORE UPDATE ON public.email_campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_messages on public.email_messages;
CREATE TRIGGER set_updated_at_email_messages BEFORE UPDATE ON public.email_messages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_module_settings on public.email_module_settings;
CREATE TRIGGER set_updated_at_email_module_settings BEFORE UPDATE ON public.email_module_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_segments on public.email_segments;
CREATE TRIGGER set_updated_at_email_segments BEFORE UPDATE ON public.email_segments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_sender_identities on public.email_sender_identities;
CREATE TRIGGER set_updated_at_email_sender_identities BEFORE UPDATE ON public.email_sender_identities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_sequence_steps on public.email_sequence_steps;
CREATE TRIGGER set_updated_at_email_sequence_steps BEFORE UPDATE ON public.email_sequence_steps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_email_templates on public.email_templates;
CREATE TRIGGER set_updated_at_email_templates BEFORE UPDATE ON public.email_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_infrastructure_assets on public.infrastructure_assets;
CREATE TRIGGER set_updated_at_infrastructure_assets BEFORE UPDATE ON public.infrastructure_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_knowledge_categories on public.knowledge_categories;
CREATE TRIGGER set_updated_at_knowledge_categories BEFORE UPDATE ON public.knowledge_categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_knowledge_documents on public.knowledge_documents;
CREATE TRIGGER set_updated_at_knowledge_documents BEFORE UPDATE ON public.knowledge_documents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_meeting_prep_notes on public.meeting_prep_notes;
CREATE TRIGGER set_updated_at_meeting_prep_notes BEFORE UPDATE ON public.meeting_prep_notes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_transactions on public.normalized_transactions;
CREATE TRIGGER set_updated_at_transactions BEFORE UPDATE ON public.normalized_transactions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at on public.outreach_accounts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.outreach_accounts FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

drop trigger if exists set_updated_at on public.outreach_contacts;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.outreach_contacts FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

drop trigger if exists set_updated_at on public.outreach_conversations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.outreach_conversations FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

drop trigger if exists set_updated_at on public.outreach_interactions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.outreach_interactions FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

drop trigger if exists set_updated_at on public.outreach_messages;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.outreach_messages FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

drop trigger if exists set_updated_at_tasks on public.tasks;
CREATE TRIGGER set_updated_at_tasks BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_vendor_subscriptions on public.vendor_subscriptions;
CREATE TRIGGER set_updated_at_vendor_subscriptions BEFORE UPDATE ON public.vendor_subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

drop trigger if exists set_updated_at_vendors on public.vendors;
CREATE TRIGGER set_updated_at_vendors BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at();
