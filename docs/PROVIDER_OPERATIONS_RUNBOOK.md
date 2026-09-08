# Provider operations and deployment runbook

Last verified: 2026-09-08

## Production authority

PondBridge has one production path:

- API: the `pondbridge-api` Render web service (`srv-d6dr8bstgctc73ch2j80`),
  deployed from `main` after GitHub checks pass.
- Web: the `pondbridge` Cloudflare Pages project, deployed from its production
  branch and served through `app.pondbridgealumni.com` and camp domains.
- Database: the production Supabase project. Application releases must keep
  database changes backward compatible so an application rollback does not
  require an emergency destructive migration.

`fly.api.toml` and `vercel.json` are retained deployment alternatives. They are
not failover targets, are not part of the production release, and must not be
deployed or given production DNS without a separate reviewed cutover plan.

## Configuration-only readiness check

The readiness command reads the current process environment and repository
contract. It never calls a provider, prints a value or identifier, or changes an
account:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run provider:readiness
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run provider:readiness -- --json
```

Use Node's `--env-file` option when checking an ignored environment file. Do not
redirect the environment file or shell tracing into release logs:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node \
  --env-file=/absolute/path/to/ignored/.env \
  apps/api/scripts/providerReadinessAudit.js --strict
```

`configured` means the local contract is complete. `configured_with_warnings`
means the integration can run but lacks a recommended narrow credential or
webhook. `unverified` means an enabled or required integration is missing local
configuration. `disabled` is expected for optional providers that have no
activation configuration. Account, billing, webhook-delivery and usage evidence
remain `unknown` until a dated provider read is attached to the release record.

Cloudflare Stream deliberately keeps its established activation rule: account
ID plus a dedicated Stream token, or the existing generic Cloudflare-token
fallback. The Blueprint now declares the dedicated token, webhook secret and
customer subdomain, but it does not populate them or change production behavior.

## Normal release

1. Record the exact commit SHA and confirm required GitHub checks passed on that
   SHA. Run the repository lint, safe tests, web build/budget check, database
   preflight and environment hygiene checks.
2. Confirm the Render service still uses branch `main`, health path `/health`,
   and `checksPass`. Confirm the Pages production branch is `main`. Stop if
   either provider points elsewhere.
3. Merge the reviewed commit to `main`. The provider integrations perform both
   production deployments. Do not add a manual Render deploy or Wrangler upload
   to the normal Git-integrated path.
4. Match each provider deployment to the recorded commit SHA. Wait until both
   providers report success before accepting the release.
5. Verify `GET https://api.pondbridgealumni.com/health`, then `/readyz`; both
   must return HTTP 200. Verify the Pages site and one immutable asset. Complete
   an authenticated director route, a member route, and one camp-domain route.
6. Record deployment IDs, completion times, health results and any provider
   configuration change. Never paste secret values into the release record.

Render treats `success`, `neutral`, and `skipped` GitHub conclusions as passed
for its `checksPass` trigger. Required GitHub checks must therefore reject a
release on the checks PondBridge considers mandatory; the Render trigger alone
does not define that policy.

## Read-only deployment inventory

Keep tokens in the shell's secret source. The following requests return
deployment metadata and must be filtered before attaching output to an issue or
release record:

```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer $RENDER_API_KEY" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys?limit=10"

curl --fail --silent --show-error \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT_NAME/deployments?env=production"
```

Use provider dashboards or a JSON filter to retain only deployment ID, commit
SHA, status and timestamps. Do not store the full response if it contains
environment metadata.

## Rollback

Choose an exact recent successful production deployment whose commit is known.
Never select a target only because it is the previous list item.

1. Stop new releases. Pause production autodeploys in both provider dashboards
   while the incident is active.
2. If the API is unhealthy or incompatible, roll Render back first. If only the
   web is broken, roll Pages back without changing the API. When both must move,
   prefer the pair of deployments previously verified together.
3. Render reuses the selected build artifact and deploy-specific start/health
   configuration, but keeps current service configuration such as environment
   variables. Confirm those values remain compatible with the old application.
4. Cloudflare can roll back only to a successful production deployment. Confirm
   the target deployment's production environment and commit before the call.
5. Repeat `/health`, `/readyz`, web, asset, authenticated and camp-domain checks.
6. Revert or fix `main` through a reviewed commit before re-enabling autodeploys.
   An API-triggered Render rollback does not disable autodeploys, so the next
   qualifying commit can redeploy the bad version.

After inspecting the exact target IDs, the rollback calls are:

```bash
curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $RENDER_API_KEY" \
  --header "Content-Type: application/json" \
  --data "{\"deployId\":\"$RENDER_ROLLBACK_DEPLOY_ID\"}" \
  "https://api.render.com/v1/services/$RENDER_SERVICE_ID/rollback"

curl --fail --silent --show-error \
  --request POST \
  --header "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$CLOUDFLARE_PAGES_PROJECT_NAME/deployments/$CLOUDFLARE_ROLLBACK_DEPLOYMENT_ID/rollback"
```

Do not reverse an additive database migration during the application rollback.
If a migration is not backward compatible, the release was not ready for this
deployment path and needs a separately rehearsed database recovery plan.

## Capacity and quota record for 10–20 camps

The expected range is 3,000–12,000 registered members. Member count is a
planning input; upgrades should follow measured provider units.

| Provider         | Record at least weekly during rollout                                                   | Review threshold                                                                                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render           | p95/p99 latency, request count, CPU, memory, restarts and instance count                | Investigate at sustained peak CPU or memory above 70%; prepare a measured scale change by 80% or when latency/restarts deteriorate. The current legacy Starter maps to 0.5 CPU/512 MiB. |
| Cloudflare Pages | successful/failed builds, monthly build count, queue delay, file count and largest file | Review at 400 of the Free plan's 500 monthly builds, any recurring one-build concurrency queue, 18,000 files, or 22 MiB largest file.                                                   |
| R2 Standard      | GB-month, Class A and Class B operations, 429/5xx rates                                 | Alert at 70% and review at 85% of the included 10 GB-month, 1M Class A, or 10M Class B monthly amounts. Track the app's default 20 MiB upload guard separately.                         |
| Stream           | stored minutes, delivered minutes, encoding errors and webhook lag                      | Alert at 70% and review at 85% of the prepaid minute allocation. Current public prices are $5/1,000 stored minutes and $1/1,000 delivered minutes.                                      |
| Clerk            | registered users, monthly retained users, sign-in errors, 429s and `Retry-After`        | The 12,000-member forecast is below the current 50,000-MRU Hobby allowance, but plan features can require an earlier upgrade. Investigate every sustained 429 increase.                 |
| Stripe           | request 429s, webhook age/backlog, failed deliveries, disputes and payment failures     | Page on webhook backlog or failed signature/delivery; request capacity review before traffic approaches the documented 100 operations/s live baseline.                                  |
| OpenAI           | cost by project/model, application budget denials, tokens, latency and 429s             | Alert at 70% and review at 85% of each PondBridge monthly application budget, then reconcile with the provider Costs view. Increase limits only for an approved camp cohort.            |

Supabase backup, restore and connection controls are maintained in the database
recovery record. Email volume, bounce/complaint and sender controls are maintained
in the deliverability record so those operators can change independently without
turning this deployment runbook into a second source of truth.

## Official references checked on 2026-09-08

- [Render deploys](https://render.com/docs/deploys), [health checks](https://render.com/docs/health-checks), [rollbacks](https://render.com/docs/rollbacks), [compute plans](https://render.com/docs/compute-plans), and [pricing](https://render.com/pricing)
- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [Git integration](https://developers.cloudflare.com/pages/configuration/git-integration/), and [deployment API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/)
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Stream pricing](https://developers.cloudflare.com/stream/pricing/) and [webhooks](https://developers.cloudflare.com/stream/manage-video-library/using-webhooks/)
- [Clerk pricing](https://clerk.com/pricing) and [rate limits](https://clerk.com/docs/guides/how-clerk-works/system-limits)
- [Stripe API rate limits](https://docs.stripe.com/rate-limits) and [webhooks](https://docs.stripe.com/webhooks)
- [OpenAI Usage API](https://platform.openai.com/docs/api-reference/usage) and [rate limits](https://platform.openai.com/docs/guides/rate-limits)
