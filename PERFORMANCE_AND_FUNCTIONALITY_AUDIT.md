# PondBridge System Performance and Functionality Audit

**Audit date:** 2026-09-02  
**Primary system audited:** `pondbridge-platform`  
**Scope:** web application, API, database access layer and migrations, background work, external integrations, mobile notification paths, build/deployment configuration, and quality gates. Visual design is intentionally out of scope.

## Executive verdict

PondBridge already has several sound foundations: the web routes are broadly lazy-loaded, the map engine is isolated from the initial route, static assets receive immutable caching, API responses are compressed, the database has substantial tenant-aware indexing, and the server has graceful shutdown behavior.

The system is not yet at a defensible performance ceiling. The highest-risk problems are architectural rather than cosmetic:

1. Several endpoints load thousands of rows, filter or aggregate in JavaScript, and paginate only afterward. They will become slow and can silently return incomplete results because Supabase/PostgREST limits result sizes.
2. The shared model factory asks Postgres for an exact count on every `find`, even when the caller does not use it, and silently ignores unsupported filters. This creates pervasive database cost and can accidentally broaden a query.
3. Search applies important filters after a capped candidate fetch, so totals and result sets can be wrong at scale.
4. Scheduled notifications, bulk email, webhook processing, and PDF parsing run in or alongside the request-serving process. This harms tail latency and makes horizontal scaling unsafe without atomic job claiming.
5. The frontend has three overlapping cache layers, large global CSS, wasteful polling, broad speculative preloading, and no real-user performance instrumentation.
6. Current CI does not enforce the complete database-backed suite, browser journeys, coverage thresholds, load tests, or performance regressions.

This document separates confirmed static findings from measurements that still need production-like data. “No more improvements” cannot truthfully be established by a one-time code review; it requires closing the findings below, measuring under representative load and devices, and repeating the profiling loop until the explicit exit criteria hold.

## Audit confidence and current limitations

| Evidence type | Status | What is known |
|---|---:|---|
| Static architecture and source review | Complete for the primary repository | Reviewed shared data access, high-volume routes, search, admin reporting, auth/bootstrap, caching, polling, notification/email workers, upload paths, build configuration, deployment configuration, migrations, and test gates. |
| Existing production bundle inspection | Complete, but based on the existing local build | Initial JS is about 376 KB raw / 110.3 KiB gzip; initial CSS is about 362 KB raw; MapLibre is about 1.02 MB raw and lazy-loaded. |
| Dependency vulnerability audit | Complete | `npm audit --omit=dev` reports five moderate production findings, including denial-of-service advisories in the current Express dependency path. |
| Fresh lint and unit tests | Resolved 2026-09-04 | Root cause was not dataless files but the primary checkout living under the iCloud-synced `~/Desktop`, which reads at ~7 ms/file (~56x slower than a local worktree). Running from a worktree under `~/pondbridge-worktrees` fixes it. `npm run lint`: 0 errors, 2 pre-existing warnings. API safe suite: 56 suites / 406 tests pass. Web suite: 38 files / 246 tests pass. Cold jest costs ~50 s of ESM transform; warm, the API suite runs in ~8 s. |
| Browser trace / Core Web Vitals | Pending | Chrome DevTools performance tooling is not available in this session. Field RUM is also absent. |
| Live query plans and database load | Pending | Requires production-like row counts, `pg_stat_statements`, and `EXPLAIN (ANALYZE, BUFFERS)` against representative, non-sensitive data. |
| End-to-end load and soak tests | Pending | No existing load suite was found. |

Before relying on any fresh local benchmark, keep the repository fully downloaded locally or move the checkout outside the cloud-managed Desktop directory, reinstall dependencies, and use Node 20.19+ or 22.12+. The current shell is Node 20.10.0, while Vite 7 requires a newer runtime.

## What is already working well

- Authenticated and public routes are comprehensively code-split in `apps/web/src/App.jsx`.
- MapLibre is held behind a lazy route rather than added to the initial application payload.
- `/assets/*` uses long-lived immutable caching while HTML is not cached, which supports safe hashed deployments.
- HTTP compression is enabled on the API.
- Database migrations include many tenant/date/status and reverse foreign-key indexes.
- Several external service calls already use abort timeouts, and some high-volume notification work uses bounded concurrency.
- Graceful shutdown is present.
- Some routes deliberately project only required columns and use short-lived request deduplication or caches.
- The existing build-budget script gives the project a useful starting guardrail.

These strengths should be preserved while the deeper changes are made.

## Findings

Severity meanings:

- **P0:** can produce incorrect results, duplicate side effects, partial destructive operations, or hard scaling failure.
- **P1:** material latency, capacity, reliability, or regression-detection risk.
- **P2:** meaningful efficiency or maintainability improvement after the critical path is stable.

### A. Data access and database behavior

#### PERF-DB-01 — Every model `find` requests an exact count — P0

**Evidence:** `apps/api/src/db/models/_factory.js:254-274` creates each list query with `select(..., { count: "exact" })`. Most call sites use only the returned rows.

**Impact:** every ordinary read can perform count work that is not visible to the caller. On filtered or tenant-wide tables this increases database CPU and tail latency throughout the system.

**Plan:** make count opt-in. Return `{ rows, count }` only for explicit count/page operations, use `head: true` for count-only requests, and prefer an estimated or planned count where exactness is not a product requirement.

**Acceptance:** query traces show no `COUNT(*)` for row-only reads; endpoint totals still pass contract tests.

#### PERF-DB-02 — Unbounded reads are silently capped — P0

**Evidence:** many callers invoke `Model.find(tenantId)` with no limit. Supabase documents a default maximum of 1,000 returned rows and recommends pagination with `range()`.

**Impact:** “all rows” code can become incomplete without throwing. This affects imports, analytics, admin data, deletion cleanup, mobile notifications, and other workflows.

**Plan:** prohibit unpaginated list calls in the model API. Require one of: explicit bounded limit, cursor pagination, aggregate RPC, streaming/batched iterator, or a documented `findAllBatched` implementation.

**Acceptance:** a static rule finds zero unapproved unbounded list calls; scale fixtures above 1,000/10,000 rows produce complete results.

#### PERF-DB-03 — Invalid filters fail open — P0

**Evidence:** the shared filter builder silently ignores fields absent from a model column map and ignores unsupported operators.

**Impact:** a misspelled or newly introduced filter can become a tenant-wide query. That is both a correctness and runaway-load hazard.

**Plan:** reject unknown fields/operators with a typed internal error during development and tests, and a controlled 400 response for client-supplied filters. Add model-level filter contract tests.

**Acceptance:** every unknown filter/operator fails closed; no route can accidentally broaden a query.

#### PERF-DB-04 — Offset pagination will degrade on deep pages — P1

**Evidence:** the factory maps offset/limit to PostgREST ranges.

**Impact:** deep pages require increasing database work and are unstable when rows are inserted between requests.

**Plan:** introduce keyset/cursor pagination using a stable compound order such as `(created_at, id)`. Keep offset only for small bounded admin datasets where random page access is required.

**Acceptance:** p95 query time remains approximately flat across the first, middle, and final page in a production-scale fixture.

#### FUNC-DB-05 — Timestamp semantics are inconsistent — P1

**Evidence:** generic `upsert` stamps `createdAt` on every upsert; generic updates do not consistently stamp `updatedAt`.

**Impact:** creation dates can change, update dates can remain stale, ordering/auditing can be wrong, and cache invalidation based on timestamps becomes unreliable.

**Plan:** move timestamp ownership to database defaults/triggers, preserve `created_at` on conflict, and always update `updated_at` on mutation.

**Acceptance:** regression tests cover create, update, and conflict-upsert timestamps.

#### FUNC-DB-06 — Multi-step mutations are not atomic — P0

**Evidence:** membership deletion and related cleanup traverse conversations, forums, photos, family trees, and other records through many independent calls around `apps/api/src/routes/admin.js:1973-2215`. People deletion similarly performs serial independent operations around `admin.js:7393+`.

**Impact:** a failure midway can leave partially deleted or internally inconsistent tenant data. The same flows generate excessive network round trips.

**Plan:** implement transactional Postgres functions for destructive workflows, use set-based updates/deletes, return a compact mutation summary, and make retries idempotent.

**Acceptance:** fault-injection tests prove rollback at every failure point; query count is bounded and independent of related-row count.

#### PERF-DB-07 — Index effectiveness is not proven — P1

**Evidence:** the schema has many indexes, but query plans are not captured in CI or operational telemetry. Search SQL appears to query `lower(...)` and `array_to_string(...)` while some indexes use immutable wrapper expressions, which may prevent index matching.

**Plan:** enable and review `pg_stat_statements`; capture `EXPLAIN (ANALYZE, BUFFERS)` for the top 20 reads and all writes; align query expressions with index expressions; remove unused indexes only after a full observation window.

**Acceptance:** no high-volume query performs an unexplained sequential scan; index hit rates and write overhead are documented.

### B. API correctness and scale

#### FUNC-API-01 — Admin profile list is unpaginated — P0

**Evidence:** `GET /api/t/:slug/admin/profiles` at `apps/api/src/routes/admin.js:6831` loads profiles, filters search text in JavaScript, and returns the collection without server-side pagination.

**Impact:** response time, memory, JSON serialization, and payload size grow with the tenant. Results can be truncated by the data provider cap.

**Plan:** perform search/filter/sort/page in SQL; return a projection, cursor, and explicit total only when requested.

#### FUNC-API-02 — Unified People computes the whole universe before slicing — P0

**Evidence:** `resolveFilteredPeople` at `admin.js:6956` loads contacts, up to 5,000 invites, users, profiles, up to 5,000 access requests, and up to 10,000 analytics events. It joins, filters, and sorts in memory; pagination occurs later around `admin.js:7093`.

**Impact:** high database/network cost per request, high Node heap/CPU, inaccurate data beyond caps, and duplicated work for preview/CSV paths.

**Plan:** create a normalized SQL view/materialized projection for people lifecycle state; query it with server-side filters/keyset pagination; run CSV export as a streamed background job.

**Acceptance:** request memory is O(page size), totals remain correct above 100,000 records, and CSV export does not occupy a web request.

#### FUNC-API-03 — Advanced member filtering can fetch the complete tenant twice — P0

**Evidence:** the admin member route around `admin.js:3180-3340` falls back to full-profile JavaScript filtering/sorting for search, completion, and nested year fields, and may refetch for a count.

**Plan:** normalize/query nested searchable attributes in SQL, expose a single paged RPC returning rows and total, and remove the full-fetch fallback.

#### FUNC-SEARCH-01 — Search totals and pages are incomplete at scale — P0

**Evidence:** `apps/api/src/routes/search.js:376` defaults candidate fetching to 300 and caps it at 1,000. `ProfileModel.search` is called around `search.js:538`; several important filters and fuzzy ranking steps happen afterward. The SQL `search_profiles` function itself caps its limit at 100, then JavaScript supplements a bounded alphabetical candidate set.

**Impact:** matching records outside the candidate window cannot appear, and `total` describes the candidate set rather than the tenant’s real result set.

**Plan:** move every filter and deterministic rank component into a paged SQL search function; return stable rank/id cursors and an optional count. Cache normalized searchable vectors on write rather than rebuilding word/trigram sets on each request.

**Acceptance:** golden datasets with matching records beyond rows 1,000 and 10,000 return correct pages/totals; p95 latency meets the search SLO.

#### PERF-API-04 — Analytics and dashboards aggregate capped raw events in Node — P0

**Evidence:** admin, super-admin, and growth paths request 5,000/10,000 analytics records or complete profile/user sets and aggregate them in JavaScript.

**Impact:** dashboards become simultaneously slower and less accurate as usage grows.

**Plan:** use SQL aggregates grouped by tenant/date/type, incremental daily rollups, and materialized views where appropriate. Read compact aggregate rows from the API.

**Acceptance:** results match an uncapped reference calculation; latency and payload size are effectively independent of raw event count.

#### PERF-API-05 — Startup work scales with tenant count — P1

**Evidence:** database connection startup selects and logs every tenant plus an exact count.

**Plan:** use a bounded readiness query and a count-only diagnostic. Never enumerate all tenants during process boot.

#### REL-API-06 — Health check is configuration-only — P1

**Evidence:** the health route reports email/R2 configuration but does not verify a bounded database operation or readiness of critical dependencies.

**Plan:** split `/livez` (process/event-loop alive) from `/readyz` (cached, time-bounded database check and required configuration). Render recommends testing operation-critical dependencies such as a simple database query.

#### REL-API-07 — Server and body limits are too broad — P1

**Evidence:** `render.yaml:18` sets a global `API_JSON_LIMIT` of 15 MB. The HTTP server does not explicitly define request, header, keep-alive, or per-socket request limits.

**Plan:** use a small global JSON limit, route-specific limits only where needed, direct-to-object-storage uploads, and explicit Node HTTP timeouts. Add 413/408/slow-client tests.

#### REL-API-08 — Rate limits and caches are process-local — P1

**Evidence:** rate limiting and several response caches use in-memory maps. Cache invalidation is local and broad; `clearAdminReadCaches` at `admin.js:933` clears coarse cache groups.

**Impact:** behavior changes with replica count, caches disagree across instances, restarts reset limits, and mutations evict unrelated tenants’ work.

**Plan:** use a shared rate-limit store; make cache keys tenant-scoped and tag-invalidated; cache only measured expensive immutable/aggregate results. Prefer one clearly owned cache layer per resource.

### C. Background work and integrations

#### REL-JOB-01 — Notification scheduler can double-claim work — P0

**Evidence:** scheduled notifications are polled by an in-process interval around `apps/api/src/services/mobileNotifications.js:939`. Due rows are read and then updated to `sending` one by one around line 851-864.

**Impact:** multiple API replicas can claim the same row and send duplicate notifications. Scheduler work also competes with web requests.

**Plan:** move scheduling to a dedicated worker and atomically claim jobs with `UPDATE ... WHERE status='pending' ... RETURNING`, `FOR UPDATE SKIP LOCKED`, or a queue with leases. Preserve idempotency keys through delivery.

**Acceptance:** concurrent-worker tests deliver each logical notification once; crashed jobs are safely retried after lease expiry.

#### PERF-JOB-02 — Notification counts and histories scan rows in JavaScript — P1

**Evidence:** unread count fetches up to 5,000 notification rows (`mobileNotifications.js:490-496`) and filters JSON visibility in Node. Batch history also fetches and aggregates records in Node.

**Plan:** express visibility/count/grouping in indexed SQL or maintain transactional counters.

#### PERF-JOB-03 — Personalized bulk email is sequential — P0

**Evidence:** the personalized strategy sends recipients one at a time, with configured audiences up to hundreds of recipients.

**Impact:** requests can remain open for minutes, provider latency is multiplied, and a process failure leaves ambiguous partial completion.

**Plan:** persist a broadcast and recipient jobs, acknowledge immediately, send through a worker with bounded concurrency/provider batching, and expose progress/retry state.

#### REL-JOB-04 — Email webhook work is performed before acknowledgement — P1

**Evidence:** recipient-to-tenant resolution can query membership repeatedly; event inserts and suppression updates are serial in webhook handling.

**Impact:** slow acknowledgement encourages provider retries and duplicate work.

**Plan:** verify signature, persist the idempotent raw event, acknowledge, then process asynchronously. Add a direct indexed recipient/domain-to-tenant mapping.

#### PERF-JOB-05 — Resume parsing is CPU/memory-heavy request work — P0

**Evidence:** `apps/api/src/routes/resume.js:25` uses `multer.memoryStorage()` for PDFs up to 10 MB, parses the full file before enforcing page-level constraints, and then performs an external AI request.

**Impact:** concurrent or pathological PDFs can exhaust heap and block the Node event loop.

**Plan:** upload directly to private object storage, validate magic bytes and conservative size/page constraints early, parse in a sandboxed worker with CPU/memory/time limits, and provide an asynchronous status endpoint.

### D. Frontend runtime and delivery

#### PERF-WEB-01 — Initial global CSS is large — P1

**Evidence:** `main` imports `fonts.css`, shared theme CSS, `styles.css` (17,220 source lines), and `productOnboarding.css` (2,425 lines). The existing initial CSS asset is about 362 KB raw.

**Impact:** every route pays download, parse, selector matching, and style-recalculation cost for unrelated screens.

**Plan:** split CSS by route/feature, remove dead and duplicated selectors with a safelisted coverage process, isolate admin/super/onboarding styles, and retain only reset/tokens/shell styles globally.

#### PERF-WEB-02 — Initial JS is close to its current budget — P1

**Evidence:** existing entry JS is about 376 KB raw / 110.3 KiB gzip, roughly 88% of the 125 KiB gzip budget. The current budget excludes overall request count and total route cost.

**Plan:** obtain a fresh visualizer trace, identify top modules, remove dependency duplication, lazy-load noncritical providers, and set route-specific budgets. Do not optimize merely by chunk shuffling; measure parse/evaluation and user timing.

#### PERF-WEB-03 — Large and duplicate image assets remain — P1

**Evidence:** `cedar-field.jpeg` is about 779 KB and is used in route fallbacks; an unused `cedar-bg.png` is about 1.9 MB; asset copies exist in both `src/assets` and `src/cedar/assets`.

**Plan:** generate responsive AVIF/WebP variants, specify dimensions, lazy-load offscreen media, consolidate imports, and fail CI on unused/duplicate oversized media.

#### PERF-WEB-04 — GET caching duplicates large authenticated payloads — P1

**Evidence:** `apps/web/src/lib/http.js` stores GET responses in a 12-second in-memory map, includes the full authorization token in cache identity, and clones payloads with `structuredClone` on both write and read (`http.js:94-96`). Mutations clear the entire cache.

**Impact:** large admin payloads are duplicated in heap, token rotation leaves old-key entries, reads spend CPU cloning, and invalidation is both excessive and potentially stale when combined with browser/API caches.

**Plan:** replace with a resource-aware query cache keyed by tenant/user/resource rather than raw JWT; bound by bytes as well as entries; cancel in-flight requests; update/invalidate precise keys after mutations; use HTTP caching only for appropriate public resources.

#### REL-WEB-05 — Requests have no default timeout/cancellation contract — P1

**Evidence:** many components ignore late results with a boolean but do not abort the underlying fetch. The shared HTTP client has no global request deadline.

**Plan:** accept an `AbortSignal`, abort on unmount/navigation/replacement, set endpoint-class deadlines, and distinguish timeout/offline/server errors.

#### FUNC-WEB-06 — Tenant bootstrap has a stale-response race — P0

**Evidence:** the tenant effect tracks cancellation, but the underlying fetch can still update shared state after a rapid tenant route change.

**Impact:** a slow response for tenant A can overwrite tenant B’s configuration.

**Plan:** use an abort controller plus monotonically increasing request generation; accept a response only when tenant key and generation still match.

#### PERF-WEB-07 — Chat unread polling duplicates realtime transport — P1

**Evidence:** `useUnreadChatsCount` retrieves conversations every 25 seconds despite Socket.IO being present, and does not stop its interval while the document is hidden.

**Plan:** provide a compact unread summary endpoint, update via socket deltas, reconcile on reconnect/focus, and pause polling while hidden. Centralize the other 5/30/60-second page intervals with visibility and exponential-backoff policies.

#### PERF-WEB-08 — Auth activity resets timers on high-frequency events — P2

**Evidence:** mousemove, mousedown, keydown, scroll, and touch events clear and recreate idle/logout timers.

**Plan:** throttle a last-activity timestamp and maintain one scheduled check; use passive listeners where appropriate.

#### PERF-WEB-09 — Speculative route warming is unconditional — P2

**Evidence:** authenticated navigation schedules idle preload of `/home` and `/my-profile` around `apps/web/src/App.jsx:455-456` regardless of connection quality or user intent.

**Plan:** gate prefetch by `saveData`, effective connection type, device memory, route likelihood, and whether the module is already cached.

#### PERF-WEB-10 — Dependency and build ownership is inconsistent — P1

**Evidence:** root and web packages declare different `lucide-react` versions; 56 source files import it. During the attempted build, Vite opened more than 1,000 icon source files while cloud hydration stalled. Other web runtime dependencies are split between root and workspace manifests.

**Plan:** make the web workspace own its runtime dependencies, align a single version, enforce lockfile deduplication, and evaluate direct icon entry imports only after measuring build/runtime effects.

#### REL-WEB-11 — Local build output contains conflict duplicates — P1

**Evidence:** the existing `apps/web/dist/assets` contains roughly 32 macOS/iCloud conflict copies with ` 2`/` 3` suffixes.

**Impact:** unclean artifact uploads can carry unused bytes and make releases non-reproducible.

**Plan:** deploy only a fresh CI-produced artifact from an empty output directory; reject filenames matching conflict-copy patterns; never treat local `dist` as a deploy source.

### E. Observability, testing, and release controls

#### OBS-01 — No field performance or service-level telemetry — P0

**Evidence:** no Web Vitals RUM, distributed traces, database timing spans, event-loop/heap metrics, queue lag, cache hit ratio, response-byte metrics, or route-level percentile dashboards were found.

**Plan:** instrument:

- Web: LCP, INP, CLS, TTFB, route, device class, connection class, build ID, and sampled error context.
- API: normalized route, p50/p95/p99 duration, status, response bytes, tenant plan/size bucket (not tenant identity in broad dashboards), DB/upstream time, query count, cache outcome.
- Runtime: event-loop lag, heap/RSS, GC pauses, active sockets, request concurrency.
- Workers: queue depth, oldest-job age, attempts, terminal failures, provider latency and rate limits.
- Database: query percentiles, rows read/returned, cache hit ratio, locks, connection saturation, slow query fingerprints.

Search terms and sensitive query values must not be placed in metrics labels or routine logs.

#### QA-01 — The default test command omits critical API suites — P0

**Evidence:** the safe Jest configuration enumerates 45 tests while 59 API test files exist. Omitted areas include tenant isolation, hybrid auth, billing, CSRF, CSV import, onboarding gates, resume security, fuzzy search, super-admin boundaries/provisioning, email/R2 integrations, and theme normalization. A referenced `outreach.test.js` file does not exist.

**Plan:** define explicit unit, integration, database, and external-contract projects; make the default CI aggregate all required projects; quarantine only tests with an owner and expiry.

#### QA-02 — Database-backed release evidence is optional — P0

**Evidence:** CI skips hosted database gates unless `PONDBRIDGE_CI_DB_ENABLED` is set.

**Plan:** provision an ephemeral/isolated database for every protected-branch or pre-merge run, apply migrations from zero, seed scale fixtures, and make tenant-isolation/data-contract tests mandatory.

#### QA-03 — No browser, coverage, load, or performance regression gates — P1

**Plan:** add:

- Browser journeys for sign-in, tenant switch, profile CRUD, directory/search, chat/forum, admin people/import/export, billing, notification settings, and destructive admin actions.
- Coverage thresholds focused on branches and critical domain paths, not a vanity global percentage.
- API load tests for directory/search/admin dashboards/webhooks/uploads and soak tests for sockets/workers.
- Lighthouse/lab budgets plus RUM regression alerts.
- Migration performance tests on production-scale synthetic data.

#### QA-04 — Static analysis is too permissive — P1

**Evidence:** ESLint lacks React Hooks dependency rules, stronger promise/error rules, type checking, and architectural import boundaries. Unused variables are warnings.

**Plan:** add `react-hooks` rules, make correctness warnings blocking, introduce TypeScript or `checkJs` incrementally at API and shared boundaries, and enforce model query contracts with custom lint rules.

#### SEC-01 — Five moderate production dependency advisories — P1

**Evidence:** the completed production audit reports issues in `@xmldom/xmldom`, `sanitize-html`, and the `qs` chain used by the current Express/body-parser stack. The `qs` advisories include denial-of-service risk; the automated major fix moves to Express 5.

**Plan:** update direct packages immediately where compatible; plan and test the Express 5 migration rather than forcing it blindly; add malformed/deep query and sanitization regression tests; enforce an agreed vulnerability policy in CI.

### F. Structural sources of performance risk

#### MAINT-01 — Very large modules obscure query and render cost — P1

**Evidence:** `admin.js` is about 8,119 lines; `legacyCedarCompat.js` about 3,776; `ChatAndForums.jsx` about 2,924; several admin/super pages exceed 2,400 lines; global CSS exceeds 17,000 lines.

**Impact:** unrelated paths share imports/state, performance changes are hard to isolate, reviews miss accidental full scans, and tests cannot target small units.

**Plan:** split by domain/use case with explicit query services and response contracts. This is a functionality/performance change, not a stylistic rewrite: extraction should reduce loaded code, bound data access, and make profiling attributable.

## Remediation program

### Phase 0 — Make measurements reproducible

1. Move or fully hydrate the checkout outside cloud-placeholder storage.
2. Use Node 20.19+ or 22.12+ and enforce it with a preinstall check plus the existing version file.
3. Reinstall from the lockfile and run lint, all tests, production build, and the build budget.
4. Produce an immutable CI artifact from a clean output directory.
5. Stand up a sanitized scale dataset with small, medium, large, and extreme tenants.
6. Install browser trace capability and add RUM before making micro-optimization decisions.

**Exit gate:** repeatable builds on developer and CI machines; no conflicted assets; baseline report stored with build ID, environment, dataset size, and variance.

### Phase 1 — Correctness and catastrophic-scale fixes

Deliver in this order:

1. Make model counts opt-in and unknown filters fail closed.
2. Eliminate unbounded reads and add batched/cursor primitives.
3. Replace admin profiles, Unified People, member filtering, search, and dashboards with SQL-side filter/page/aggregate contracts.
4. Move member/person deletion into idempotent database transactions.
5. Atomically claim notification jobs and move schedulers out of API processes.
6. Queue personalized email, webhook post-processing, CSV exports, and resume parsing.
7. Fix the tenant-bootstrap stale-response race.

**Exit gate:** scale fixtures above every former cap remain complete; concurrent workers cannot duplicate jobs; destructive operations roll back cleanly; API heap is O(page/batch size).

### Phase 2 — Database and API latency

1. Capture top query fingerprints using `pg_stat_statements`.
2. Align search/index expressions and add only evidence-backed composite/partial indexes.
3. Convert deep offset endpoints to cursor pagination.
4. Add daily/incremental analytics rollups.
5. Replace N+1 feature rollout, tenant resolution, device update, and relationship cleanup loops with set-based operations.
6. Add readiness/liveness, server deadlines, shared rate limiting, request backpressure, and graceful overload responses.
7. Rationalize API/browser/server caches and precise invalidation.

**Exit gate:** all top-20 routes meet agreed p95/p99 goals at large-tenant load; database CPU/IO and query counts stay within capacity headroom; no unexplained sequential scans.

### Phase 3 — Frontend interaction and loading

1. Capture cold/warm traces on representative low/mid/high-end mobile and desktop profiles.
2. Split global CSS by route; remove covered dead CSS.
3. Analyze and reduce initial JS execution, providers, duplicated dependencies, and route payloads.
4. Convert large images to responsive modern formats and eliminate duplicates.
5. Replace generic GET memoization with resource-aware cancellable queries.
6. Replace chat and notification polling with event deltas plus bounded reconciliation.
7. Gate speculative imports and pause all background polling when hidden/offline.
8. Throttle auth activity tracking.

**Exit gate:** field p75 Core Web Vitals pass for every important route/device cohort, not just the site aggregate; no long task over 200 ms in core journeys on the agreed reference device; route transitions remain responsive under network/CPU throttling.

### Phase 4 — Quality and operability

1. Make all critical API/database suites mandatory.
2. Add browser journey, load, spike, soak, worker-concurrency, and failure-injection tests.
3. Add route/payload/bundle/CSS/image budgets to CI.
4. Add SLO dashboards and alerts tied to user impact.
5. Add deployment canaries, automatic rollback conditions, and build-ID correlation.
6. Upgrade vulnerable dependencies with regression coverage.

**Exit gate:** a release cannot merge or promote when correctness, security, performance, or migration gates fail.

## Measurement targets

Targets must be confirmed after the baseline; these are the initial engineering gates.

### User experience

Use the official “good” p75 Web Vitals thresholds as the non-negotiable floor across mobile and desktop cohorts:

- LCP ≤ 2.5 seconds
- INP ≤ 200 milliseconds
- CLS ≤ 0.1

Internal stretch targets for core authenticated routes should be LCP ≤ 2.0 seconds, INP ≤ 150 milliseconds, and CLS ≤ 0.05 when representative data is loaded.

### API and worker targets

- Define per-route-class p50/p95/p99 rather than one global average.
- Initial goals: cached/simple reads p95 ≤ 200 ms; interactive search/directory p95 ≤ 500 ms; ordinary database mutations p95 ≤ 750 ms, excluding deliberately asynchronous third-party completion.
- 5xx rate below 0.1% over a meaningful volume window; timeouts and overload rejections tracked separately.
- No synchronous endpoint should wait for an audience-sized email/notification loop, PDF parsing, or CSV generation.
- Worker oldest-job age, queue depth, retry count, and terminal-failure rate must have explicit SLOs and alerts.
- Maintain at least 30% CPU, memory, database connection, and provider-rate-limit headroom at projected peak load.

### Frontend delivery budgets

After a fresh baseline, ratchet budgets downward rather than allowing regressions:

- Initial entry JS ≤ 100 KiB gzip.
- Initial global CSS ≤ 45 KiB gzip, with route CSS separately budgeted.
- Ordinary lazy route JS ≤ 40 KiB gzip unless an approved exception includes trace evidence.
- Track total initial requests/bytes, parse/evaluation time, font bytes, image bytes, and third-party cost—not only the largest chunk.
- No unoptimized raster above 250 KB on an initial or common route; responsive variants required.

### Database correctness and efficiency gates

- Zero unapproved unbounded collection reads.
- Zero silent unknown filters/operators.
- Zero exact counts unless required by the response contract.
- All list endpoints are stable and complete above 100,000-row fixtures.
- All destructive multi-table workflows are atomic and idempotent.
- Query count for a request is bounded independently of result/recipient count, except explicitly batched worker execution.

## Definition of “nothing material left to improve”

The optimization program may be considered closed only when all of the following are true:

1. Every P0 and P1 item in this audit is fixed, disproven by measurement, or explicitly accepted by the product/engineering owner with quantified impact.
2. Two consecutive production releases meet route- and cohort-level SLOs without regression.
3. A 2× projected-peak load test passes with the stated capacity headroom, and a multi-hour soak shows no memory, connection, queue, or latency drift.
4. Search, pagination, reporting, and deletion remain correct on datasets above all former 1,000/5,000/10,000 caps.
5. Browser profiles on representative devices show no unexplained long tasks, layout shifts, duplicate network requests, or wasteful hidden-tab activity in core journeys.
6. The top 20 database queries and top 20 API routes have owners, baselines, budgets, and dashboards.
7. Failure injection covers database timeouts, provider rate limits, worker crashes, duplicate webhooks, partial uploads, socket reconnects, and deployment interruption.
8. A second independent source/query-plan/trace pass finds no unresolved issue above the agreed materiality threshold (suggested: ≥2% journey latency, ≥5% resource reduction, correctness risk, or operational toil with recurring impact).
9. Any further proposal must include a benchmark showing a material improvement; speculative micro-optimizations are rejected.

After closure, rerun the audit quarterly and after major architecture, data-volume, framework, or provider changes. Performance is a maintained property, not a terminal code state.

## Recommended implementation PR sequence

To keep changes reviewable and reversible:

1. **Instrumentation and reproducible baseline** — no behavior change.
2. **Model factory contracts** — count opt-in, strict filters, pagination primitives, timestamp tests.
3. **Search SQL contract** — complete filters/ranking/cursor, scale correctness tests.
4. **Admin listing SQL contracts** — profiles, members, Unified People, streaming export.
5. **Analytics rollups** — compare old/new outputs before cutover.
6. **Transactional deletion workflows** — shadow/dry-run verification and fault injection.
7. **Worker foundation and atomic claims** — notifications first, then email/webhooks/resumes/exports.
8. **HTTP resilience** — readiness, deadlines, body limits, shared rate limiting, overload behavior.
9. **Frontend request/cache lifecycle** — aborts, precise invalidation, realtime counters.
10. **CSS/assets/bundle reduction** — trace-led and guarded by visual/function tests.
11. **CI completeness and performance gates** — make release evidence mandatory.
12. **Dependency/runtime upgrades** — Node alignment, Express 5 migration, deduplication.

## Sources and standards

- [Web Vitals thresholds and field-measurement guidance](https://web.dev/articles/vitals)
- [Supabase JavaScript select and pagination guidance](https://supabase.com/docs/reference/javascript/v1/select)
- [Render health checks](https://render.com/docs/health-checks)
- [Render scaling](https://render.com/docs/scaling)
- [Render background workers](https://render.com/docs/background-workers)
- [Vite runtime requirements](https://vite.dev/guide/)

## Progress log

### 2026-09-04 — Phase 0 unblocked, PR 2 landed

**Phase 0, step 1 is done and the cause is now understood.** The blocker was
not cloud-placeholder hydration. The primary checkout sits under the
iCloud-synced `~/Desktop`, where reads cost ~7 ms/file; the same tree in a
worktree under `~/pondbridge-worktrees` reads ~56x faster. Every Node tool
appeared to hang at 0% CPU because it was starved on I/O, not because it had
failed. Run lint, tests, and builds from a worktree.

Two further facts worth carrying forward:

- Cold jest costs ~50 s of ESM/babel transform before the first test runs.
  Warm, the whole API safe suite finishes in ~8 s. A CI cache of jest's
  transform directory is worth more here than any test-level optimisation.
- `apps/api/.env` is untracked, so a fresh worktree fails ~every suite with
  `Missing JWT_SECRET`. A committed `.env.test` with deliberately fake
  credentials would make the suite reproducible and keep tests from ever
  reaching a live camp.

**PR 2 of the implementation sequence ("Model factory contracts") is
committed** on branch `perf/model-factory-contracts`:

- PERF-DB-01 — fixed. Exact counts are opt-in via `{ count: true }`. Only
  three endpoints ever read `_count`; they now ask for it. `_count` is left
  undefined when uncounted so a fallback cannot report a page length as a
  total.
- PERF-DB-03 — fixed. Unknown filter fields and unsupported operators throw
  `UnknownFilterError` (`status: 400`) outside production and log-and-drop in
  production. Contract tests in `apps/api/tests/modelFilterContract.test.js`.
- PERF-DB-02 — primitive delivered, callers not yet converted. `findAllBatched`
  walks a table by keyset on the primary key, so completeness no longer
  depends on staying under PostgREST's 1,000-row cap. Converting the ~193
  `Model.find` call sites is the remaining work, and belongs with PRs 3 and 4.

Also found and fixed: `jest.safe.config.cjs` listed `outreach.test.js`, which
no longer exists. Jest matched nothing and reported success, so the "safe"
suite had been quietly running one fewer file than its own list claimed. This
is a small instance of the Section E problem — the gates do not verify
themselves.

**Phase 1 item 7 (tenant-bootstrap race) is fixed.** FUNC-WEB-06 was worse
than recorded: `TenantProvider`'s `cancelled` flag was read in a `.then()`
after the fetch resolved, by which point the fetch had already written React
state, run `applyTheme`, written both the slug- and host-keyed payload caches
and set `pondbridgeTenantSlug`. A slow camp A therefore overwrote camp B in
all of them, and the poisoned host-keyed cache meant a reload repainted the
wrong camp. Fixed with per-request generations; the fetch moved to a
module-level `createTenantFetcher` taking its collaborators by injection,
because `apps/web` has no jsdom and an effect-driven test cannot run. Removing
the guard fails 4 of the 5 new tests.

An AbortController was considered and deliberately not used: `requestJson`
drops out of its shared in-flight GET memo whenever a signal is present, and
`AuthProviderRuntime` requests the same tenant-config URL on the same load, so
aborting would add a duplicate request on every page load to avoid a response
nobody reads.

**PERF-API-05 and REL-API-06 are fixed.** Boot no longer selects every column
of every tenant with an exact count — a head-only count plus a bounded
ten-row sample for the log. `/livez` and `/readyz` now split liveness from
readiness; the readiness check is a head-only count with a hard deadline, a
5 s result cache and in-flight collapsing. `/health` is unchanged and still
served.

One deliberate non-change: `render.yaml` (`healthCheckPath: /health`) and
`fly.api.toml` (`path = "/health"`) still point at the configuration-only
endpoint. Repointing them at `/readyz` is what makes the split take effect in
production, and it is a deploy-behaviour change that should be made
knowingly — a failing `/readyz` will pull the instance out of rotation.

**Still open from Phase 1:** items 3-6 (SQL-side listing contracts,
transactional deletion, atomic job claiming, queued email/webhook/parsing
work).

## Validation log

- `npm run lint`: passes; 0 errors, 2 pre-existing `no-unused-vars` warnings in
  `scripts/seedDemoGiving.js` and `src/services/billing.js`.
- API `jest.safe.config.cjs` suite: 57 suites, 411 tests, all passing.
- Web `vitest run`: 39 files, 251 tests, all passing.
- `npm audit --omit=dev --audit-level=moderate`: completed; five moderate production advisories.
- `npm run build`: not yet run from a worktree; the Node/Vite version warning
  in the original attempt was spurious — Node 22.17.0 already satisfies the
  declared `^20.19.0 || >=22.12.0` engine range, so Phase 0 step 2 needs no work.
- No user source files were modified as part of validation. The pre-existing changes in `DirectorCreateAccountPage.jsx`, `apps/ios/android/`, and `apps/ios/ios/App/App/config 2.xml` were left untouched.
