# Director approval and member confirmation

## Incident and intended behavior

On September 8, Green Lane's director could not approve the remaining 42 recovered requests. The recovery implementation required a saved age/terms confirmation before permitting any director decision. The original browser callback had failed before that confirmation reached the server. Bulk approval returned per-request failures, but the interface only reported a generic count.

Director approval and member activation are separate decisions. A director may approve a recovered request while the person still needs to confirm their age and accept the Terms and Privacy Policy. The system saves that approval and sends an essential account email with a completion link. The person appears in **Approved · setup pending**, outside the actionable Requests queue. They have no active camp user, membership, or profile until they personally complete confirmation with the matching verified identity.

After confirmation, the saved approval is finalized atomically and the normal account-ready notification is queued. A second director action is unnecessary. A director can withdraw an approval before activation. Concurrent confirmation and withdrawal must resolve through the locked request state; a stale action must never recreate a denied request or grant access.

## Boundaries

- Approval does not invent legal acceptance, age confirmation, or a different person's identity.
- Preapproval email and account-ready email have different purposes and durable idempotency keys. Retry each frozen message; do not manufacture a second send when an acknowledgement is uncertain.
- A preapproval message must instruct the person to finish setup. It must not claim the network is already accessible.
- No historical request is approved automatically by deploying this change. Directors make their own decisions.
- Keep Cedar's gate-off flow and ordinary completed-consent approvals working.

## Required regression evidence

- Director approval before consent saves one decision and one preapproval email intent, without creating member access.
- Duplicate approval clicks are harmless, and bulk approval excludes decisions already recorded.
- A matching verified person can complete real confirmation and activate exactly once; another identity cannot.
- Failed activation rolls back consent/activation changes together as specified by the transaction.
- Withdrawal racing with confirmation has one valid outcome, with no silent restoration after denial.
- The callback proceeds to session synchronization and the network after activation, rather than returning to the waiting page.
- The waiting page explains any remaining member action and offers a working confirmation link.
- Bulk processing stops on no progress, reports actionable failure information, and never labels partial work fully complete.

## Deployment

New preapproval email jobs reuse the approval-email worker with an additional message phase. Deploy compatible code to every API worker and drain the prior workers before enabling the new database trigger/function behavior. Rehearse with synthetic staging records and mock email, then verify production schema permissions, worker health, and queue state without approving real requests on the director's behalf. Keep the new worker available when rolling back until all new-phase jobs are terminal.
