-- The operator identified the current super-admin console as the staff tool.
-- Its routes use server-side getSupabaseAdmin/service_role; operating costs use
-- platform_operating_costs. These legacy tables are not queried by the web app.
-- Retain server grants and existing RLS; remove unrestricted browser-role access.
REVOKE ALL PRIVILEGES ON TABLE
  public.clients,
  public.vendors,
  public.vendor_subscriptions,
  public.documents,
  public.client_contacts,
  public.client_interactions,
  public.client_pipeline_history,
  public.client_issues,
  public.meeting_prep_notes,
  public.knowledge_categories,
  public.knowledge_documents,
  public.knowledge_document_versions,
  public.infrastructure_assets,
  public.credentials_metadata,
  public.decision_journal_entries,
  public.accounting_categories,
  public.normalized_transactions,
  public.category_rules,
  public.audit_logs,
  public.tasks,
  public.demo_requests
FROM anon, authenticated;
