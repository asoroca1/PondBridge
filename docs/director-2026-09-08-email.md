# Email delivery review — 2026-09-08

## Conclusion

No code defect reviewed here proves why an accepted verification or approval email landed in Junk. Provider delivery means the receiving mail server accepted it; it does not establish inbox placement. Diagnosis still needs the affected message's full received headers and mailbox-provider classification, correlated to its Resend ID. Do not describe the safeguard below as a fix for the reported spam placement.

The parent task reports verified Resend SPF/DKIM, root DMARC `p=none`, disabled open/click tracking, and a delivered Cedar approval sample with a camp-branded From address on `pondbridgealumni.com`, Gmail Reply-To, plain text, and a valid tenant login URL. This code review did not independently inspect provider settings or mailbox headers.

## Checked code

- Verification, password-reset, approval and invitation helpers pass both nonempty text and HTML into Resend JSON. Resend produces the email MIME; the application need not manually supply a multipart boundary. No missing-text defect was found in these templates.
- Tenant sender branding uses the configured sender domain, with the camp slug as its local part. It does not attempt to send From the director's Gmail address; that address is Reply-To. Director signup codes deliberately use PondBridge branding. Links come from the tenant URL builder.
- Clerk webhooks receive the raw request body before JSON middleware, forward the original request headers, and use the official Clerk `verifyWebhook` with the configured signing secret.
- Marketing in `admin.js` already supplies recipient-specific preference URLs, `List-Unsubscribe`, RFC 8058 `List-Unsubscribe-Post`, and `List-ID`. Those headers were preserved. No unsubscribe link was added to essential account verification emails.
- Bulk delivery deduplicates and filters suppressed primary recipients, uses bounded Resend batches (maximum 100), and retains per-recipient text, HTML and headers. Provider retries are bounded and reuse an idempotency key. There is no account-wide delivery-rate queue; several concurrent sends can contend for provider limits.
- Resend webhook processing handles bounce/complaint/suppression events. The application's suppression lookup currently fails open if the database lookup errors; this is an operational limitation, not evidence it happened to the reported message.

## Concrete correction

Previously, transactional sending checked only To addresses against suppression. CC/BCC could therefore re-send to an address already suppressed for bounce or complaint. Bulk batches also carried unchecked CC/BCC copies. All delivery recipients now pass the suppression gate; Reply-To remains excluded because it is not a destination. A blocked copy aborts before any provider call, allowing the operator to correct the audience rather than silently omit a requested recipient.

Six mocked regressions cover suppressed CC/BCC in individual and bulk sends, allowed copies, and Reply-To exclusion. Together with scheduling/retry, camp approval branding and Clerk verification tests: 25 tests passed. No real email, provider mutation or DNS change was performed. No `admin.js` edit is part of this fix.

## Separate reliability finding

Clerk email dispatch uses a three-second in-memory collapse timer. The webhook acknowledges `delivered: true` while the send is queued; provider failure is subsequently only logged, and recent-dispatch suppression is marked before acceptance. A process restart or failed send can lose a code without a durable retry. This deserves a separate queue/acknowledgment correction, but cannot explain a message already received in Junk. It was not changed during this bounded deliverability review.

## Source guidance and next evidence

Resend recommends authentication, relevant opt-in recipients, bounce/complaint suppression, consistent sending patterns, and monitoring receiver reputation. Its guidance does not establish a universal code change that guarantees inbox placement. See [Resend's Gmail deliverability guide](https://resend.com/docs/knowledge-base/how-do-i-avoid-gmails-spam-folder).

Essential authentication messages and marketing have different unsubscribe requirements; see [Resend's unsubscribe guidance](https://resend.com/docs/knowledge-base/should-i-add-an-unsubscribe-link). Keep existing marketing opt-out behavior. Changing DMARC enforcement, a sending subdomain or purchasing a dedicated IP should follow received-header/reputation evidence and a considered rollout; none was changed here.
