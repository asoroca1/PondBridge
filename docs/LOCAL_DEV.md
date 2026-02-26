# Local Development

## 1. Requirements
- Node.js 20+
- npm 10+
- MongoDB running locally (`mongodb://127.0.0.1:27017`)

## 2. Install dependencies
From repo root:
```bash
npm install
```

## 3. Configure environment files
Copy examples:
```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Minimum required in `apps/api/.env`:
```env
MONGODB_URI=mongodb://127.0.0.1:27017/pondbridge
JWT_SECRET=change_me
PORT=4000
```

Optional for resume parsing with OpenAI:
```env
OPENAI_API_KEY=...
```

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

## 4. Seed Cedar tenant + users
```bash
npm --workspace @pondbridge/api run seed
```

This creates:
- Tenant: `Camp Cedar` (`cedar`)
- Tenant admin: `admin@campcedar.local` / `Pondbridge123!`
- Sample users: `camper1@campcedar.local`, `staff1@campcedar.local` / `Pondbridge123!`
- Super admin: `superadmin@pondbridge.local` / `SuperAdmin123!`

## 5. Run locally
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

## 6. Open app
- Tenant app: [http://localhost:5173/t/cedar](http://localhost:5173/t/cedar)
- Super admin login: [http://localhost:5173/super/login](http://localhost:5173/super/login)

If port `5173` is already in use (for example by your marketing site), Vite will start PondBridge on `5174` automatically. In that case use:
- Tenant app: [http://localhost:5174/t/cedar](http://localhost:5174/t/cedar)
- Super admin login: [http://localhost:5174/super/login](http://localhost:5174/super/login)

## 7. Useful commands
- `npm run lint`
- `npm run test`
- `npm run build`

## 8. One-time legacy media migration to R2
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
