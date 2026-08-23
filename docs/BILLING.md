# Billing (Stripe + Mock Mode)

PondBridge sells **one plan: Flagship, $1,200/year**, billed annually through Stripe with
no onboarding fee. There is no plan ladder, no founders tier, and no upsell — every camp
gets the full feature set.

Two runtime modes exist:
- `stripe`: live Stripe Checkout + Webhooks + Billing Portal
- `mock`: no Stripe keys required, returns mock checkout/portal links for local development

`BILLING_MODE=stripe` is what production runs. `BILLING_MODE=auto` picks `stripe` only when a
Stripe key is configured, otherwise `mock`.

## The catalog
| Plan | Code | Price | Onboarding fee | Who sees it |
| --- | --- | --- | --- | --- |
| Flagship | `flagship` | $1,200/year | none | every camp |
| Internal Test | `test` | $10/year | none | only camps listed in `BILLING_TEST_PLAN_TENANTS` |

The internal test tier exists so live Stripe checkout can be exercised end to end without a
$1,200 charge. It is invisible unless a camp slug is explicitly allowlisted, and the API
rejects it with `BILLING_TEST_PLAN_NOT_ENABLED` for everyone else.

Retired codes (`legacy`, `founders`, `institutional`) are still accepted when read from
existing tenant records and normalize to `flagship`; they are rejected as *input* to
checkout. See `RETIRED_BILLING_PLAN_CODES` in `apps/api/src/services/billingState.js`.

## Environment Variables
Set in `/apps/api/.env`:

```env
BILLING_MODE=stripe

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

STRIPE_PRICE_FLAGSHIP_ANNUAL=
STRIPE_PRICE_TEST_ANNUAL=

STRIPE_SUCCESS_URL=
STRIPE_CANCEL_URL=
STRIPE_BILLING_PORTAL_RETURN_URL=
STRIPE_CURRENCY=usd
BILLING_TEST_PLAN_TENANTS=

MOCK_BILLING_BASE_URL=https://mock-billing.pondbridge.local
```

If `STRIPE_PRICE_FLAGSHIP_ANNUAL` is unset, checkout falls back to looking up an active
annual price on the Stripe product literally named `Flagship`. Setting the price ID
explicitly is faster and less fragile — the lookup exists only as a safety net.

## Live Stripe objects (production)
- Product `Flagship` — `prod_V5lyNQwTl5vsHG`
- Price `$1,200/year` — `price_1U5aQJKmSeC5JnMuSjZD4smU`
- Webhook endpoint — `https://api.pondbridgealumni.com/api/stripe/webhook`

## Tenant Billing Fields
Tenant stores:
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripePriceId`
- `billingStatus` (`trialing` | `active` | `past_due` | `canceled`)
- `onboardingFeePaid`
- `onboardingFeeInvoiceId`

Richer lifecycle metadata lives under `settings.billing` (`planCode`, `lifecycleStatus`,
`currentPeriodEnd`, invoice/payment-intent references, processed webhook event IDs).

## API Endpoints
- `POST /api/tenants/me/billing/checkout` — director-initiated checkout.
- `POST /api/t/:slug/admin/billing/checkout` — tenant-admin checkout.
- `POST /api/super/tenants/:id/create-checkout` — super-admin checkout.
- `POST /api/stripe/webhook` (primary Stripe dashboard endpoint)
  - Backward-compatible alias: `POST /api/webhooks/stripe`
  - Consumes `checkout.session.completed`, subscription updates, invoice and payment-intent events.
  - In mock mode, accepts a JSON payload with `{ type, data }`.
- `GET /api/tenants/me/billing` — tenant admin billing summary + manage subscription URL.

Stripe webhooks are the source of truth for billing transitions. A redirect to the success
URL never marks a payment complete on its own.

## Stripe CLI Testing
1. Start API:
```bash
npm run dev:api
```
2. In another terminal, login to Stripe CLI and forward webhooks:
```bash
stripe listen --forward-to http://localhost:4000/api/stripe/webhook
```
3. Copy the webhook signing secret from CLI output and set `STRIPE_WEBHOOK_SECRET`.
4. Start a checkout, open the returned `checkoutUrl`, complete payment.
5. Verify tenant billing fields update after webhook delivery.

## Local Mock Testing (No Stripe Keys)
1. Leave `STRIPE_SECRET_KEY` unset.
2. Set `BILLING_MODE=mock`.
3. Start a checkout and verify a mock checkout URL is returned.
4. Simulate a webhook update:
```bash
curl -X POST http://localhost:4000/api/stripe/webhook -H "Content-Type: application/json" -d '{"type":"customer.subscription.updated","data":{"object":{"id":"mock_sub_123","customer":"","status":"active","metadata":{"tenantId":"<tenantId>"},"items":{"data":[{"price":{"id":"mock_price_flagship"}}]}}}}'
```

## Changing the price
Raising or lowering the Flagship price means creating a **new** Stripe price on the existing
`Flagship` product and pointing `STRIPE_PRICE_FLAGSHIP_ANNUAL` at it, then updating
`annualAmount` in `BILLING_PLAN_CATALOG` (`apps/api/src/services/billing.js`) and
`BILLING_PLAN_MRR` (`apps/api/src/routes/super.js`) to match. Existing subscriptions stay on
the price they were created with until they are explicitly migrated.
