# Camp Cedar outreach demo

Tooling that turns the local staging Cedar tenant into a fully-dressed demo
network, screenshots it, and builds the outreach deck.

Everything runs against **local staging only** (`127.0.0.1:54322`). Nothing here
touches production, and nothing is sent to a real address.

## What is fictional and what is real

Real, and deliberately kept:

- Camp Cedar branding — logo, navy palette, lake photography, background art
- The Cedar Chest newsletter naming and seasonal archive structure
- Cedar's own sanitized waterfront photos (`covers/cedar-chest/photos-sanitized/`),
  which contain no people

Fictional, and generated here:

- All 61 members — names, emails, employers, colleges, cities, bios
- All messages, forum posts, events, family trees, and activity
- All analytics: sign-ins, join dates, last-active timestamps

No member avatars are seeded, so every person renders with the initials
placeholder. No real alum is identifiable anywhere in the demo.

## Running it

Start local staging first (**not** `npm run dev`, which points at production):

```bash
npm run staging:local:dev
```

Seed the demo data. The script is idempotent — it clears its own rows first, so
it is safe to re-run:

```bash
node scripts/demo/generateCedarDemoSeed.mjs > /tmp/cedar-demo.sql
docker exec -i supabase_db_pondbridge-local-staging \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 < /tmp/cedar-demo.sql
```

The photo stream serves from `apps/web/public/demo/`, populated by:

```bash
mkdir -p apps/web/public/demo
cp covers/cedar-chest/photos-sanitized/*.jpg apps/web/public/demo/
rm -f apps/web/public/demo/test-2024-fall.jpg
```

`npm run staging:local:reset` restores the canonical three-camp seed and wipes
all of this.

## Screenshots and deck

These use Playwright, installed outside the repo. Both write absolute paths that
you will want to point at your own output directory before re-running.

- `capture.mjs` — logs in as a member and as the director, captures 20 retina
  (2×) screenshots at 1440×900
- `fixups.mjs` — re-captures the three screens that need a click first (open
  conversation, open forum thread, selected member)
- `deck.mjs` — builds `outreach/PondBridge-Camp-Cedar.pptx` from those images

## Demo logins

Password for every account is `Pondbridge123!`.

| Role | Email |
| --- | --- |
| Director | `marc.ellison@cedar.example.test` |
| Member | `jordan.whitfield@cedar.example.test` |

Any member in the roster can sign in; the address is always
`first.last@cedar.example.test`.
