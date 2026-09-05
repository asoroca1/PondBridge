-- Adopt the RLS, policies and RPC functions that no repo migration creates.
--
-- Companion to 20260904220000_adopt_untracked_production_tables.sql, which captured
-- structure only. Generated 2026-09-04 from the production catalog (pg_get_functiondef,
-- pg_policies), not written by hand.
--
-- Found by comparing production against a database built purely from
-- supabase/migrations. The column hashes matched, but access control did not:
--
--                     production   from-repo
--   functions              24          20
--   RLS policies          181          77
--   RLS-enabled tables     87          46
--
-- The 41-table and 104-policy gaps are exactly the tables adopted by the companion
-- migration -- structure came across, RLS did not, so those tables would have been
-- created with row-level security OFF.
--
-- The four functions are the more serious half. They are RPCs the API calls, created
-- by six migrations that were applied to production but whose files were never
-- committed (performance_correctness_hardening, database_advisor_hardening,
-- tier_search_privileges, notification_claim_safety, admin_profile_pagination,
-- atomic_pre_member_purge). Without them a from-scratch environment comes up broken.
--
-- Idempotent: CREATE OR REPLACE for functions, ENABLE RLS is a no-op when already on,
-- and each policy is dropped before being recreated.

CREATE OR REPLACE FUNCTION public.claim_due_mobile_notification_schedules(p_now timestamp with time zone DEFAULT now(), p_limit integer DEFAULT 25)
 RETURNS SETOF mobile_notification_schedules
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'public'
AS $function$ with due as (select s.id from public.mobile_notification_schedules s where s.status = 'pending' and s.run_at <= coalesce(p_now, now()) order by s.run_at asc, s.id asc for update skip locked limit greatest(1, least(coalesce(p_limit, 25), 200))) update public.mobile_notification_schedules s set status = 'sending', attempted_at = coalesce(p_now, now()), updated_at = now() from due where s.id = due.id returning s.*; $function$
;

CREATE OR REPLACE FUNCTION public.list_admin_profiles(p_tenant_id text, p_query text DEFAULT ''::text, p_status text[] DEFAULT NULL::text[], p_role text DEFAULT ''::text, p_sort text DEFAULT 'name_asc'::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  with filtered as materialized (
    select p.*
    from public.profiles p
    where p.tenant_id = p_tenant_id
      and (p_status is null or p.status = any(p_status))
      and (coalesce(p_role, '') = '' or p.role_at_camp ilike p_role)
      and not exists (
        select 1
        from regexp_split_to_table(lower(trim(coalesce(p_query, ''))), '\s+') token
        where token <> '' and position(token in lower(concat_ws(' ',
          trim(p.first_name), trim(p.last_name),
          trim(p.first_name) || ' ' || trim(p.last_name),
          trim(p.last_name) || ' ' || trim(p.first_name),
          array_to_string(p.emails, ' '), p.city_state, p.role_at_camp,
          array_to_string(p.college_years, ' ')
        ))) = 0
      )
  ), ordered as (
    select f, row_number() over (order by
      case when p_sort = 'name_asc' then f.last_name end asc,
      case when p_sort = 'name_asc' then f.first_name end asc,
      case when p_sort = 'name_desc' then f.last_name end desc,
      case when p_sort = 'name_desc' then f.first_name end desc,
      case when p_sort = 'join_asc' then f.created_at end asc,
      case when p_sort not in ('name_asc', 'name_desc', 'join_asc') then f.created_at end desc,
      f.id asc
    ) as ordinal
    from filtered f
  ), page as (
    select * from ordered order by ordinal
    offset greatest(0, coalesce(p_offset, 0))
    limit greatest(1, least(coalesce(p_limit, 50), 100))
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(page.f) order by ordinal) from page), '[]'::jsonb),
    'total', (select count(*) from filtered)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.purge_pre_member_person(p_tenant_id text, p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  normalized_email text := lower(trim(coalesce(p_email, '')));
  contacts_deleted integer;
  invites_deleted integer;
  requests_deleted integer;
begin
  if coalesce(trim(p_tenant_id), '') = '' or normalized_email = '' then
    raise exception 'Tenant and email are required' using errcode = '22023';
  end if;
  -- The member workflow owns linked accounts and all their related data.
  -- Recheck here rather than trusting an earlier application-level read.
  if exists (select 1 from public.users where tenant_id = p_tenant_id and lower(email) = normalized_email) then
    raise exception 'This person has an account; use member deletion' using errcode = '23514';
  end if;

  delete from public.alumni_contacts where tenant_id = p_tenant_id and lower(email) = normalized_email;
  get diagnostics contacts_deleted = row_count;
  delete from public.invites where tenant_id = p_tenant_id and lower(email) = normalized_email;
  get diagnostics invites_deleted = row_count;
  delete from public.access_requests where tenant_id = p_tenant_id and lower(email) = normalized_email;
  get diagnostics requests_deleted = row_count;

  return jsonb_build_object('contacts', contacts_deleted, 'invites', invites_deleted, 'requests', requests_deleted);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_city_prefix(p_prefix text, p_limit integer DEFAULT 10)
 RETURNS TABLE(key text, city text, state text, country text, population integer)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  select c.key, c.city, c.state, c.country, c.population
  from public.city_geo c
  where lower(c.city) like lower(trim(coalesce(p_prefix, ''))) || '%'
  order by c.population desc, c.city asc, c.state asc, c.key asc
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$function$
;

alter table public.accounting_categories enable row level security;

alter table public.audit_logs enable row level security;

alter table public.category_rules enable row level security;

alter table public.client_contacts enable row level security;

alter table public.client_interactions enable row level security;

alter table public.client_issues enable row level security;

alter table public.client_pipeline_history enable row level security;

alter table public.clients enable row level security;

alter table public.contact_email_preferences enable row level security;
alter table public.contact_email_preferences force row level security;

alter table public.credentials_metadata enable row level security;

alter table public.decision_journal_entries enable row level security;

alter table public.demo_requests enable row level security;

alter table public.documents enable row level security;

alter table public.email_campaign_enrollments enable row level security;
alter table public.email_campaign_enrollments force row level security;

alter table public.email_campaigns enable row level security;
alter table public.email_campaigns force row level security;

alter table public.email_events enable row level security;
alter table public.email_events force row level security;

alter table public.email_messages enable row level security;
alter table public.email_messages force row level security;

alter table public.email_module_settings enable row level security;
alter table public.email_module_settings force row level security;

alter table public.email_notes enable row level security;
alter table public.email_notes force row level security;

alter table public.email_recipients enable row level security;
alter table public.email_recipients force row level security;

alter table public.email_segment_members enable row level security;
alter table public.email_segment_members force row level security;

alter table public.email_segments enable row level security;
alter table public.email_segments force row level security;

alter table public.email_sender_identities enable row level security;
alter table public.email_sender_identities force row level security;

alter table public.email_sequence_steps enable row level security;
alter table public.email_sequence_steps force row level security;

alter table public.email_templates enable row level security;
alter table public.email_templates force row level security;

alter table public.infrastructure_assets enable row level security;

alter table public.knowledge_categories enable row level security;

alter table public.knowledge_document_versions enable row level security;

alter table public.knowledge_documents enable row level security;

alter table public.meeting_prep_notes enable row level security;

alter table public.normalized_transactions enable row level security;

alter table public.outreach_accounts enable row level security;
alter table public.outreach_accounts force row level security;

alter table public.outreach_contacts enable row level security;
alter table public.outreach_contacts force row level security;

alter table public.outreach_conversations enable row level security;
alter table public.outreach_conversations force row level security;

alter table public.outreach_interactions enable row level security;
alter table public.outreach_interactions force row level security;

alter table public.outreach_messages enable row level security;
alter table public.outreach_messages force row level security;

alter table public.pb_mongo_mirror enable row level security;
alter table public.pb_mongo_mirror force row level security;

alter table public.tasks enable row level security;

alter table public.vendor_subscriptions enable row level security;

alter table public.vendors enable row level security;

alter table public.web_vital_events enable row level security;
alter table public.web_vital_events force row level security;

drop policy if exists "authenticated can mutate categories delete" on public.accounting_categories;
create policy "authenticated can mutate categories delete" on public.accounting_categories as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate categories insert" on public.accounting_categories;
create policy "authenticated can mutate categories insert" on public.accounting_categories as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate categories update" on public.accounting_categories;
create policy "authenticated can mutate categories update" on public.accounting_categories as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read categories" on public.accounting_categories;
create policy "authenticated can read categories" on public.accounting_categories as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can read audit logs" on public.audit_logs;
create policy "authenticated can read audit logs" on public.audit_logs as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can write audit logs" on public.audit_logs;
create policy "authenticated can write audit logs" on public.audit_logs as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate rules delete" on public.category_rules;
create policy "authenticated can mutate rules delete" on public.category_rules as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate rules insert" on public.category_rules;
create policy "authenticated can mutate rules insert" on public.category_rules as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate rules update" on public.category_rules;
create policy "authenticated can mutate rules update" on public.category_rules as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read rules" on public.category_rules;
create policy "authenticated can read rules" on public.category_rules as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate client contacts delete" on public.client_contacts;
create policy "authenticated can mutate client contacts delete" on public.client_contacts as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate client contacts insert" on public.client_contacts;
create policy "authenticated can mutate client contacts insert" on public.client_contacts as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate client contacts update" on public.client_contacts;
create policy "authenticated can mutate client contacts update" on public.client_contacts as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read client contacts" on public.client_contacts;
create policy "authenticated can read client contacts" on public.client_contacts as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate client interactions delete" on public.client_interactions;
create policy "authenticated can mutate client interactions delete" on public.client_interactions as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate client interactions insert" on public.client_interactions;
create policy "authenticated can mutate client interactions insert" on public.client_interactions as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate client interactions update" on public.client_interactions;
create policy "authenticated can mutate client interactions update" on public.client_interactions as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read client interactions" on public.client_interactions;
create policy "authenticated can read client interactions" on public.client_interactions as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate client issues delete" on public.client_issues;
create policy "authenticated can mutate client issues delete" on public.client_issues as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate client issues insert" on public.client_issues;
create policy "authenticated can mutate client issues insert" on public.client_issues as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate client issues update" on public.client_issues;
create policy "authenticated can mutate client issues update" on public.client_issues as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read client issues" on public.client_issues;
create policy "authenticated can read client issues" on public.client_issues as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate client pipeline history delete" on public.client_pipeline_history;
create policy "authenticated can mutate client pipeline history delete" on public.client_pipeline_history as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate client pipeline history update" on public.client_pipeline_history;
create policy "authenticated can mutate client pipeline history update" on public.client_pipeline_history as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate client pipeline history insert" on public.client_pipeline_history;
create policy "authenticated can mutate client pipeline history insert" on public.client_pipeline_history as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can read client pipeline history" on public.client_pipeline_history;
create policy "authenticated can read client pipeline history" on public.client_pipeline_history as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate clients delete" on public.clients;
create policy "authenticated can mutate clients delete" on public.clients as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate clients insert" on public.clients;
create policy "authenticated can mutate clients insert" on public.clients as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate clients update" on public.clients;
create policy "authenticated can mutate clients update" on public.clients as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read clients" on public.clients;
create policy "authenticated can read clients" on public.clients as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists contact_email_preferences_service_role_all on public.contact_email_preferences;
create policy contact_email_preferences_service_role_all on public.contact_email_preferences as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists "authenticated can mutate credentials metadata insert" on public.credentials_metadata;
create policy "authenticated can mutate credentials metadata insert" on public.credentials_metadata as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate credentials metadata update" on public.credentials_metadata;
create policy "authenticated can mutate credentials metadata update" on public.credentials_metadata as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate credentials metadata delete" on public.credentials_metadata;
create policy "authenticated can mutate credentials metadata delete" on public.credentials_metadata as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can read credentials metadata" on public.credentials_metadata;
create policy "authenticated can read credentials metadata" on public.credentials_metadata as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate decision journal entries update" on public.decision_journal_entries;
create policy "authenticated can mutate decision journal entries update" on public.decision_journal_entries as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate decision journal entries insert" on public.decision_journal_entries;
create policy "authenticated can mutate decision journal entries insert" on public.decision_journal_entries as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate decision journal entries delete" on public.decision_journal_entries;
create policy "authenticated can mutate decision journal entries delete" on public.decision_journal_entries as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can read decision journal entries" on public.decision_journal_entries;
create policy "authenticated can read decision journal entries" on public.decision_journal_entries as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate demo requests delete" on public.demo_requests;
create policy "authenticated can mutate demo requests delete" on public.demo_requests as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate demo requests insert" on public.demo_requests;
create policy "authenticated can mutate demo requests insert" on public.demo_requests as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate demo requests update" on public.demo_requests;
create policy "authenticated can mutate demo requests update" on public.demo_requests as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read demo requests" on public.demo_requests;
create policy "authenticated can read demo requests" on public.demo_requests as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "service role can insert demo requests" on public.demo_requests;
create policy "service role can insert demo requests" on public.demo_requests as PERMISSIVE for INSERT to service_role with check (true);

drop policy if exists "authenticated can mutate documents delete" on public.documents;
create policy "authenticated can mutate documents delete" on public.documents as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate documents insert" on public.documents;
create policy "authenticated can mutate documents insert" on public.documents as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate documents update" on public.documents;
create policy "authenticated can mutate documents update" on public.documents as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read documents" on public.documents;
create policy "authenticated can read documents" on public.documents as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists email_campaign_enrollments_service_role_all on public.email_campaign_enrollments;
create policy email_campaign_enrollments_service_role_all on public.email_campaign_enrollments as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_campaigns_service_role_all on public.email_campaigns;
create policy email_campaigns_service_role_all on public.email_campaigns as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_events_service_role_all on public.email_events;
create policy email_events_service_role_all on public.email_events as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_messages_service_role_all on public.email_messages;
create policy email_messages_service_role_all on public.email_messages as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_module_settings_service_role_all on public.email_module_settings;
create policy email_module_settings_service_role_all on public.email_module_settings as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_notes_service_role_all on public.email_notes;
create policy email_notes_service_role_all on public.email_notes as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_recipients_service_role_all on public.email_recipients;
create policy email_recipients_service_role_all on public.email_recipients as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_segment_members_service_role_all on public.email_segment_members;
create policy email_segment_members_service_role_all on public.email_segment_members as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_segments_service_role_all on public.email_segments;
create policy email_segments_service_role_all on public.email_segments as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_sender_identities_service_role_all on public.email_sender_identities;
create policy email_sender_identities_service_role_all on public.email_sender_identities as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_sequence_steps_service_role_all on public.email_sequence_steps;
create policy email_sequence_steps_service_role_all on public.email_sequence_steps as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists email_templates_service_role_all on public.email_templates;
create policy email_templates_service_role_all on public.email_templates as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists "authenticated can mutate infrastructure assets update" on public.infrastructure_assets;
create policy "authenticated can mutate infrastructure assets update" on public.infrastructure_assets as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate infrastructure assets delete" on public.infrastructure_assets;
create policy "authenticated can mutate infrastructure assets delete" on public.infrastructure_assets as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate infrastructure assets insert" on public.infrastructure_assets;
create policy "authenticated can mutate infrastructure assets insert" on public.infrastructure_assets as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can read infrastructure assets" on public.infrastructure_assets;
create policy "authenticated can read infrastructure assets" on public.infrastructure_assets as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate knowledge categories update" on public.knowledge_categories;
create policy "authenticated can mutate knowledge categories update" on public.knowledge_categories as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate knowledge categories delete" on public.knowledge_categories;
create policy "authenticated can mutate knowledge categories delete" on public.knowledge_categories as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate knowledge categories insert" on public.knowledge_categories;
create policy "authenticated can mutate knowledge categories insert" on public.knowledge_categories as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can read knowledge categories" on public.knowledge_categories;
create policy "authenticated can read knowledge categories" on public.knowledge_categories as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate knowledge document versions update" on public.knowledge_document_versions;
create policy "authenticated can mutate knowledge document versions update" on public.knowledge_document_versions as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate knowledge document versions insert" on public.knowledge_document_versions;
create policy "authenticated can mutate knowledge document versions insert" on public.knowledge_document_versions as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate knowledge document versions delete" on public.knowledge_document_versions;
create policy "authenticated can mutate knowledge document versions delete" on public.knowledge_document_versions as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can read knowledge document versions" on public.knowledge_document_versions;
create policy "authenticated can read knowledge document versions" on public.knowledge_document_versions as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate knowledge documents update" on public.knowledge_documents;
create policy "authenticated can mutate knowledge documents update" on public.knowledge_documents as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate knowledge documents delete" on public.knowledge_documents;
create policy "authenticated can mutate knowledge documents delete" on public.knowledge_documents as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate knowledge documents insert" on public.knowledge_documents;
create policy "authenticated can mutate knowledge documents insert" on public.knowledge_documents as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can read knowledge documents" on public.knowledge_documents;
create policy "authenticated can read knowledge documents" on public.knowledge_documents as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate meeting prep notes insert" on public.meeting_prep_notes;
create policy "authenticated can mutate meeting prep notes insert" on public.meeting_prep_notes as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate meeting prep notes update" on public.meeting_prep_notes;
create policy "authenticated can mutate meeting prep notes update" on public.meeting_prep_notes as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate meeting prep notes delete" on public.meeting_prep_notes;
create policy "authenticated can mutate meeting prep notes delete" on public.meeting_prep_notes as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can read meeting prep notes" on public.meeting_prep_notes;
create policy "authenticated can read meeting prep notes" on public.meeting_prep_notes as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate transactions delete" on public.normalized_transactions;
create policy "authenticated can mutate transactions delete" on public.normalized_transactions as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate transactions insert" on public.normalized_transactions;
create policy "authenticated can mutate transactions insert" on public.normalized_transactions as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate transactions update" on public.normalized_transactions;
create policy "authenticated can mutate transactions update" on public.normalized_transactions as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read transactions" on public.normalized_transactions;
create policy "authenticated can read transactions" on public.normalized_transactions as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists outreach_accounts_service_role_all on public.outreach_accounts;
create policy outreach_accounts_service_role_all on public.outreach_accounts as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists outreach_contacts_service_role_all on public.outreach_contacts;
create policy outreach_contacts_service_role_all on public.outreach_contacts as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists outreach_conversations_service_role_all on public.outreach_conversations;
create policy outreach_conversations_service_role_all on public.outreach_conversations as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists outreach_interactions_service_role_all on public.outreach_interactions;
create policy outreach_interactions_service_role_all on public.outreach_interactions as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists outreach_messages_service_role_all on public.outreach_messages;
create policy outreach_messages_service_role_all on public.outreach_messages as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists pb_mongo_mirror_authenticated_tenant_scope on public.pb_mongo_mirror;
create policy pb_mongo_mirror_authenticated_tenant_scope on public.pb_mongo_mirror as PERMISSIVE for ALL to authenticated using (((jwt_tenant_id() <> ''::text) AND (tenant_id = jwt_tenant_id()))) with check (((jwt_tenant_id() <> ''::text) AND (tenant_id = jwt_tenant_id())));

drop policy if exists pb_mongo_mirror_service_role_all on public.pb_mongo_mirror;
create policy pb_mongo_mirror_service_role_all on public.pb_mongo_mirror as PERMISSIVE for ALL to service_role using (true) with check (true);

drop policy if exists "authenticated can mutate tasks delete" on public.tasks;
create policy "authenticated can mutate tasks delete" on public.tasks as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate tasks insert" on public.tasks;
create policy "authenticated can mutate tasks insert" on public.tasks as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate tasks update" on public.tasks;
create policy "authenticated can mutate tasks update" on public.tasks as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read tasks" on public.tasks;
create policy "authenticated can read tasks" on public.tasks as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate vendor subscriptions update" on public.vendor_subscriptions;
create policy "authenticated can mutate vendor subscriptions update" on public.vendor_subscriptions as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can mutate vendor subscriptions insert" on public.vendor_subscriptions;
create policy "authenticated can mutate vendor subscriptions insert" on public.vendor_subscriptions as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate vendor subscriptions delete" on public.vendor_subscriptions;
create policy "authenticated can mutate vendor subscriptions delete" on public.vendor_subscriptions as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can read vendor subscriptions" on public.vendor_subscriptions;
create policy "authenticated can read vendor subscriptions" on public.vendor_subscriptions as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists "authenticated can mutate vendors delete" on public.vendors;
create policy "authenticated can mutate vendors delete" on public.vendors as PERMISSIVE for DELETE to authenticated using (true);

drop policy if exists "authenticated can mutate vendors insert" on public.vendors;
create policy "authenticated can mutate vendors insert" on public.vendors as PERMISSIVE for INSERT to authenticated with check (true);

drop policy if exists "authenticated can mutate vendors update" on public.vendors;
create policy "authenticated can mutate vendors update" on public.vendors as PERMISSIVE for UPDATE to authenticated using (true) with check (true);

drop policy if exists "authenticated can read vendors" on public.vendors;
create policy "authenticated can read vendors" on public.vendors as PERMISSIVE for SELECT to authenticated using (true);

drop policy if exists web_vital_events_service_role_all on public.web_vital_events;
create policy web_vital_events_service_role_all on public.web_vital_events as PERMISSIVE for ALL to service_role using (true) with check (true);
