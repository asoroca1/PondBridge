# PondBridge Production Launch Guide

## 1) Target Architecture

- Web app: Vercel (`apps/web`)
- API: Render or Fly (`apps/api`)
- Database: MongoDB Atlas
- Tenant URLs:
  - Default: `https://{tenant-slug}.pondbridgealumni.com`
  - Fallback during migration: `https://app.pondbridgealumni.com/t/{tenant-slug}`

## 2) Deployment Presets Included

- Vercel preset:
  - `vercel.json`
  - SPA rewrite to `index.html` for React Router.
- Render preset:
  - `render.yaml`
  - Node web service for API with health check on `/health`.
- Fly preset:
  - `fly.api.toml`
  - `Dockerfile.api`

## 3) Environment Validation and Runtime Safety

API env validation now enforces:

- required: `MONGODB_URI`, `JWT_SECRET`
- enum checks:
  - `NODE_ENV` in `development|test|production`
  - `AUTH_TOKEN_MODE` in `bearer|cookie|hybrid`
  - `AUTH_COOKIE_SAMESITE` in `lax|strict|none`

Validated config file:

- `apps/api/src/config/env.js`

## 4) CORS Strategy for Multi-Tenant Domains

CORS is now dynamic and tenant-domain aware.

- Allows configured origins in:
  - `FRONTEND_ORIGIN`
  - `FRONTEND_ORIGINS` (comma-separated)
- Allows wildcard subdomains of `APP_BASE_DOMAIN` when:
  - `CORS_ALLOW_SUBDOMAIN_ORIGINS=true`
- Supports future custom domains through:
  - `CUSTOM_DOMAIN_ALLOWLIST` (comma-separated hostnames)

Implemented in:

- `apps/api/src/config/cors.js`
- `apps/api/src/app.js`

## 5) JWT + Cookie Strategy for Subdomains

PondBridge now supports `bearer`, `cookie`, or `hybrid` auth token modes.

- `bearer`: token in `Authorization` header only
- `cookie`: HTTP-only auth cookie only
- `hybrid` (recommended): supports both

Cookie behavior:

- HTTP-only, Secure in production, configurable domain for subdomains
- read by API middleware and used as fallback when bearer header is missing
- login/register flows set cookie automatically in cookie/hybrid mode
- logout routes clear cookie:
  - `POST /api/t/:slug/auth/logout`
  - `POST /api/auth/super/logout`

Key env vars:

- `AUTH_TOKEN_MODE=hybrid`
- `AUTH_COOKIE_NAME=pondbridge_auth`
- `AUTH_COOKIE_DOMAIN=.pondbridgealumni.com` (production)
- `AUTH_COOKIE_SAMESITE=lax`
- `AUTH_COOKIE_SECURE=true` (production)

## 6) DNS Setup (Wildcard Subdomains)

For `pondbridgealumni.com`:

1. Set API host (example):
   - `api.pondbridgealumni.com` -> Render/Fly API endpoint (CNAME or A/AAAA per provider)
2. Set app host:
   - `app.pondbridgealumni.com` -> Vercel project
3. Set wildcard tenant host:
   - `*.pondbridgealumni.com` -> Vercel project

Result:

- `camp-cedar.pondbridgealumni.com` resolves to web app.
- web app derives tenant slug from subdomain.

## 7) SSL Strategy

- Vercel: managed TLS for `app` + wildcard domain.
- Render/Fly: managed TLS for API domain.
- Ensure API and web are both HTTPS in production.
- Keep `AUTH_COOKIE_SECURE=true` in production.

## 8) Migration: `/t/:slug` to Subdomain

Current app supports both:

- path-based tenancy: `/t/:slug/...`
- host-based tenancy: `https://{slug}.pondbridgealumni.com/...`

Recommended rollout:

1. Keep both URL strategies enabled.
2. Update tenant links/emails to subdomain format.
3. Add 301 redirects from `app.pondbridgealumni.com/t/{slug}` to `{slug}.pondbridgealumni.com` when ready.
4. Keep API tenant resolution fallback (`/t/:slug` + subdomain + header) for backward compatibility.

## 9) MongoDB Atlas

1. Create Atlas cluster + DB user.
2. Restrict network access to API egress ranges (or controlled temporary wider list).
3. Set `MONGODB_URI` in Render/Fly.
4. Run seed once against non-production environments only:

```bash
npm --workspace @pondbridge/api run seed
```

## 10) Production-Like Local Test

Use `lvh.me` for wildcard local subdomains:

1. In `apps/api/.env` set:
   - `APP_BASE_DOMAIN=lvh.me`
   - `FRONTEND_ORIGIN=http://app.lvh.me:5173`
   - `FRONTEND_ORIGINS=http://app.lvh.me:5173,http://camp-cedar.lvh.me:5173`
   - `AUTH_TOKEN_MODE=hybrid`
2. Run:
   - `npm run dev`
3. Open:
   - `http://camp-cedar.lvh.me:5173`

## 11) Minimal Launch Checklist

1. API live and healthy (`/health`).
2. Vercel web live for `app` and wildcard subdomains.
3. Atlas connected.
4. Auth cookie domain set correctly.
5. CORS allows app + tenant subdomains.
6. Create tenant and validate login/search/admin flows on tenant subdomain.
