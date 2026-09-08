# Signup and email reliability

## Shipped incident recovery

Green Lane recovery release #147 is live. A fresh Clerk Backend API record must identify a verified primary email and explicit Green Lane member signup intent before recovery can create a pending access request. The service cannot invent age confirmation or legal acceptance, approve anyone, reopen a denied request, or attach an existing account from another camp. Stored server provenance survives email changes. Consent completion preserves the person's names, and recovered approval atomically creates the linked account, identity, membership and profile.

The one-time repair recovered all 43 original candidates; all 43 passed the exact director People Directory check. The continuing worker completed a full production scan with no errors or duplicate requests. It retains a leased database cursor and retries an interrupted page. Signed Clerk user events are supported; the periodic scan is the verified fallback. Verify the external webhook's event subscriptions before claiming immediate event-driven recovery.

The retained recipient audit expanded from 143 to 145 people during the work. Both new verified accounts already had pending director requests. Existing 85 approved requests all had approval-email sent and delivered evidence; none warranted a historical resend. A separately authorized reminder was sent to 13 incomplete accounts after fresh Clerk, request, membership and suppression checks. The hard-bounced address was excluded. No invitation records were replaced: Green Lane's open signup link preserves its existing director-review policy and email-matched invitations.

## Approval notification design

An approval and its durable email intent must commit together. The worker freezes the sender and message before calling Resend, reuses one provider idempotency key, retries temporary failures with bounded backoff, and exposes queued/failed status. Existing historical approvals are not backfilled. Account approvals use the verified account-email sending domain; broadcasts and invitations use the separate updates domain.

This reduces lost handoffs and duplicate sends. It cannot make an invalid mailbox deliverable or guarantee inbox placement. Provider acceptance, recipient-server delivery, bounce and complaint are distinct states. Open and click tracking remain disabled; a delivered webhook is never labeled read or inbox-confirmed.

## Permanent incomplete-signup process to add

This is a proposed policy, not an enabled automatic campaign. The operator authorized the one-time 13-person reminder; no broader reminder automation is activated by this document.

| Component | Rule | Acceptance check |
| --- | --- | --- |
| Signup status | Show invited, setup incomplete, verified but consent needed, pending director review, approved, and notification delivery as separate states. | Every tenant-scoped recipient has one current stage; an unverified address never becomes an approved member. |
| Completion reminder | At most one reminder after 24 hours to an existing camp-invited address with recent signup intent and no Clerk account, request or membership. Apply a 30-day recipient cooldown and seven-day relevance window. | Fresh eligibility is checked immediately before dispatch; completion, suppression, bounce, complaint or opt-out cancels the reminder. |
| Reminder durability | Persist a deduplicated intent and frozen message with a stable key. Link to the existing signup flow, preserving valid invitations. | Crashes and retries cannot cause another reminder or create access for the recipient. |
| Delivery health | Track accepted/delivered/blocked/failed by message purpose and camp. Alert the operator when a required approval email is terminally failed or remains queued more than 15 minutes. | A controlled provider outage creates a visible retry state and failure alert; no failure is represented as sent. |
| Signup health | Alert on a verified eligible account lacking a request after the expected recovery sweep, and on stale or failed reconciliation cycles. | Drop a synthetic callback and webhook; the scan repairs it once and records its provenance. |
| Growth checks | Measure full-sweep duration, queue age, provider quota, bounce and complaint cohorts at 3,000–12,000 members. | Verify webhook subscriptions, then tune bounded scan throughput and upgrade plans before sustained 80% utilization. |

Before enabling reminders, review the above cadence and operator alert destination, add the tenant-scoped state view and durable eligibility tests, and exercise the policy with synthetic recipients. Never create a second request for a denied person or retry a hard-bounced address without correction.

## Release checks

Keep regressions for tokenless verified invitations, consent return routes, missing browser state, duplicate callbacks, concurrent approve/deny, changed email addresses, spoofed recovery fields, provider timeouts, lost provider acknowledgements, suppression changes, queue lease expiry and non-target camp isolation. Real-schema SQL tests must cover atomic rollback and service-only permissions. Ordinary multi-step approval/reactivation remains a separate transaction-hardening follow-up; the atomic recovered-account path is already covered.
