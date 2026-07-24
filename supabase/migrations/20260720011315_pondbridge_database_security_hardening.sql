BEGIN;

-- Pin every PondBridge function to an explicit schema search path. This
-- prevents a caller-controlled or role-controlled search_path from changing
-- which objects a function resolves at runtime.
DO $$
DECLARE
  signature text;
  function_oid regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.lower_immutable(text)',
    'public.join_text_array_immutable(text[],text)'
  ]
  LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog', function_oid);
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', function_oid);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', function_oid);
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'public.enforce_single_tenant_membership()',
    'public.enforce_profile_user_tenant_consistency()',
    'public.enforce_member_block_tenant_consistency()',
    'public.enforce_content_report_tenant_consistency()'
  ]
  LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', function_oid);
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        function_oid
      );
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_oid);
    END IF;
  END LOOP;

  function_oid := to_regprocedure('public.trigger_set_updated_at()');
  IF function_oid IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog', function_oid);
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_oid
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_oid);
  END IF;

  FOREACH signature IN ARRAY ARRAY[
    'public.search_profiles(text,text,text,text,text,integer)',
    'public.top_search_terms(text,timestamp with time zone,integer)',
    'public.distinct_active_user_ids(text,text[],timestamp with time zone)',
    'public.ai_usage_summary(text,text,timestamp with time zone)'
  ]
  LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NOT NULL THEN
      IF signature = 'public.search_profiles(text,text,text,text,text,integer)' THEN
        EXECUTE format(
          'ALTER FUNCTION %s SET search_path = pg_catalog, public, extensions',
          function_oid
        );
      ELSE
        EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog, public', function_oid);
      END IF;
      EXECUTE format(
        'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
        function_oid
      );
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', function_oid);
    END IF;
  END LOOP;

  FOREACH signature IN ARRAY ARRAY[
    'public.jwt_tenant_id()',
    'public.jwt_roles()',
    'public.jwt_has_role(text)'
  ]
  LOOP
    function_oid := to_regprocedure(signature);
    IF function_oid IS NOT NULL THEN
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path = pg_catalog, public, auth',
        function_oid
      );
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', function_oid);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', function_oid);
    END IF;
  END LOOP;
END;
$$;

-- PondBridge does not use the Supabase Data API from the browser. Keep the
-- service role explicit and close anon/authenticated table privileges even if
-- an older project inherited Supabase's historical default grants.
DO $$
DECLARE
  table_name text;
BEGIN
  GRANT USAGE ON SCHEMA public TO service_role;
  FOREACH table_name IN ARRAY ARRAY[
    'tenants', 'users', 'profiles', 'invites', 'alumni_contacts', 'access_requests',
    'magic_link_tokens', 'conversations', 'messages', 'forums', 'forum_posts',
    'photos', 'newsletters', 'events', 'event_rsvps', 'event_messages',
    'email_broadcasts', 'family_trees', 'analytics_events', 'import_reports',
    'tenant_admin_audit_logs', 'platform_admin_audit_logs', 'feature_rollouts',
    'ai_generations', 'email_preferences', 'identities', 'tenant_memberships',
    'member_blocks', 'content_reports', 'resume_parse_results', 'city_geo',
    'activity_items', 'mobile_notifications', 'mobile_notification_devices',
    'mobile_notification_preferences', 'mobile_notification_templates',
    'mobile_notification_schedules', 'resend_webhook_events',
    'stripe_webhook_events', 'email_suppressions'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role',
        table_name
      );
      EXECUTE format(
        'REVOKE ALL ON public.%I FROM anon, authenticated',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

COMMIT;
