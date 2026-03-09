# Billing (Stripe + Mock Mode)

PondBridge supports two billing modes:
- `stripe`: live Stripe Checkout + Webhooks + Billing Portal
- `mock`: no Stripe keys required, returns mock checkout/portal links for local development

`BILLING_MODE=auto` (default) picks `stripe` only when Stripe key is configured, otherwise `mock`.

## Environment Variables
Set in `/apps/api/.env`:

```env
BILLING_MODE=auto

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

STRIPE_PRICE_BASE=
STRIPE_PRICE_PREMIUM=

STRIPE_ONBOARDING_PRICE_BASE=
STRIPE_ONBOARDING_PRICE_PREMIUM=

STRIPE_SUCCESS_URL=
STRIPE_CANCEL_URL=
STRIPE_BILLING_PORTAL_RETURN_URL=
STRIPE_CURRENCY=usd

MOCK_BILLING_BASE_URL=https://mock-billing.pondbridge.local
```

## Tenant Billing Fields
Tenant now stores:
- `stripeCustomerId`
- `stripeSubscriptionId`
- `stripePriceId`
- `billingStatus` (`trialing` | `active` | `past_due` | `canceled`)
- `onboardingFeePaid`
- `onboardingFeeInvoiceId`

## API Endpoints
- `POST /api/super/tenants/:id/create-checkout`
  - Creates Stripe Checkout session in stripe mode.
  - Returns mock URL in mock mode.
- `POST /api/stripe/webhook` (primary Stripe dashboard endpoint)
  - Backward-compatible alias: `POST /api/webhooks/stripe`
  - Consumes Stripe events (`checkout.session.completed`, subscription updates, invoice events).
  - In mock mode, accepts a JSON payload with `{ type, data }`.
- `GET /api/tenants/me/billing`
  - Tenant admin billing summary + manage subscription URL.

## Stripe CLI Testing
1. Start API:
```bash
npm run dev:api
```
2. In another terminal, login to Stripe CLI and forward webhooks:
```bash
stripe login
stripe listen --forward-to http://localhost:4000/api/stripe/webhook
```
3. Copy webhook signing secret from CLI output and set `STRIPE_WEBHOOK_SECRET`.
4. Create checkout session (super admin endpoint), open returned `checkoutUrl`, complete payment.
5. Verify tenant billing fields update after webhook delivery.

## Local Mock Testing (No Stripe Keys)
1. Leave `STRIPE_SECRET_KEY` unset.
2. Keep `BILLING_MODE=auto` or set `BILLING_MODE=mock`.
3. Call `POST /api/super/tenants/:id/create-checkout` and verify mock checkout URL is returned.
4. Simulate webhook update:
```bash
curl -X POST http://localhost:4000/api/stripe/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "type":"customer.subscription.updated",
    "data":{
      "object":{
        "id":"mock_sub_123",
        "customer":"",
        "status":"active",
        "metadata":{"tenantId":"<tenantId>"},
        "items":{"data":[{"price":{"id":"mock_price_premium"}}]}
      }
    }
  }'
```

## TODOs When Enabling Live Stripe
- Create real recurring prices in Stripe and populate `STRIPE_PRICE_BASE/PREMIUM`.
- Optionally create dedicated one-time onboarding fee prices.
- Use production `STRIPE_SUCCESS_URL` / `STRIPE_CANCEL_URL`.
- Restrict webhook endpoint at network edge (only Stripe source IPs if desired).
