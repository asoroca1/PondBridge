# ADR 0001 — How tenant isolation is enforced

Status: accepted
Date: 2026-08-19

## Context

PondBridge is pooled multi-tenant: one Postgres database, shared tables, and a
`tenant_id` discriminator on 38 tables. Camps are separated by a column value,
not by schema or database. That is the right trade for this stage — it keeps
migrations, backups and cost to one of everything — but it means isolation is
something the code has to guarantee, continuously.

Two mechanisms could provide that guarantee, and it was not previously written
down which one is load-bearing. That ambiguity was itself the risk: RLS existed
and looked like protection, while the API bypassed it, so neither layer was
being held to account.

## Decision

**Application-level scoping in the model factory is the boundary. RLS is
defence in depth.**

The API connects with the Supabase service role, because it legitimately
performs cross-tenant administrative work (super admin dashboards, identity
lookups by email before a tenant is known, device-token routing). Service role
bypasses RLS by design, so RLS cannot be the primary control for API traffic.

To make the primary control real rather than customary, `db/models/_factory.js`
now **refuses** any `find`, `findOne`, `count`, `updateMany` or `deleteMany` on
a tenant-scoped table that does not name its tenant. A query is considered
scoped when either:

- a tenant id is passed positionally — `PhotoModel.find(tenantId, filter)`; or
- the filter names one — `PhotoModel.find({ tenantId })`, including the
  explicit `{ tenantId: null }` used to address platform-level rows.

`{ tenantId: undefined }` is treated as a mistake, not intent, and throws.

Queries that are genuinely platform-wide must say so out loud:

```js
UserModel.acrossTenants().find({ email });
```

That call is greppable, so "which code can see every camp?" is answerable with
one search instead of a reading of 370 call sites.

For lookups by id, `findByIdScoped(tenantId, id)` and
`updateScoped(tenantId, id, patch)` constrain on both columns, so a valid id
belonging to another camp returns `null` rather than that camp's row. Member
facing routes use these; a prior scoped read is no longer the only thing
standing between a request and someone else's data.

## What RLS actually provides today

Worth recording precisely, because it is easy to misread in either direction.

On the camp tables, RLS is enabled **and forced**, and the policies are correct:

| Role | Policy |
| --- | --- |
| `authenticated` | `tenant_id = jwt_tenant_id()` — properly scoped |
| `service_role` | `true` — the API |
| `anon` | no policy, therefore no access |

So if the platform ever adopts Supabase Auth, or a page begins querying
Supabase directly from the browser, tenant scoping is already expressed in the
database and will hold. Nothing needs to be written first. The browser does not
currently talk to Supabase at all — every read goes through the API — so this
layer is dormant rather than fake.

The blanket `USING (true)` policies that exist for `authenticated` are on the
internal outreach/CRM tables (`clients`, `documents`, `knowledge_documents` and
similar), not on camp data. They are a separate concern and are noted below.

## Consequences

- A forgotten tenant argument now fails loudly in development instead of
  silently widening a query in production.
- `tests/tenantIsolation.test.js` fails if these guards are relaxed.
- Cross-tenant reads are possible but must be declared, and are auditable with
  `grep acrossTenants`.
- Super admin, identity, mobile-notification and Clerk-webhook paths carry the
  opt-out deliberately; each is platform-wide by nature.

## Follow-ups

- The internal outreach/CRM tables allow any `authenticated` role to read and
  write. Nothing mints such a token today, but those policies should be scoped
  to the workspace owner rather than left open.
- `findById`/`update` still exist unscoped for admin and super-admin paths.
  They are behind admin authentication, but migrating them to the scoped
  variants would remove the last places where isolation depends on a prior
  read having been correct.
