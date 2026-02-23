# Supabase Migration — Complete

MongoDB has been fully removed. The API runs exclusively on Supabase.

## Architecture

All data is stored in a single Supabase table (`pb_mongo_mirror`) using a document-model pattern:

| Column | Type | Purpose |
|--------|------|---------|
| `collection` | text | Model name (e.g. "Tenant", "User") |
| `id` | text | Document ID (24-char hex string) |
| `tenant_id` | text | Tenant scoping |
| `payload` | jsonb | Full document data |
| `created_at` | timestamp | Creation time |
| `updated_at` | timestamp | Last update |
| `synced_at` | timestamp | Sync timestamp |

Primary key: `(collection, id)`

## Key files

- `apps/api/src/db/supabaseDocumentModel.js` — Core runtime: Mongoose-compatible API over Supabase JSONB
- `apps/api/src/db/mongooseCompat.js` — Lightweight shim exporting `Schema` and `model()` (no mongoose dependency)
- `apps/api/src/db/supabaseAdmin.js` — Supabase client initialization (service role)
- `apps/api/src/db/connect.js` — Validates Supabase table readiness on startup
- `apps/api/src/utils/objectId.js` — ObjectId validation and generation utilities

## Setup

1. Create table/indexes:
   ```
   npm --workspace @pondbridge/api run supabase:apply-schema
   ```
2. Ensure `apps/api/.env` has:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_MIRROR_TABLE=pb_mongo_mirror`
3. Start API:
   ```
   npm --workspace @pondbridge/api run dev
   ```

## Data model guardrails

- Every document includes tenant scoping (`tenant_id`) with indexes.
- Server-side role checks in API middleware are the primary access gate.
- Never expose service role key to client.

## Future improvements

- Migrate from single JSONB table to proper relational tables per model
- Enable Supabase RLS policies for defense-in-depth tenant isolation
- Add Supabase Realtime subscriptions for chat/forum features
