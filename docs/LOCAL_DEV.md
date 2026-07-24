# Local Development

For the canonical zero-cost staging workflow—including the isolated Supabase
stack, synthetic target/control camps, outbound-provider guardrails, and reset
verification—start with [`LOCAL_STAGING.md`](./LOCAL_STAGING.md).

## 1. Requirements
- Node.js 22.12+ recommended (or Node.js 20.19+). The current Vite toolchain will not start on earlier Node 20 releases.
- npm 10+
- Docker CLI, Colima, and the repository-pinned Supabase CLI. The staging
  runner uses a dedicated `pondbridge` Colima profile. Never point reset/seed
  commands at production.

## 2. Install dependencies
From repo root:
```bash
npm install
```

## 3. Preferred local staging setup

No hosted credentials or copied `.env` files are required:

```bash
npm run staging:local:reset
npm run staging:local:dev
```

The staging runner injects safe local Supabase credentials and disables all
outbound providers even when another `.env` file exists.

## 4. Manual environment setup

Developer-only provider credentials can be stored in the ignored root
`.env.local`. PondBridge loads it before the shared root `.env`, while tests and
the isolated local-staging runner deliberately ignore both files.

Copy examples:
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Minimum required in `apps/api/.env`:
```env
SUPABASE_URL=https://YOUR_DEV_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_DEV_SERVICE_ROLE_KEY
SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_DEV_PROJECT.supabase.co:5432/postgres
JWT_SECRET=change_me
PORT=4000
```

Apply the native relational schema to the dedicated development database:

```bash
npm --workspace @pondbridge/api run supabase:apply-schema
npm --workspace @pondbridge/api run rls:audit
```

Optional for resume parsing with OpenAI:
```env
OPENAI_API_KEY=...
OPENAI_PROFILE_IMPORT_MODEL=gpt-5.6-luna
OPENAI_PROFILE_IMPORT_MAX_OUTPUT_TOKENS=1600
PROFILE_IMPORT_MONTHLY_BUDGET_USD=15
OPENAI_SEARCH_MODEL=gpt-5.6-luna
OPENAI_SEARCH_MAX_OUTPUT_TOKENS=500
AI_SEARCH_MONTHLY_BUDGET_USD=15
```

Camp Search AI stays off until `camp_ai_search_v1` is enabled for the local
tenant in the durable rollout controls. Profile PDF Import remains usable with
its conservative local parser when OpenAI or the usage ledger is unavailable.

To reproduce the additive fall-rollout foundation locally, run `db:preflight`
and follow its ordered `migrationPlan`. The available guarded installers cover
platform audit, rollout control, communications/AI usage, multi-camp identity,
and member safety; all five accept `PONDBRIDGE_TARGET_ENV=local` without a
remote-staging acknowledgement.

Optional for transactional email with Resend:
```env
EMAIL_MODE=resend
EMAIL_FROM=no-reply@your-domain.com
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
RESEND_WEBHOOK_TOLERANCE_SECONDS=300
RESEND_USER_AGENT=pondbridge-api/1.0
RESEND_REQUEST_TIMEOUT_MS=12000
RESEND_MAX_RETRIES=2
RESEND_RETRY_BASE_DELAY_MS=300
RESEND_BATCH_ENABLED=true
EMAIL_SUPPRESSION_ENABLED=true
EMAIL_BROADCAST_BATCH_SIZE=40
EMAIL_BROADCAST_MAX_RECIPIENTS=500
```

For production branded sending on `pondbridgealumni.com`:
- Verify `pondbridgealumni.com` in Resend.
- Set `EMAIL_FROM=no-reply@pondbridgealumni.com`.
- Keep `EMAIL_MODE=resend`.

Optional for media uploads with Cloudflare R2:
```env
CLOUDFLARE_ACCOUNT_ID=...
R2_BUCKET_NAME=pondbridge-media
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_REGION=auto
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_PUBLIC_BASE_URL=https://<your-public-r2-base>
R2_MAX_UPLOAD_BYTES=20971520
R2_PRESIGN_EXPIRES_SECONDS=900
R2_DEFAULT_CACHE_CONTROL=public, max-age=31536000, immutable
```

Recommended R2 bucket CORS for browser presigned uploads:
```json
[
  {
    "AllowedOrigins": [
      "https://pondbridgealumni.com",
      "https://*.pondbridgealumni.com",
      "http://localhost:5173",
      "http://localhost:5174"
    ],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Cache-Control"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Health check now includes integration readiness details:
```bash
curl http://localhost:4000/health
```

## 5. Seed Cedar tenant + users
```bash
npm --workspace @pondbridge/api run seed
```

The seed command is for a dedicated development database only. Production seeding
is guarded and should remain disabled.

This creates:
- Tenant: `Camp Cedar` (`cedar`)
- Tenant admin: `admin@campcedar.local` / `Pondbridge123!`
- Sample users: `camper1@campcedar.local`, `staff1@campcedar.local` / `Pondbridge123!`
- Super admin: `superadmin@pondbridge.local` / `SuperAdmin123!`

## 6. Run locally
API only:
```bash
npm run dev:api
```

Web only:
```bash
npm run dev:web
```

Both together:
```bash
npm run dev
```

## 7. Open app
- Tenant app: [http://localhost:5173/t/cedar](http://localhost:5173/t/cedar)
- Super admin login: [http://localhost:5173/super/login](http://localhost:5173/super/login)

If port `5173` is already in use (for example by your marketing site), Vite will start PondBridge on `5174` automatically. In that case use:
- Tenant app: [http://localhost:5174/t/cedar](http://localhost:5174/t/cedar)
- Super admin login: [http://localhost:5174/super/login](http://localhost:5174/super/login)

## 8. Useful commands
- `npm run lint`
- `npm run test` runs the non-destructive API unit/helper tests.
- `npm --workspace @pondbridge/api run test:db` runs the full API suite and will refuse to reset data unless the DB reset safeguards are explicitly configured.
- `npm --workspace @pondbridge/api run test:with-reset` is only for a dedicated local/CI test database with `PONDBRIDGE_TEST_DB_MARKERS` proving it is non-production.
- `npm --workspace @pondbridge/api run domains:audit` checks normalized domain
  assignments without writing data.
- `npm run build`

## 9. One-time legacy media migration to R2
Dry run (no writes):
```bash
npm --workspace @pondbridge/api run migrate:legacy-media-to-r2
```

Apply URL rewrites + uploads:
```bash
npm --workspace @pondbridge/api run migrate:legacy-media-to-r2 -- --apply
```

If old records contain relative legacy URLs that are still reachable on a host, include:
```bash
npm --workspace @pondbridge/api run migrate:legacy-media-to-r2 -- --apply --base-url=https://api.yourdomain.com
```
