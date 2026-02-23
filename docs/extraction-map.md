# Extraction Map: Camp Cedar -> PondBridge

## Source Repo Detected
- Source path used: `/Users/asoroca/Desktop/camp-cedar-alumni-network`
- Frontend app: `/Users/asoroca/Desktop/camp-cedar-alumni-network/camp-cedar-alumni-network-frontend`
- Backend app: `/Users/asoroca/Desktop/camp-cedar-alumni-network/camp-cedar-alumni-network-backend`

## Source Tree Snapshot (Code Only)
```text
camp-cedar-alumni-network
├── camp-cedar-alumni-network-backend
│   ├── index.js
│   ├── middleware/
│   │   ├── requireAuth.js
│   │   └── isAdmin.js
│   ├── models/
│   │   ├── User.js
│   │   ├── FamilyTree.js
│   │   ├── Forum*.js
│   │   ├── Conversation.js
│   │   ├── Newsletter.js
│   │   └── ...
│   ├── routes/
│   │   ├── auth.js
│   │   ├── me.js
│   │   ├── search.js
│   │   ├── parseResume.js
│   │   ├── familyTrees.js
│   │   ├── photos.js
│   │   ├── forums.js
│   │   └── ...
│   └── services/, utils/, realtime/, jobs/
└── camp-cedar-alumni-network-frontend
    ├── src/main.jsx
    ├── src/App.jsx
    ├── src/lib/{auth,api,socket}.js
    ├── src/components/
    ├── src/pages/
    │   ├── Login.jsx
    │   ├── CreateProfileWizard.jsx
    │   ├── MyProfile.jsx
    │   ├── AdvancedSearch.jsx
    │   ├── PublicProfile.jsx
    │   ├── FamilyTrees*.jsx
    │   ├── ChatAndForums.jsx
    │   └── ...
    └── public/, assets/
```

## Detected Architecture in Cedar
- Frontend framework: React + Vite + React Router.
- Backend framework: Node + Express + Mongoose (route handlers in route files, not controller/service split).
- Auth method: JWT bearer auth (`Authorization: Bearer ...`) + bcrypt password hash.
- Environment usage:
  - Backend: `.env` for `MONGODB_URI`, `JWT_SECRET`, S3/Mailgun/OpenAI keys.
  - Frontend: `.env` with `VITE_API_BASE`.
- Existing core features already implemented:
  - Account create/login
  - Profile create/edit/view
  - Directory/search
  - Resume parsing endpoint
  - Family tree feature

## What To Keep (PondBridge Core)
- JWT auth workflow and protected route pattern.
- Profile-centric product model (directory + read-only profile views).
- Search behaviors and filters.
- Family tree concept and relationship modeling.
- Resume parsing pipeline concept (PDF upload -> structured JSON).

## What To Delete (Cedar-Specific)
- Camp Cedar hardcoded naming in UI strings, assets, API service name.
- Cedar-only routes/pages (`cedar-chest`, cedar-branded nav/background assets).
- Cedar-specific storage keys (`cedarToken`, legacy token key mixing).
- Cedar-only production host defaults.

## What To Generalize
- Camp identity to tenant model (`Tenant` with `slug`, plan tier, onboarding status, theme).
- Role model to explicit RBAC (`user`, `tenant_admin`, `super_admin`).
- Theme to tokenized config in DB (`theme.brandPrimary`, etc.) instead of static CSS constants.
- Signup settings to tenant-level access policy (`open`, `code`, later invite-only).

## What To Rework
- Data model split:
  - Cedar stored profile + auth on single `User` document.
  - PondBridge separates `User` (auth) and `Profile` (directory data), each tenant-scoped.
- Route shape:
  - Cedar routes mostly global.
  - PondBridge routes use tenant-aware shape `/api/t/:slug/...` plus subdomain/header fallback.
- Auth payload and local storage keys:
  - Replace generic/legacy keys with `pondbridgeToken` and `pondbridgeUser`.

## What To Rebuild
- Multi-tenant tenant management (super admin create/disable tenants).
- Tenant onboarding controls (branding, access mode, publish/live step).
- Plan/tier gating (Base vs Premium) with billing placeholders.
- Unified app architecture docs + deployment guide.

## Implementation Mapping
- Cedar raw import copied (read-only): `/_import/cedar-original`
- New platform packages:
  - `apps/api` (tenant-first backend)
  - `apps/web` (tenant-first React app)
  - `packages/shared` (plan flags + resume schema)
  - `packages/ui` (tokenized design primitives)
