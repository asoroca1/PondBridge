# GreenLane historical approval email evidence

Read-only production check on 2026-09-08 at approximately 21:38 UTC. No messages were sent, no production records changed, and no recipient addresses or message bodies were exported.

| Evidence | Requests |
| --- | ---: |
| Approved GreenLane requests | 85 |
| Matching `access_approved` sent event | 85 |
| Matching delivered event | 85 |
| Missing delivered evidence | 0 |
| Failed, bounced, or complained evidence | 0 |
| More than one provider send ID | 0 |

These decisions span September 4–8. Each request matched tenant, normalized recipient address, exact `access_approved` category tag, and an event timestamp no earlier than one minute before its review timestamp. The tolerance allows application/database clock and webhook timestamp differences. The query returns aggregate counts only.

The evidence supports **no historical resend or repair** for this cohort. A delivered event records acceptance by the receiving mail server; it does not prove inbox placement or that the person read the message. This snapshot does not replace future delivery monitoring. The newly recovered pending requests have no approval decision yet and are outside this cohort.

## Repeatable read-only query

```sql
WITH approved AS (SELECT a.* FROM access_requests a JOIN tenants t ON t.id=a.tenant_id WHERE t.slug='greenlane' AND a.status='approved'), evidence AS (
SELECT a.id,count(DISTINCT e.email_id) FILTER(WHERE e.event_type='email.sent') sent,
count(DISTINCT e.email_id) FILTER(WHERE e.event_type='email.delivered') delivered,
count(DISTINCT e.email_id) FILTER(WHERE e.event_type IN('email.bounced','email.failed','email.complained')) failed
FROM approved a LEFT JOIN resend_webhook_events e ON e.tenant_id=a.tenant_id AND lower(e.recipient_email)=lower(a.email)
AND (e.payload#>>'{data,tags,category}'='access_approved' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.payload#>'{data,tags}')='array' THEN e.payload#>'{data,tags}' ELSE '[]'::jsonb END) tag WHERE tag->>'name'='category' AND tag->>'value'='access_approved')) AND e.occurred_at>=a.reviewed_at-interval '1 minute'
GROUP BY a.id)
SELECT count(*) approved,count(*) FILTER(WHERE sent>0) with_sent_evidence,count(*) FILTER(WHERE delivered>0) with_delivered_evidence,
count(*) FILTER(WHERE delivered=0) lacking_delivered_evidence,count(*) FILTER(WHERE failed>0) with_failure_evidence,
count(*) FILTER(WHERE sent>1) with_multiple_send_ids FROM evidence;
```

## Durable delivery review constraints

A future approved decision and its notification intent must commit in the same database transaction. A worker may retry that intent after a process crash, with the complete rendered message frozen before the provider call and a stable request-specific idempotency key. Suppressed, expired, and permanently failed jobs must remain visible as such. They must not be presented as delivered.

Resend retains idempotency keys for 24 hours and requires the same payload on retries. An uncertain attempt must not be retried after that protection expires without reconciling provider evidence. See [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys).
