# Backup and recovery

Owner: PondBridge operator. Verified 2026-09-08. Evidence is in [evidence](evidence/).

## Current protection

The production Management API confirms **Pro**, **7 days** of backup retention,
Micro compute, and **PITR disabled**. Nine completed physical backups were visible
from September 1–8; the extra visible entries do not extend the seven-day entitlement.
The latest completed backup is timestamped September 8 at 10:00 UTC. Restore to a new project is entitled.
No paid settings were changed. See [Supabase evidence](evidence/supabase-backups-2026-09-08.json).

Daily backups imply a nominal recovery-point objective of up to 24 hours when
daily backups succeed; verify the actual latest completed backup during an incident.
Production recovery time is **unmeasured**. Supabase documents downtime during
restore, excludes Storage object bytes from database backups, and removes provider
backups when a project is deleted. Physical backups are not downloadable. PITR is
an additional paid option and requires at least Small compute. See
[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

No independent production data copy, Storage object recovery, external media
recovery, or provider-level restore was tested in this exercise. Do not describe
the local result as complete disaster recovery. Decide whether a daily recovery
point is acceptable before onboarding camps that require less data loss. A separate
encrypted backup destination, retention policy, access owner, and media recovery
procedure remain necessary for recovery independent of the provider.

## Routine check and safe rehearsal

1. Weekly and before a significant migration, use the authenticated Supabase CLI:
   `supabase backups list --project-ref "$PRODUCTION_PROJECT_REF" --output json`.
   Confirm a recent `COMPLETED` backup and the PITR flag. Escalate a missing/failed
   daily backup or one older than 26 hours. Save timestamps/status only, never keys.
   The [entitlements API](https://supabase.com/docs/reference/api/v1-get-organization-entitlements)
   confirms the contractual `backup.retention_days`; visible entries alone do not.
2. Monthly and after recovery-sensitive schema changes, start the existing local
   Supabase environment without resetting it, then run:

   ```sh
   python3 scripts/rehearseRecovery.py > /tmp/pondbridge-recovery-evidence.json
   ```

   The script requires local Docker and Python 3. It reads only the existing local
   database schema, creates two random disposable databases, inserts synthetic
   `.invalid` records, takes an in-memory custom-format backup, and restores it.
   It never connects to a hosted project or reads existing application rows.
   It drops only databases successfully created by that invocation. If interrupted
   forcibly, inspect the generated `pb_recovery_*` names before manually removing
   that run's abandoned databases; never reset the existing local environment.
3. Review the JSON result, retain it with the date and release commit, and investigate
   any mismatch before declaring the rehearsal successful. The test compares all
   restored public tables, policies, RLS flags, function definitions, ACLs and
   constraints. It verifies fixture data, client access denial, both tenant scopes,
   a cross-tenant update, and the service-only atomic undo RPC. Temporary grants
   used to probe RLS are rolled back and catalog equality is rechecked.

The September 8 rehearsal passed in 4.10 seconds for a 634 KB synthetic archive.
It restored the local schema (48 public tables, 78 policies, 24 functions), using
existing cluster roles and extension binaries. It does not test role provisioning
on another host. Production's catalog-only check found 88/88 public tables with
RLS, 181 policies, 27 functions, and the expected service-only undo RPC. The local
fixture is deliberately smaller; production capacity and provider recovery time
cannot be inferred from this timing.

## Incident restore procedure

1. Record the incident time, impacted tenants, latest good release and recovery
   point. Pause application writes and outbound workers using the deployment
   controls; keep evidence of the failure. Do not delete the original project.
2. Select the most recent known-good completed backup in Supabase's backup view.
   Prefer restore to a **new isolated project** when available. Confirm its identity
   and isolation before any restore. An in-place production restore discards newer
   writes and causes downtime: obtain explicit incident authorization for that
   concrete recovery point and impact. The rehearsal script never performs this.
3. Keep the restored environment disconnected from production workers, email,
   payments and webhooks. Reconcile environment configuration and external identity
   settings through the secrets store; do not copy secrets into tickets or dumps.
   Restore media separately through the designated storage/provider procedure.
4. Verify schema/migration ledger, table counts, foreign keys, RLS, grants and
   service-only functions; compare approved record samples privately. Test two
   synthetic tenants, login/claim, import/undo and access controls without sending
   real notifications. Check deployed code is compatible with the restored schema.
5. Record data loss since the recovery point and reconcile external payment/email
   state without replaying side effects blindly. After the owner accepts validation,
   switch application configuration, run smoke checks, then resume writes/workers.
   Retain the original project until rollback and incident retention requirements
   are satisfied. Record measured RPO/RTO and update this runbook.
