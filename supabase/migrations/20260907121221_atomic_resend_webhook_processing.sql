-- A receipt means its effects committed. Any failure rolls the entire RPC back,
-- so provider redelivery can retry without losing suppressions or double counting.
CREATE OR REPLACE FUNCTION public.process_resend_webhook_event(p_event jsonb)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_receipt_id text;
  v_type text := p_event->>'event_type';
  v_email text := lower(trim(coalesce(p_event->>'recipient_email', '')));
  v_tenant text := nullif(p_event->>'tenant_id', '');
  v_slug text := coalesce(p_event->>'tenant_slug', '');
  v_email_id text := coalesce(p_event->>'email_id', '');
  v_broadcast_id text := coalesce(p_event->>'broadcast_id', '');
  v_at timestamptz := coalesce((p_event->>'occurred_at')::timestamptz, now());
  v_payload jsonb := coalesce(p_event->'payload', '{}'::jsonb);
  v_broadcast public.email_broadcasts%ROWTYPE;
  v_stats jsonb;
  v_webhook jsonb;
  v_counter text;
  v_sent numeric;
BEGIN
  IF nullif(p_event->>'svix_id', '') IS NULL OR v_type NOT IN
    ('email.sent','email.delivered','email.bounced','email.complained','email.clicked',
     'email.failed','email.delivery_delayed','email.suppressed') OR v_type IS NULL THEN
    RAISE EXCEPTION 'Invalid Resend event';
  END IF;
  INSERT INTO public.resend_webhook_events
    (svix_id,event_type,email_id,broadcast_id,recipient_email,tenant_id,tenant_slug,occurred_at,payload)
  VALUES (p_event->>'svix_id',v_type,v_email_id,v_broadcast_id,v_email,v_tenant,v_slug,v_at,v_payload)
  ON CONFLICT (svix_id,recipient_email) DO NOTHING
  RETURNING id INTO v_receipt_id;
  IF v_receipt_id IS NULL THEN RETURN false; END IF;

  IF v_type IN ('email.bounced','email.complained') AND v_email <> '' THEN
    INSERT INTO public.email_suppressions
      (email,status,reason,source_event_type,first_seen_at,last_seen_at,last_email_id,
       last_broadcast_id,tenant_id,tenant_slug,metadata)
    VALUES (v_email,'active',coalesce(nullif(v_payload#>>'{data,bounce,message}',''),
      nullif(v_payload#>>'{data,complaint,message}',''),
      CASE WHEN v_type='email.complained' THEN 'Recipient marked the email as spam.'
           ELSE 'Recipient address bounced.' END),v_type,v_at,v_at,v_email_id,v_broadcast_id,v_tenant,v_slug,
      jsonb_build_object('bounce',coalesce(v_payload#>'{data,bounce}','{}'::jsonb),
        'complaint',coalesce(v_payload#>'{data,complaint}','{}'::jsonb),'eventCreatedAt',v_payload->'created_at'))
    ON CONFLICT (email) DO UPDATE SET
      status='active',reason=excluded.reason,source_event_type=excluded.source_event_type,
      last_seen_at=greatest(public.email_suppressions.last_seen_at,excluded.last_seen_at),
      last_email_id=excluded.last_email_id,last_broadcast_id=excluded.last_broadcast_id,
      tenant_id=coalesce(excluded.tenant_id,public.email_suppressions.tenant_id),
      tenant_slug=coalesce(nullif(excluded.tenant_slug,''),public.email_suppressions.tenant_slug),
      metadata=public.email_suppressions.metadata || excluded.metadata;
  END IF;

  IF v_tenant IS NOT NULL AND v_email_id <> '' THEN
    -- The row lock serializes different webhook events updating the same totals.
    SELECT b.* INTO v_broadcast FROM public.email_broadcasts b
    WHERE b.tenant_id=v_tenant AND b.id=nullif(p_event->>'pondbridge_broadcast_id','')
    FOR UPDATE;
    IF NOT FOUND THEN
      SELECT b.* INTO v_broadcast FROM public.email_broadcasts b
      WHERE b.tenant_id=v_tenant AND
        (coalesce(b.stats#>'{delivery,messageIds}','[]'::jsonb) ? v_email_id OR
         coalesce(b.stats#>'{providerSchedule,messageIds}','[]'::jsonb) ? v_email_id)
      ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE;
    END IF;
    IF v_broadcast.id IS NOT NULL THEN
      v_stats := coalesce(v_broadcast.stats,'{}'::jsonb);
      v_webhook := jsonb_build_object('totalEvents',0,'sent',0,'delivered',0,'bounced',0,
        'complained',0,'clicked',0,'failed',0,'deliveryDelayed',0,'suppressed',0) ||
        coalesce(v_stats->'webhook','{}'::jsonb);
      v_counter := CASE v_type WHEN 'email.delivery_delayed' THEN 'deliveryDelayed'
        ELSE substring(v_type FROM 7) END;
      v_webhook := v_webhook || jsonb_build_object(
        'totalEvents',coalesce((v_webhook->>'totalEvents')::numeric,0)+1,
        v_counter,coalesce((v_webhook->>v_counter)::numeric,0)+1);
      IF nullif(v_webhook->>'lastEventAt','') IS NULL OR
         v_at >= (v_webhook->>'lastEventAt')::timestamptz THEN
        v_webhook := v_webhook || jsonb_build_object('lastEventAt',v_at,'lastRecipient',v_email);
      END IF;
      v_sent := coalesce(nullif((v_stats#>>'{delivery,acceptedCount}')::numeric,0),
        nullif((v_stats#>>'{delivery,sentCount}')::numeric,0),v_broadcast.recipient_count,0);
      v_stats := v_stats || jsonb_build_object('webhook',v_webhook,
        'clickRate',CASE WHEN v_sent>0 THEN round((v_webhook->>'clicked')::numeric/v_sent*100,1) ELSE 0 END,
        'bounceRate',CASE WHEN v_sent>0 THEN round((v_webhook->>'bounced')::numeric/v_sent*100,1) ELSE 0 END,
        'complaintRate',CASE WHEN v_sent>0 THEN round((v_webhook->>'complained')::numeric/v_sent*100,1) ELSE 0 END);
      UPDATE public.email_broadcasts SET stats=v_stats,
        status=CASE WHEN v_type='email.sent' AND status='scheduled' THEN 'sent'
          WHEN v_type='email.failed' AND status='scheduled' AND (v_webhook->>'sent')::numeric=0
            AND (v_webhook->>'failed')::numeric>=v_sent THEN 'failed' ELSE status END,
        sent_at=CASE WHEN v_type='email.sent' AND status='scheduled' THEN v_at ELSE sent_at END
      WHERE id=v_broadcast.id AND tenant_id=v_tenant;
    END IF;
  END IF;
  IF v_tenant IS NOT NULL THEN
    INSERT INTO public.analytics_events (tenant_id,event_type,metadata,created_at)
    VALUES (v_tenant,v_type,jsonb_build_object('featureModule','email','emailId',v_email_id,
      'broadcastId',v_broadcast_id,'recipient',v_email),v_at);
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.process_resend_webhook_event(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.process_resend_webhook_event(jsonb) TO service_role;
