# Durable access-approval email rollout

An approval now creates one `approval_email` job in the same database transaction that changes an access request to `approved`. The request ID is the durable idempotency key. The worker freezes the complete message, auth-stream sender, and a transport fingerprint before the first provider call, then reuses that exact payload and key for every retry.

This is an essential account notification. It bypasses marketing preferences, but still blocks a hard-bounced or complained recipient through the suppression store. A suppression-store outage fails closed and retries. A suppressed recipient is recorded as a failed job; it is never counted as sent. A request or active-member state that changed before delivery is recorded as a terminal skipped outcome.

The worker attempts transient failures up to 15 times with exponential backoff capped at two hours, within the job's 23-hour provider idempotency window. A provider rejection is terminal. A successful job retains the provider message ID and removes the frozen message body from its state. Delivery acceptance cannot guarantee inbox placement.

## Rollout

The deployment order is required because the previous worker does not recognize `approval_email` jobs:

1. Deploy the new API code to every replica. Confirm the previous rollout is drained and every running worker has the `approval_email` handler. Before the migration, approval routes continue their legacy inline delivery with the same stable request key.
2. Apply `20260909020000_durable_access_approval_email.sql`. The readiness probe starts essential-job claims within 30 seconds even when optional durable jobs are disabled.
3. Approve one controlled staging request. Confirm the API returns an `approvalEmail` job ID/status, exactly one job exists for its request key, and the successful job records a provider message ID.
4. Watch queued/running/failed approval jobs and the shared dispatch clock before resuming normal approval volume.

Do not backfill historical approved requests. Absence of a job does not prove historical non-delivery, and the existing GreenLane approvals were separately reconciled against provider delivery evidence.

## Operator check

Use service-role access and avoid selecting the payload or frozen `state.prepared` content:

```sql
select
  id,
  tenant_id,
  status,
  attempts,
  last_error,
  state->>'outcome' as outcome,
  state->>'providerMessageId' as provider_message_id,
  created_at,
  updated_at
from public.tenant_background_jobs
where kind = 'approval_email'
order by created_at desc
limit 100;
```

Treat `failed`, `PERMANENT:APPROVAL_EMAIL_RECIPIENT_SUPPRESSED`, `handoff_unknown`, and jobs still queued beyond their expected `run_at` as requiring operator attention. Marketing unsubscription alone does not suppress this account notification.

## Rollback

Do not roll API code back while the approval trigger can create jobs that an older worker cannot handle. First disable the trigger in a reviewed rollback migration:

```sql
alter table public.access_requests disable trigger trigger_enqueue_access_approval_email;
```

Keep the new workers running until all existing `approval_email` jobs are terminal. Then remove the trigger/function and restore the prior queue functions and kind constraint in a reviewed migration before rolling API code back. Disabling the trigger causes the still-current API to use the stable-key inline fallback for later approvals, so approval decisions do not silently lose their notification attempt during rollback.
