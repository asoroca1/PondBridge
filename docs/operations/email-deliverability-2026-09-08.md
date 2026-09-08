# Email delivery changes — September 8, 2026

Green Lane's Resend delivery screenshots demonstrate provider acceptance by recipient mail servers, not inbox placement or completion of access requests. The pasted HTML does not expose SPF/DKIM/DMARC results or recipient filtering decisions. No recipient mailbox access or real test emails were used.

## Completed configuration and code

Created dedicated `auth.pondbridgealumni.com` and `updates.pondbridgealumni.com` sending domains in Resend, with open/click tracking off, sending enabled and receiving disabled. Published the following DNS records through the existing Cloudflare connection; public DNS resolves the required records. The existing apex Microsoft 365 records are preserved. Both domains were verified by Resend on September 8, 2026. The two sender overrides were then configured on Render; deployment `dep-dag7i79t0dsc73e7vieg` applies the change.

| Type | Name | Value | Priority |
| --- | --- | --- | --- |
| TXT | `resend._domainkey.auth.pondbridgealumni.com` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDIRhi051geVh6prXfl7lc/S8WOWr+A4lBPqZ3/G5Cpj/RTtACFqapIBkxVuaxJyCI5LOXfIBX6jxDaDvnV8H+Tcyj8zwLWIHReW4qWCT30t4kwuvdsT+LhMRVXiPMg2RyOV9qamTKEemY3+FZMnxsHWpVcmWcCFvVpx0Mk0ElqhQIDAQAB` | — |
| MX | `send.auth.pondbridgealumni.com` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send.auth.pondbridgealumni.com` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc.auth.pondbridgealumni.com` | `v=DMARC1; p=none;` | — |
| TXT | `resend._domainkey.updates.pondbridgealumni.com` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCUVZrtaN1h6cgZeEZ+9yVDR9EbSGzMB6e168DNf6YC61KEKR1xMCfIPd082/MpUnTzsk//omZNFHrLOhFmpyHw8gK+7FZUYxpoqTvGZpl3tXOgdiACF6X/Qv+gSu/TpRYw6nQIfZrJXgKbjNNa3dpqciNA0BqPfW8NEz6yMufkOQIDAQAB` | — |
| MX | `send.updates.pondbridgealumni.com` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| TXT | `send.updates.pondbridgealumni.com` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc.updates.pondbridgealumni.com` | `v=DMARC1; p=none;` | — |

TTL is automatic for all records. TXT/MX records are not proxied.

The optional `EMAIL_AUTH_FROM` and `EMAIL_BULK_FROM` settings separate account codes/reset/sign-in traffic from invitations, claims and broadcasts. Blank settings preserve `EMAIL_FROM`. Configured values are `PondBridge <accounts@auth.pondbridgealumni.com>` and `PondBridge <updates@updates.pondbridgealumni.com>`. Tenant display names and tenant address local parts remain camp-specific. Only those two Render variables were merged into the existing configuration; rollback by clearing the two overrides and redeploying. Domain separation helps organize reputation by message type but does not erase existing reputation or guarantee placement. Introduce new bulk traffic gradually to engaged, permissioned recipients.

Account verification, password reset and sign-in templates no longer depend on remote logo images and no longer claim that notification preferences can disable essential security mail. HTML and plain text include unsolicited-request guidance. The camp name, color and readable code remain. The synthetic verification email was rendered and visually inspected locally.

Bulk sending now stops if suppression storage cannot be checked. Durable batches also stop if suppression eligibility changes after preparation, preserving provider idempotency. Existing bounced/complained recipients remain suppressed; no suppression was removed. These guards protect sender reputation without preventing account mail merely because an unrelated bulk job is waiting.

The existing root sending domain is verified, with tracking disabled. The root DMARC record remains `p=none`; stricter enforcement requires checking all legitimate Microsoft 365 and third-party senders first. No paid deliverability add-on, dedicated IP, billing upgrade or production campaign was purchased/sent.

## Capacity and remaining evidence

Plan for 3,000–12,000 members. One monthly update per member means 3,000–12,000 bulk emails before account/invitation traffic; four updates means 12,000–48,000. Measure all messages sent through the email API, including broadcasts. Free's 100/day and 3,000/month cannot support a same-day 600-person launch. Select a paid email volume tier with at least 25% headroom above actual monthly use; upgrade before 80% sustained utilization. The current paid Resend tier is not exposed by the connected API and the browser session did not yield billing access, so no paid tier is asserted.

The historical sample had 209 bounce events and 1,998 distinct sent message IDs, including 194 bounces with no specific SMTP diagnosis. These are not a cohort-matched provider bounce rate. Stop targeting stale/unverified alumni lists and use suppression, recent engagement and camp-validated addresses; don't retry hard bounces. Dedicated IP purchase is not a first-line fix for this intermittent volume.

Remaining externally measurable work: exact billing tier/remaining quota; receiver-side placement or Postmaster data; ongoing cohort-matched bounce and complaint rates; DMARC reports with an operator-controlled reporting destination. A delivered webhook cannot prove inbox placement.

## Sources

- [Resend quotas and limits](https://resend.com/docs/knowledge-base/account-quotas-and-limits)
- [Resend domain separation and warm-up](https://www.resend.com/blog/how-to-warm-up-a-new-domain)
- [Resend verification troubleshooting](https://resend.com/docs/knowledge-base/what-if-my-domain-is-not-verifying)
- [Resend pricing and dedicated-IP eligibility](https://resend.com/pricing)
- [Google sender requirements](https://support.google.com/mail/answer/81126?hl=en)


## Integration validation

The combined release passed 711 safe API tests plus four provider-readiness tests, 463 web tests, ESLint (two existing API warnings), production build, web performance budgets and tracked-environment checks. The final queue migration was applied to hosted staging and production with its migration ledger entry. Staging confirmed both new tables have RLS, authenticated users cannot read jobs or execute the claim RPC, service-role execution is enabled, and camp deletion cascades queue cleanup. The synthetic account-code template was inspected in a local browser; no email was sent.
