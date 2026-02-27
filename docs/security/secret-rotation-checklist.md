# Secret Rotation Checklist

Use this checklist immediately if sensitive values were exposed locally or in git history.

## 1) Rotate provider credentials

- Supabase: rotate `SUPABASE_SERVICE_ROLE_KEY` and any anon keys used in non-public contexts.
- Clerk: rotate `CLERK_SECRET_KEY` and restricted API keys.
- Stripe: rotate secret API keys and webhook signing secrets.
- Resend: rotate API key and webhook verification secret.
- Cloudflare R2: rotate access key ID and secret access key.
- JWT: rotate `JWT_SECRET` to invalidate legacy tokens.

## 2) Update runtime environments

- Update local `.env` files (not tracked by git).
- Update deployment secrets in each environment (staging and production).
- Redeploy API and web services after secret updates.

## 3) Invalidate stale sessions and credentials

- Revoke/expire active sessions where supported.
- Force re-login for privileged admin accounts after JWT secret rotation.
- Verify super-admin allowlist entries are still correct.

## 4) Verify and monitor

- Run `npm run security:check-env` to ensure no tracked `.env` files.
- Check `/health` and primary auth flows after redeploy.
- Monitor auth failures and webhook errors for 24 hours.
