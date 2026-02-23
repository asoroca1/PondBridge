# Deployment Guide (MVP)

For production rollout with wildcard subdomains and cookie/JWT strategy, see `docs/PROD_LAUNCH.md`.

## Required Environment Variables

### API (`apps/api/.env`)
- `PORT`
- `MONGODB_URI`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`
- `BCRYPT_ROUNDS`
- `FRONTEND_ORIGIN`
- `APP_BASE_DOMAIN`
- `OPENAI_API_KEY` (optional; required for AI resume parsing)

### Web (`apps/web/.env`)
- `VITE_API_BASE` (public API URL)
- `VITE_APP_BASE_DOMAIN` (tenant base domain, e.g. `pondbridgealumni.com`)

## Recommended Hosting
- Web: Vercel or Render static web service
- API: Render web service / Fly.io app
- Database: MongoDB Atlas

## MongoDB Atlas Setup
1. Create an Atlas cluster.
2. Create a DB user.
3. Allow network access from your API host.
4. Set `MONGODB_URI` in API environment.
5. Run seed once against the target DB:
   ```bash
   npm --workspace @pondbridge/api run seed
   ```

## Domain / Subdomain Strategy
- Primary product domain: `pondbridgealumni.com`
- Tenant URLs (default): `https://{tenant-slug}.pondbridgealumni.com`
- Fallback path-based URLs remain available: `https://app.pondbridgealumni.com/t/{tenant-slug}`
- For local development, use path-based URLs and optional `x-tenant-slug` header fallback.

## Deploy Steps
1. Deploy API first and confirm `GET /health`.
2. Deploy web and set `VITE_API_BASE` to API URL.
3. Configure CORS (`FRONTEND_ORIGIN`) on API.
4. Seed production/staging DB.
5. Log in as super admin, create first real tenant, verify `/t/{slug}` flow.

## Cloudflare DNS Baseline
- `api.pondbridgealumni.com` -> API host (Render/Fly target)
- `app.pondbridgealumni.com` -> Web host (Vercel target)
- `*.pondbridgealumni.com` -> Web host (same Vercel target as `app`)
- `pondbridgealumni.com` and `www.pondbridgealumni.com` -> your preferred web entrypoint (`app` or marketing site)
