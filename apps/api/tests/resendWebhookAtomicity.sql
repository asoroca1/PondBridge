-- Run only in an empty isolated test database after the baseline tables and migration.
INSERT INTO public.tenants(id) VALUES ('tenant-a'),('tenant-b');
INSERT INTO public.email_broadcasts(id,tenant_id,subject,status,recipient_count,stats)
VALUES ('broadcast-a','tenant-a','fixture','scheduled',2,'{"delivery":{"messageIds":["email-a"],"acceptedCount":2}}'),
       ('broadcast-b','tenant-b','fixture','scheduled',2,'{}');

-- Force the LAST effect to fail: earlier receipt, suppression and stats must roll back.
CREATE FUNCTION public.audit_fail_analytics() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'injected analytics failure'; END; $$;
CREATE TRIGGER audit_fail_analytics BEFORE INSERT ON public.analytics_events
FOR EACH ROW EXECUTE FUNCTION public.audit_fail_analytics();
DO $$
DECLARE e jsonb := '{"svix_id":"retry-event","event_type":"email.bounced","recipient_email":"member@example.test","tenant_id":"tenant-a","email_id":"email-a","pondbridge_broadcast_id":"broadcast-a"}';
BEGIN
  BEGIN
    PERFORM public.process_resend_webhook_event(e);
    RAISE EXCEPTION 'expected injected failure';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'injected analytics failure' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT FROM public.resend_webhook_events) OR EXISTS (SELECT FROM public.email_suppressions)
    OR (SELECT stats ? 'webhook' FROM public.email_broadcasts WHERE id='broadcast-a') THEN
    RAISE EXCEPTION 'partial effects persisted';
  END IF;
END $$;
DROP TRIGGER audit_fail_analytics ON public.analytics_events;
DROP FUNCTION public.audit_fail_analytics();
DO $$
DECLARE e jsonb := '{"svix_id":"retry-event","event_type":"email.bounced","recipient_email":"member@example.test","tenant_id":"tenant-a","email_id":"email-a","pondbridge_broadcast_id":"broadcast-a"}';
BEGIN
  IF NOT public.process_resend_webhook_event(e) THEN RAISE EXCEPTION 'retry did not process'; END IF;
  IF public.process_resend_webhook_event(e) THEN RAISE EXCEPTION 'duplicate processed'; END IF;
  IF (SELECT count(*) FROM public.analytics_events) <> 1 OR
     (SELECT count(*) FROM public.email_suppressions WHERE status='active') <> 1 OR
     (SELECT stats#>>'{webhook,bounced}' FROM public.email_broadcasts WHERE id='broadcast-a') <> '1' THEN
    RAISE EXCEPTION 'retry effects missing or duplicated';
  END IF;
  -- A broadcast tag cannot cross the resolved tenant boundary.
  PERFORM public.process_resend_webhook_event('{"svix_id":"cross-tenant","event_type":"email.delivered","recipient_email":"member@example.test","tenant_id":"tenant-a","email_id":"other-email","pondbridge_broadcast_id":"broadcast-b"}');
  IF (SELECT stats FROM public.email_broadcasts WHERE id='broadcast-b') <> '{}'::jsonb THEN
    RAISE EXCEPTION 'cross tenant broadcast changed';
  END IF;
  -- Unknown tenant suppressions still persist without invalid analytics rows.
  PERFORM public.process_resend_webhook_event('{"svix_id":"unknown-tenant","event_type":"email.complained","recipient_email":"unknown@example.test"}');
  IF NOT EXISTS (SELECT FROM public.email_suppressions WHERE email='unknown@example.test') THEN
    RAISE EXCEPTION 'unattributed complaint lost';
  END IF;
  IF has_function_privilege('anon','public.process_resend_webhook_event(jsonb)','EXECUTE') OR
     has_function_privilege('authenticated','public.process_resend_webhook_event(jsonb)','EXECUTE') OR
     NOT has_function_privilege('service_role','public.process_resend_webhook_event(jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'RPC grants are incorrect';
  END IF;
END $$;
