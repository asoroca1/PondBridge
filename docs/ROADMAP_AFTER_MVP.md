# Roadmap After MVP

## 1. Custom Domains
- Add `tenantDomains` model/table mapping hostnames to tenant IDs.
- Automate domain verification + SSL (ACME or platform-managed certs).
- Expand `getTenantContext(req)` host resolver to include verified custom domains.

## 2. Analytics
- Add tenant-level events table (`profile_view`, `search_run`, `signup_completed`).
- Build analytics dashboard widgets (MAU, profile completeness, growth by month).
- Add export for analytics snapshots.

## 3. Invite-Only Signup (V2)
- Implement invite token model (`tenantId`, email, role, expiry, usedAt).
- Add admin invite UI with CSV upload and re-send support.
- Require valid invite token during registration when signup mode is `invite_only`.

## 4. Email Notifications
- Transactional email provider integration (Mailgun/Postmark/SES).
- Notification templates:
  - invite sent
  - welcome email
  - profile viewed / message received digest
- Tenant-level notification preferences and unsubscribe model.

## 5. Integrations
- CRM sync (HubSpot/Salesforce) for alumni records.
- SSO (Google/Microsoft SAML/OIDC) by tenant.
- Data import connectors (Google Sheets, Airtable, CSV scheduler).

## 6. Billing & Stripe Completion
- Replace placeholders with Stripe customer/subscription lifecycle.
- Support onboarding fee invoice + one-time payment intent.
- Add billing portal links and webhook-driven plan state updates.
