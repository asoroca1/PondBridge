# Stripe Billing Audit (2026-02-23)

## 1. Existing implementation inventory

### 1.1 Stripe/billing code paths found
- `apps/api/src/services/billing.js`
  - Stripe client construction
  - checkout session creation
  - billing portal session creation
  - webhook event parsing + processing
- `apps/api/src/routes/stripeWebhook.js`
  - `/api/webhooks/stripe` endpoint
- `apps/api/src/routes/super.js`
  - super-admin checkout trigger: `POST /api/super/tenants/:id/create-checkout`
- `apps/api/src/routes/tenants.js`
  - tenant billing read/update endpoints:
    - `GET /api/tenants/me/billing`
    - `PATCH /api/tenants/me/billing`
    - `PATCH /api/tenants/me/plan`
- `apps/api/src/routes/admin.js`
  - tenant admin billing summary endpoint:
    - `GET /api/t/:slug/admin/billing`

### 1.2 Existing assumptions/gaps
- Billing unit is already **tenant/camp** (good).
- Plan model currently assumes only `base` and `premium`.
- Onboarding fee can be arbitrary numeric in requests.
- No founders plan/cap enforcement exists.
- Webhook processing is not idempotent across duplicate deliveries.
- Webhook processing handles only a subset of events and stores minimal reconciliation metadata.
- Director checkout entrypoint is missing (checkout is currently super-admin initiated).

## 2. Existing schema/data model audit

### 2.1 Tenant billing fields currently present
From `apps/api/scripts/native_schema.sql` and `TenantModel`:
- `plan_tier`
- `onboarding_fee_amount`
- `onboarding_fee_paid`
- `onboarding_fee_invoice_id`
- `stripe_customer_id`
- `stripe_subscription_id`
- `stripe_price_id`
- `billing_status`
- `billing_grace_until`
- `billing_details` (JSON)
- `settings` (JSON, can hold structured billing metadata)

### 2.2 Identity and membership
- Identity/auth uses Clerk/legacy hybrid in current code.
- Tenant membership/roles are stored in `users` (`tenant_id`, roles array).
- Billing is already linked to tenant, not to alumni users.

## 3. Stripe ↔ PondBridge mapping used for implementation

### 3.1 Paying entity
- Stripe `Customer` maps to **tenant/camp**.
- Director is billing operator, but tenant owns billing state.

### 3.2 Object mapping
- Stripe `Checkout Session` -> tenant `settings.billing.lastCheckout*` + `billing_status` transition starter
- Stripe `Subscription` -> tenant `stripe_subscription_id`, `stripe_price_id`, lifecycle status, renewal date
- Stripe `Invoice` -> tenant payment status + onboarding fee paid marker + last invoice reference
- Stripe `PaymentIntent` -> tenant payment diagnostics in billing metadata (when applicable)

### 3.3 Authoritative state
- Stripe webhooks are the source of truth for billing transitions.
- Client redirect to success URL does not mark payment as completed.

## 4. Canonical commercial catalog implementation choices

- Legacy: annual recurring + onboarding fee
- Founders: annual recurring only, onboarding fee waived
- Institutional: annual recurring + onboarding fee

Internal compatibility:
- `plan_tier` remains feature tier (`base`/`premium`) for existing feature gating.
- New billing plan identifier is stored in tenant `settings.billing.planCode`:
  - `legacy`
  - `founders`
  - `institutional`

## 5. Founders plan enforcement approach

Chosen mechanism:
- Persist reservation/grant metadata per tenant under `settings.billing`:
  - `foundersReserved`
  - `foundersReservedAt`
  - `foundersSlot` (1-10)
- Availability computed server-side from tenant records.
- Founders purchase denied once 10 slots are reserved/granted.

## 6. Security and tenancy invariants

- Checkout/session creation remains server-only.
- All tenant billing operations validate actor role and tenant scope.
- Webhook tenant resolution uses metadata first, then Stripe customer/subscription fallback.
- No client-provided “paid” signal is trusted.

## 7. Remaining compatibility notes

- Existing super-admin analytics pages still consume `plan_tier` and `billing_status`; implementation keeps these fields populated.
- New richer billing lifecycle metadata is stored in `settings.billing` to avoid breaking existing constraints.
