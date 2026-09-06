# Staging UI review — 2026-09-04

Walkthrough of the whole app against the hosted staging project
(`pvmabzjotcpvdpffsrgp`) seeded to production scale: 3,006 profiles in Camp Cedar
(production Cedar has 2,972), 60 cities, 25 events, 601 RSVPs, 6 forums / 241 posts,
80 photos, 152 activity items.

Severity:
- **P0** — wrong data shown to users, or a flow that cannot be completed
- **P1** — materially misleading, broken interaction, or wasted capacity
- **P2** — polish, copy, consistency

---

## P0

### UI-01 — Alumni browse silently caps at 1,000 of 2,874

**Where:** `/search` → "Browse all alumni"

**Evidence:**
```
GET /api/t/cedar/search/users?sort=recent&browseAll=1&offset=0&limit=24&fetchLimit=1000
UI header: "Showing 1-24 of 1000"
DB truth:  3,006 profiles, 2,874 active
```

The `fetchLimit=1000` cap is presented as a total. Around 1,900 members are
unreachable by browsing and nothing signals it — 1,000 reads as a real count.

This is `PERF-DB-02` in PERFORMANCE_AND_FUNCTIONALITY_AUDIT.md, which was marked
*pending, requires production-like row counts*. Production Cedar has 2,972 profiles,
so this is live today. It was invisible with the previous 6-profile seed.

### UI-02 — Home "Community Pulse" shows the same capped number as "1k Alumni"

**Where:** home, Community Pulse tile
**Evidence:** `GET /api/t/cedar/home/bootstrap` → `stats.totalAlumni: 1000`

Rendering it as "1k" disguises the cap: it reads as a rounded display, not a ceiling.
Compare `member-counts-have-one-definition` — there is supposed to be a single
definition of member count, and this one disagrees with the database.

### UI-15 — Director's own People page shows 1,028 of 3,003, and Export runs off it

**Where:** `/admin/people/all`

**Evidence:**
```
GET /api/t/cedar/admin/people?stage=all&page=1&pageSize=25  ->  {"total": 1028}
DB:  3,003 users / 3,003 profiles in the tenant (2,871 active profiles)
UI:  "Everyone 1028"  "Members 1026"  "1,028 people"
```

The list is properly server-paginated (`pageSize=25`), so paging itself is fine —
but the **total is computed from the capped set**, so the pager ends around page 41
and roughly 1,975 people cannot be reached, filtered, or acted on by the director.

An **Export** button sits directly above this list. If it exports the same set, every
export a director has ever taken is silently short by two thirds. Verify before
anything else — a truncated member export is the kind of error that only surfaces
when someone reconciles against another system.

One click earlier, the Today dashboard renders **MEMBERS: 2871** correctly.

---

## P1

### UI-03 — Home fires every bootstrap request three times

**Where:** home, on load
**Evidence:** `/me`, `/home/bootstrap?activityLimit=50`, `/photos?sort=new&limit=2`,
and `/conversations` each appear 3x in the network log for one page load. All 200.

Three round trips for one result, on the heaviest screen in the app.

### UI-04 — Activity feed throws away its own copy

**Where:** home → Feed
**Evidence:** payload item is
`{"type":"photo_added","message":"added a photo","actor":{"name":"Finley Yamamoto"}}`
but the UI renders **"Finley Yamamoto did something in the app"**.

The rendered feed is generic filler for every entry. An actor with an empty name
renders as the literal string **"Someone"** (seen on the seeded announcement).

### UI-05 — Navigation is built from buttons, not links

**Where:** the whole app — landing page Login/Create Account, and every item in the
main menu (Home, My Profile, Media Stream, Events, Giving, Alumni Map, ...).

**Evidence:** every menu item is `[role=menuitem]` with **no `href`**. Only "Go to
Home" is a real link. Consequences: no middle-click, no open-in-new-tab, no
right-click "copy link address", nothing for assistive tech to announce as a link,
and no URL to share for any section.

Related: on the logged-out landing page, both Login buttons produced no navigation,
no console error and no network request when clicked (twice each). Typing `/login`
works. NEEDS RE-VERIFY logged out — observed while a session existed.

### UI-05a — Original note: both Login buttons on the public landing page do nothing

**Where:** `/` (logged out), header Login and hero Login
**Evidence:** both are `<button>` elements. Clicked twice each: no navigation, no
console error, no network request. Navigating to `/login` directly works.

NEEDS RE-VERIFY in a clean logged-out session — observed while a session existed.

### UI-06 — Two endpoints disagree about how many members exist

`GET /search/facets` returns **`"total": 3003`** — correct, and it enumerates all
11 camp roles with accurate per-role counts.
`GET /search/users` returns 1000. `GET /home/bootstrap` returns 1000.
`GET /map/cities` returns `totalAlumni: 2871` but `mappedAlumni: 1000`.
`GET /admin/people` returns `total: 1028`.
The director dashboard "Today" tile renders **2871**, correctly.

Four different answers to "how many members are there", on four screens of one app:
**1000 / 1028 / 2871 / 3003.**

So the correct number is already computed in at least two code paths. The capped
paths are not "unable" to count — they disagree. Compare the working agreement
that member counts have exactly one definition.

### UI-16 — "All Forums" shows only the forums you already belong to

**Where:** Chats & Forums -> Forums -> All Forums

**Evidence:** `GET /api/t/cedar/forums` returns **all 6** forums
(Camp Traditions, Career Help, Housing & Roommates, Photo Swap, Regional Chapters,
Reunion Planning). The UI renders **1** — Reunion Planning, the only one the director
is a member of — and the counter still reads "Forums 1". Switching the tab changes
the highlight and nothing else.

The API is fine; the client filters. Members cannot discover a forum they have not
already joined, which makes forums effectively invite-only by accident.

### UI-17 — Events promotes a cancelled event as "NEXT UP"

**Where:** `/events`
**Evidence:** the featured hero reads "FEATURED EVENT · NEXT UP — Alumni Happy Hour
2026" with a red **Cancelled** badge on the same card.

### UI-18 — Giving contradicts itself on one screen

**Where:** `/giving`
**Evidence:** hero reads "312 alumni across **4 active causes**"; the section below
reads "Active causes ... **3 causes**".

### UI-09 — Alumni Map plots at most 1,000 of 2,871

**Where:** `/map`
**Evidence:** `GET /api/t/cedar/map/cities` →
`{"totalAlumni":2871,"mappedAlumni":1000,"unresolvedCityCount":0}`

Same 1,000 cap, third surface. `unresolvedCityCount: 0` confirms city matching is
healthy — the members simply are never fetched.

### UI-10 — Map header count disagrees with its own payload

**Where:** `/map` header and empty state
**Evidence:** UI reads "771 of 2871 alumni across 46 cities". The payload it just
received contains **60** cities and `mappedAlumni: 1000`.

771/46 looks like a count of clusters currently in the viewport, but the copy does
not say "in view" — it reads as a total. Two different wrong numbers on one screen.

### UI-11 — Map polls itself with a cache-busting timestamp

**Where:** `/map`
**Evidence:** 15 requests to `/api/t/cedar/map/cities?refresh=<epoch-ms>` in about
30 seconds, ~4-7s apart. The changing query string defeats every cache layer.

This is aggregate data that changes when someone edits their city.

---

## P2

### UI-07 — Inconsistent name styling in result cards
One member name rendered underlined while all others were not (`Nina Iqbal`).

### UI-08 — "Complete Your Profile" modal appears over unloaded content
On login the modal renders while the cards behind it are still grey skeletons.

### UI-19 — Event times crossing midnight give no day indication
Cards read "SUN, SEP 13 · 9:33 PM – 1:33 AM". The end time is the following day and
nothing says so.

### UI-20 — Media Stream header collapses at tablet width
At a 749px viewport the header description renders in a **134px-wide, 132px-tall**
column beside the Sort/Upload controls. Measured, not eyeballed.

### UI-21 — Growth stat is unclamped
Director dashboard shows "Up **7659%** in 30 days". The magnitude here comes from the
review seed, but nothing clamps or suppresses a meaningless percentage, and a real
camp importing its back catalogue would see the same thing.

### UI-12 — Four different phrasings for "empty" on one profile page
`No social links yet.` / `No experience added yet.` / `Not added yet.` /
`Nothing posted yet.` — same concept, four voices, all visible without scrolling.
The Experience empty text is also indented while the others are flush left.

### UI-13 — An action button sits inside the metadata pill stack
On a profile, `Camper` (role), `Hospitality` (industry) and `Message` (an action)
render as three stacked pills in one centred column. The action reads as a third tag.

### UI-14 — Search empty state advertises a role the tenant does not have
Copy reads "Filter by camp roles (Camper, Counselor, JC, and 2 more)". This tenant
has no `JC` role at all — its 11 roles include `CIT`, `Nurse`, `Program Director`.
The filter itself is correctly data-driven (facets prove it); only the example copy
is hardcoded.

---

## Checked and NOT a defect

Each of these looked wrong and was measured before being ruled out.

- **Collapsed page layout** in early screenshots — browser-pane compositing
  artifact. `body`, `header` and `#root` all reported 1440px.
- **Filter drawer sections appearing to clip their inputs** — measured every
  section: 60px tall, `overflowsBy: 0`. Collapsed-section styling, not overflow.
- **"Related Profiles" appearing to repeat names and include the current member** —
  measured: `selfReferences: 0`, all five ids distinct. The repeated names are
  collisions in the review seed's generated names, not a product bug.
- **Profile pages returning `400 INVALID_ID`** — caused by the review seed using
  ids containing `s`/`t`/`g`/`p`. The API correctly validates ids as 24-char hex.
  Re-seeded with hex ids; profiles then load fine. Seeding mistake, not a defect.

## Seed artifacts to ignore when reading this document

- Generated member names collide (40 first x 40 last, modular), so the same name
  appears on different people. Not duplicate records — ids differ.
- Most members have no job history, so cards show no employer line.
- Phone numbers are `555-01xx` and render as `tel:5550100`.

## Still to review

Media Stream, Events & Info Sessions, Giving, Chats and Forums, Family Trees,
Newsletter, Merch Shop, Edit Profile, Director Dashboard (members, invites, email,
billing, settings), super admin console, mobile viewport, dark mode.

---

# Fix status — 2026-09-04

## Fixed and verified

### The 1,000-row cap (UI-01, UI-02, UI-06, UI-09, UI-15)

Root cause: **PostgREST enforces `max-rows = 1000` server-side, and a client limit
cannot raise it.** Verified directly against this project:

```
?limit=25000          -> 1000 rows, content-range: 0-999/2871
Range: 0-24999        -> 1000 rows
```

So my first attempt — passing bigger explicit limits — was wrong and changed nothing.
The working fix has three parts:

1. `apps/api/src/db/queryLimits.js` (new) documents the real constraint.
2. `Model.findAll()` in `_factory.js` pages through in 1,000-row batches with a
   25,000-row ceiling, so a whole-tenant read is explicit rather than silently short.
3. `find()` now warns when a **limitless** query returns fewer rows than its own
   `count`, which is precisely the silent truncation that caused all of this.

Call sites moved to `findAll()`, or to `count()` where only a total was wanted:
`readHomeStatsPayload`, `aggregateCityCounts`, `aggregateVisibleAlumniCount`
(legacyCedarCompat.js), `resolveFilteredPeople` and `/growth` (admin.js). The client's
hardcoded `fetchLimit=1000` is gone from AdvancedSearch.jsx, and the AI-plan path in
search.js now uses `SEARCH_POOL_DEFAULT` like every other search path.

| | before | after | truth |
|---|---:|---:|---:|
| Admin People total | 1,028 | **3,005** | 3,003 + 2 prospects |
| Home `totalAlumni` | 1,000 | **2,871** | 2,871 |
| Map `mappedAlumni` | 1,000 | **2,871** | 2,871 |
| Search browse total | 1,000 | **3,003** | 3,003 |

API suite: **56/56 suites, 400/400 tests pass.**

### UI-04 — Activity feed copy

`renderVerb()` switched on dotted type names (`photo.upload`) while the feed emits
snake_case (`photo_added`, `forum_post`), so every item hit the default and linked to
a target that did not exist. The server already sends written copy; the feed now
prefers it and only renders a link when there is a real target.

Before: "Finley Yamamoto did something in the app"
After: "Finley Yamamoto added a photo" / "Noah Moreau is attending Summer Reunion"

## Withdrawn — not defects

### UI-16 — "All Forums" ~~shows only joined forums~~

My seeding error, not a product bug. Five of the six forums were seeded with ids like
`stgf00000000000000000005`, which are not valid ObjectIds. `normalizeForumEntity()`
correctly returns `null` for a malformed id and the list drops it, so only the one
legitimately-seeded forum survived. Re-seeded with hex ids: All Forums now lists all
seven. **The feature works.** A change I had already written to "fix" it was reverted.

### UI-03 — Home ~~fires every bootstrap request three times~~

The app renders inside `React.StrictMode`, which deliberately double-invokes effects
**in development only**. The duplicate requests are that, not a production defect.
Withdrawn — but see the note below, because it did hide something.

## Still open

UI-05 (navigation built from buttons, no hrefs), UI-07, UI-08, UI-10 (map header count
vs payload), UI-11 (map cache-busting poll), UI-12, UI-13, UI-14, UI-17 (cancelled
event featured), UI-18 (Giving 4 vs 3 causes), UI-19, UI-20, UI-21.

Plus the areas never reached: Family Trees, Newsletter, Merch Shop, Edit Profile, the
rest of the Director tabs, super admin, mobile, dark mode.

## Worth doing next, beyond the list

- **Verify the People CSV export** actually returns 3,005 rows now. The count is
  fixed; the export path was never exercised.
- **`aggregateCityCounts` should be a database `GROUP BY`**, not 3 round trips and a
  JS tally. It is marked with a TODO in the source.
- **Consider raising `db-max-rows`** on the Supabase project. Paging is the correct
  fix and is now in place, but every unaudited `find()` in the codebase still has this
  trap under it — the new `find()` warning will surface them as they are hit.

---

# Fix status — round 2

## Also fixed and verified

### UI-09, UI-10, UI-11 — all were the 1,000-row cap

No separate fix needed. With the cap gone the map reads **"2871 alumni across 60
cities"** (was "771 of 2871 across 46"), pin counts went from 15-18 to 47-99+, and the
page now makes **2 requests with no `?refresh=` cache-buster** (was ~15).

The retries only fire when `unresolvedCityCount > 0`. Under the capped data the map
never saw a complete set, so it kept retrying — bounded at 8 attempts with backoff,
which is the mechanism working as designed, not a polling bug. My description of it as
"polls itself with a cache-busting timestamp" was wrong.

### UI-17 — Cancelled event featured as "NEXT UP"

`EventsPage.jsx` took `filteredUpcoming[0]` regardless of status. It now takes the
first event that is not cancelled. Cancelled events still appear in the list below with
their badge. Verified: hero is now "Family Day 2025", not the cancelled happy hour.

### UI-18 — Giving said "4 active causes" and "3 causes" on one screen

The hero counts every active cause; the grid below excludes the general fund, which has
its own card above it. The section now counts the same set as the hero, and says
"N of M" when a category filter narrows it.

### UI-19 — Events crossing midnight

"9:33 PM – 1:33 AM" now renders as **"9:33 PM – 1:33 AM (Mon, Sep 14)"** when the end
falls on a different day in the event's own timezone.

Web suite: **38/38 files, 246/246 tests pass.** API suite still 56/56, 400/400.

## Withdrawn — not defects

### UI-14 — Search role preview ~~is hardcoded~~

`rolePreview` derives from `resolveStaffRoleOptions(tenant)` — the tenant's *configured*
role vocabulary — and the filter itself merges those with the roles actually observed in
the facets. Naming "JC" is correct for this tenant. My seed simply used roles
(CIT, Nurse, Program Director) outside Cedar's configured list.

That is the third finding withdrawn because the review seed diverged from real tenant
configuration or id formats, after UI-16 (non-hex forum ids) and the profile
`400 INVALID_ID`. Worth remembering when reading anything else in this document: check
whether the data is plausible before believing the bug.

## Still open

UI-05 (navigation built from buttons rather than links — the largest remaining one),
UI-07, UI-08, UI-12 (four phrasings of "empty"), UI-13, UI-20, UI-21.

Unreviewed areas: Family Trees, Newsletter, Merch Shop, Edit Profile, remaining Director
tabs, super admin, mobile, dark mode.

## Note on working tree

`EventsPage.jsx`, `EventDetailPage.jsx`, `events.js` and `onboarding.js` already carried
uncommitted work before this review (`events.js` alone was +330 lines). My edits to
`EventsPage.jsx` are two small, self-contained changes, but they now sit alongside that
work — worth separating before committing.

---

# Fix status — round 3, and the remaining areas

## Fixed

### UI-05 — Navigation is now built from links

`NavBar.jsx` rendered every menu item as a `<button>` with an onClick calling
`navigate()`. Internal destinations are now `<Link to=...>`, so every section has a real
`href`: middle-click, open-in-new-tab, copy-link-address, and screen-reader link
semantics all work, and each section has a URL a member can share. Verified — all
thirteen internal items report `tag: "A"` with an href.

Merch Shop stays a button because `openExternalUrl()` is what routes it correctly in
the native app; Log Out stays a button because it is an action, not a destination.

### UI-12 — One voice for empty sections

Six phrasings across `PublicProfile.jsx` and `MyProfile.jsx` are now consistent:
"No media yet." / "No experience yet." / "No education yet." / "No camper years yet." /
"No social links yet." / "No related profiles yet." (Previously "Nothing posted yet.",
"No experience added yet.", "Not added yet.", "No education added yet.")

### UI-21 — Growth percentages are readable

`deltaHint()` showed "Up 7659% in 30 days". Past 10x it now reports a multiple
("Up 77x in 30 days"), and rounds the percentage below that. A camp importing its back
catalogue hits this on day one.

Both suites green after all changes: **API 56/56 (400 tests), web 38/38 (246 tests).**

## Withdrawn — not defects

### UI-05a — The landing Login buttons ~~do nothing~~
They work. Logged out, clicking Login goes `/` -> `/login`. My original test ran with an
active session, where `/login` redirects back to `/` — so the button worked and the app
looked frozen. My error, not the app's.

### UI-13 — Message button ~~sits inside the metadata pill stack~~
The markup is already correct: role and industry chips are in `.p1-roles` /
`.p1-industry-row`, and the button is in its own `.p1-actions` block. The similarity is
visual weight, which is a design call, not a bug. Left alone rather than making
speculative CSS changes.

### Edit Profile sticky footer ~~covers the last form controls~~
Measured mid-scroll and it looked like "Add Camper Year" and "Add Staff Years" were
behind the fixed footer. At the true page bottom, `controlsBehindFooter: []` — the form
has correct clearance. My measurement was taken at the wrong scroll position.

## Areas reviewed this round — no defects found

| Area | Result |
|---|---|
| Family Trees | Clean empty state |
| Newsletter | Clean empty state. Minor: the "Upload Issue" button stretches to the height of two stacked selects |
| Edit Profile | 4-step wizard, **17/17 inputs correctly labelled**, correct sticky-footer clearance |
| Mobile (375x812) | No horizontal overflow on home, search, or admin People. The admin tab bar scrolls inside its own container, which is the right pattern |
| Dark mode | The app renders its light theme regardless of `prefers-color-scheme`. There is no dark theme — a design choice, not a defect |

## Still not reviewed

Merch Shop, the Director Events / Giving / Email tabs, and the super admin console.

---

# Round 4 — Director Email, and a fix I had to back out

## UI-22 — Email audience is built from a truncated read — P0, FIXED

**Where:** Director Dashboard -> Email -> Compose, recipient picker

**Evidence:** targeting the role "Counselor" reports an audience of **250**.
The database has **751 Counselor profiles, 717 active**.

`resolveProfilesForTargeting()` in `admin.js` runs
`ProfileModel.find(tenantId, { status: { $ne: "removed" } })` with no limit — capped at
1,000 rows — and then applies the role / industry / segment filters **in JS**. Counselor
is 3 of the 12 seeded roles, so a contiguous 1,000-row slice yields exactly 250.

This is the same root cause as UI-01/02/09/15 but the worst instance: a director
targeting a role emails roughly a third of them, and the composer reports the truncated
number as the audience, so nothing looks wrong.

**The second bug the cap was hiding.** Switching to `findAll()` fixed the count and
immediately made `/email/recipients-preview` return **500 "Bad Request"**. The cause was
URL length: PostgREST takes `.in(...)` as a query string, and `resolveEmailRecipientEligibility()`
passes every recipient address to `email_suppressions` and `email_preferences` in one
filter. Measured:

| recipients | URL | result |
|---:|---:|---|
| 250 | 10.1 KB | 200 OK |
| 717 | 28.8 KB | **400 Bad Request** |

So the 1,000-row cap had been masking a hard ceiling on audience size. Any camp that
grew past roughly 600 deliverable recipients would have hit it the moment the cap was
lifted — and would have hit it anyway on a large enough send.

Note the first two hypotheses were wrong and are worth recording: a raw unquoted `$in`
of 717 addresses returned 200 (supabase-js **quotes** each value, which pushed the URL
over), and limit+offset paging is fine.

**Fix.** `chunkForInClause()` in `db/queryLimits.js`, batch size 200 (~8 KB of URL),
applied to `EmailSuppressionModel.findActiveByEmails`,
`EmailPreferenceModel.findUnsubscribedByEmails`, and the do-not-contact lookup in
`resolveRecipientsForTargeting`. `ProfileModel.findAll` then restored for targeting.

**Verified:** targeting "Counselor" now reports **751**, matching the database exactly
(was 250).

## Also reviewed

**Director Email composer** — well built. The recipient picker offers roles, industries,
class years, groups and individual members, resolves as you type, and shows a live
audience count. Everything works apart from UI-22 above.

## Still not reviewed

Merch Shop, Director Events and Giving tabs, super admin console.

---

# Round 5 — the last three areas, and a design pass

## Merch Shop

Not a page. It is the one external item in the menu — a `<button>` calling
`openExternalUrl()` with no configured destination on this tenant. Nothing to review.

## Director -> Events & info sessions

Calendar view with month navigation, Today, and tab counts (Upcoming 7 / Drafts 4 /
Past 18). Works correctly.

**UI-23 (P2)** — event titles in calendar cells truncate to about eight characters
("Career Pa…", "Family Da…", "Homeco…") with **no `title` or `aria-label`**, so the full
name is unrecoverable without opening the event. A `title` attribute is a one-line fix.

## Director -> Giving

Clean, and it settles UI-18: this screen is where "4 active causes" is canonical, and
the member-facing page now agrees with it after the fix.

## Super admin console

A genuinely different and well-judged visual language from the camp app — monochrome and
dense where the member app is navy and airy. The separation reads as deliberate and makes
it obvious which system you are in. The Control Room hero, safety disclosure, operations
guide and prompt suggestions form a clear hierarchy.

**UI-24 (P2) — mixed vocabulary in one view.** The nav says **Camps**, the page heading
says **Tenants**, the section below says **Tenant List**, and the body copy says "camp
tenants", "demo camps" and "client camps". "Tenant" is internal jargon; a director-facing
console should pick one word.

**UI-25 (P2) — the console opens on three zeros.** Clients 0, Members 0, Directors 0,
with "3 demo camps besides" as small print. All three staging tenants are demo tenants and
the default "Showing: Clients" filter hides them, so the first thing a super admin sees is
an empty platform. The filter state should be louder than the zeros, or the default should
include demos.

**UI-26 (P2) — super admin sign-in is visually unbalanced.** Centered heading and
subheading over left-aligned ~225px inputs inside a ~770px card. The form neither fills
nor centres in its container.

**UI-27 (P2) — orphan cell in the stat grid.** Three stat cards in a two-column grid leave
Directors alone on the second row beside an empty cell.

---

# Design review

Judged across every screen visited, at desktop, tablet and 375px.

## What is working

- **One card shell everywhere.** Rounded container, hairline border, generous padding,
  consistent radius. It carries home, search, events, giving, admin and profile without
  looking repetitive.
- **A consistent page-header pattern**: small uppercase eyebrow, large title, one line of
  plain-language description. It appears on nearly every screen and does real work.
- **Tab bars with live counts** ("Upcoming 7", "Everyone 3005") — a small thing that makes
  the product feel accountable to its own data.
- **Overflow is handled properly.** Wide tab rows scroll inside their own container rather
  than pushing the page sideways; there is no horizontal body overflow at 375px anywhere
  I looked.
- **Empty states are designed, not defaults** — icon, heading, explanation, and usually a
  next action. Family Trees, Newsletter, DMs and search all have real ones.
- **Copy is plain.** "What needs you, and how your network is doing." "Everyone connected
  to your camp, from prospects through to active members." Very little jargon outside the
  super admin console.
- **Forms are properly labelled.** Edit Profile is 17/17 inputs with real labels.

## Where it is uneven

- **Truncation is used where a tooltip is needed** — calendar titles (UI-23), and the
  header camp name ("Camp Cedar Alumni Network — Loc…") at narrower widths.
- **A few counts still describe different sets under the same word.** Fixed in Giving and
  the member surfaces; still worth a sweep as a principle: if two numbers on one screen
  can disagree, label what each counts.
- **Vocabulary drifts at the platform layer** (UI-24) in a way it does not in the camp app.
- **Tablet is the weak breakpoint.** The Media Stream header collapses to a 134px text
  column at 749px (UI-20) — desktop and mobile are both better handled than the middle.
- **Two conventions for "an action among attributes"** — the profile Message button reads
  as a third metadata pill (UI-13). Markup is correct; only the visual weight misleads.

## Not a defect

The app renders its light theme regardless of `prefers-color-scheme`. There is no dark
theme. Given the brand is built on a pale forest photograph and navy, committing to one
theme is a reasonable choice — but it should be a decision, not an accident.

---

# Round 6 — final fixes

## Fixed

**UI-20 — Media Stream header collapsed at tablet width.** Root cause found by
measurement: the `max-width: 980px` block sets `.ps-header-right { width: 100% }`,
expecting it to drop onto its own line, but the parent `.ps-page-header` is
`flex-wrap: nowrap`. Both children fought for one row and the text column collapsed.
Adding `flex-wrap: wrap` to the header in that media query fixes it.

Measured before: description **134px wide x 132px tall**. After: **699 x 38**, two clean
lines with Sort/Upload on their own row.

**UI-24 — Super admin vocabulary.** The nav says "Camps" and the body copy says camps;
only the headings said "Tenants" / "Tenant List". Now "Camps" / "All camps".
(`Active Tenants` and `Inactive Tenants` on other console screens are left alone — that
is a wider copy decision, not an inconsistency inside one view.)

**UI-27 — Orphan stat card.** Three cards in the two-column tablet grid left the third
stranded. An odd final card now spans the row.

## Withdrawn — not defects

**UI-23 — Calendar titles ~~have no tooltip~~.** They already do:
`title={`${event.title} — ${formatTime(event.startsAt)}`}` on every chip. My check looked
for "…" in `textContent`, but CSS `text-overflow: ellipsis` does not put it there, so the
check found nothing and I read that as "no title attribute". Eighth false finding, and the
third caused by a bad measurement rather than bad data.

**UI-25 — Super admin ~~opens on three uninformative zeros~~.** Downgraded. The zeros are
correct for the default "Clients" filter, and the page already explains itself twice: the
Clients card reads "3 demo camps besides", and the list subtitle reads "0 client camps.
3 demo camps hidden — switch Showing to see them." That is good copy. Only the visual
weight of three large zeros is arguable, and that is a judgement call, not a defect.

Both suites green: API 56/56 (400 tests), web 38/38 (246 tests).

---

# What would make this better

Not more findings — the shape of the problems is more useful than the list.

## 1. Two invisible ceilings, and only one is now guarded

Everything serious in this review came from one of two limits that degrade silently
instead of failing:

| Ceiling | Symptom | Guarded now? |
|---|---|---|
| PostgREST returns max 1,000 rows | totals quietly wrong | Partly — `find()` warns when a limitless query is short |
| PostgREST URL length (~16 KB) | 400 on large `.in()` lists | No — `chunkForInClause` fixes today's callers only |

The `find()` warning is the useful pattern: it makes the failure *say something*. The
same move is available for the second ceiling and would be stronger than a helper — chunk
`$in` **inside the factory's `applyFilter`**, so no call site can get it wrong. Right now
the next `.in()` someone writes will rediscover this the same way.

The strongest version of both: make `find()` **require** an explicit `limit`, and have
`findAll()` be the only way to say "all of it". That converts a silent wrong answer into a
compile-time-ish decision at every call site.

## 2. A total should be impossible to compute by accident

`services/alumniTotals.js` already says this, and its docstring describes this exact drift
happening once before. It recurred because using the helper is optional — every surface
that wrote `rows.length` got a plausible number and no warning.

Worth considering: a lint rule against `.length` on a model result used as a displayed
total, or simply routing every count through that module and reviewing anything that
doesn't. The rule matters more than the current fixes, which only cover the paths I
happened to open.

## 3. Staging just paid for itself — keep it at production scale

The 1,000-row cap, the email audience truncation, and the URL ceiling were all invisible
at six profiles and obvious at three thousand. That is the entire argument for the seed.

The cheapest high-yield check to automate: **assert that the surfaces agree**. One test
that fetches `/search/facets`, `/home/bootstrap`, `/map/cities`, `/admin/people` and the
email preview for one tenant and asserts the member totals match would have caught four of
these in CI, without anyone opening a browser.

## 4. Tablet is the weak breakpoint

Both layout defects lived between 749px and 980px — desktop and mobile are visibly better
cared for. Whatever visual checking exists should include one tablet width.

## 5. On this review's own accuracy

Twenty-seven findings raised, **eight withdrawn**. Five came from the review seed diverging
from real tenant data (non-hex ids, roles outside the configured vocabulary), three from
my own bad measurements (scroll position, ellipsis detection, an unquoted URL test that
disguised the real cause).

The findings that survived were the ones where I compared a number in the UI against the
database. That check is cheap, mechanical, and was right every time. The ones that failed
were where I judged from a screenshot. Worth weighting accordingly when reading anything
above — and worth building rule 3 out of.

---

# Round 7 — director functionality, end to end

All 29 director read endpoints return 200. Write flows exercised on staging with
`EMAIL_MODE=mock`: invite preview and send, email draft create/edit/delete, test send,
CSV export, notification audience preview.

## The find() warning earned its keep immediately

Hitting the admin endpoints printed this, unprompted, for code I had never opened:

    [db] profiles.find() returned 1000 of 3003 rows with no limit — silently truncated.
    [db] users.find() returned 1000 of 3003 rows with no limit — silently truncated.

A scan then found **108 `Model.find()` calls with no explicit limit** across the API.
Most are bounded in practice by an `$in` list or a small table. Five were whole-tenant
reads with real consequences, four of which are now fixed:

| Where | Consequence | Status |
|---|---|---|
| `csvImport.js` dedupe maps | members past #1,000 look new, so an import **creates duplicates** instead of updating them | fixed |
| `mobileNotifications.js` `resolveAudienceUserIds` | push to "all active members" reaches at most 1,000 | fixed |
| `legacyCedarCompat.js` `resolveNetworkRecipientEmails` | the **newsletter** reaches at most 1,000 | fixed |
| `analytics.js` average completion | "Profiles filled in" averaged the first 1,000 and reported it as the network figure | fixed |
| `admin.js` `GET /profiles` | reports `total: 1000` for 3,003 | **left alone** |

`GET /admin/profiles` is left deliberately: it returns every profile to the client and is
already a 765 KB response, so `findAll()` would make it 2.3 MB. It needs pagination, which
changes its contract with `TenantAdminPage.jsx` — a bigger change than belongs in this pass.

The csvImport one is the most serious of the four. It is silent, it corrupts data rather
than just displaying a wrong number, and it only appears once a camp passes 1,000 members.

## UI-28 — Invite preview counted malformed addresses as duplicates — P1, FIXED

**Where:** Director -> People -> Add people, and `POST /admin/invites/preview`

Pasting `newperson1@…, member0001@…, not-an-email, bad@@example, another.good@…,
newperson1@…` returned:

    validInputCount 6   duplicateInputCount 3   invalidCount 0   excludedRows []

`invalidCount` only ever counted errors from an uploaded **CSV**. Addresses typed or
pasted into the box were never validated: `mergeInviteRows()` drops anything that is not
an address, and the shortfall was reported as `validInputCount - uniqueCount`, i.e. as
duplicates. A director pasting a list from a spreadsheet saw "3 duplicates, 0 invalid"
and never learned which addresses had been dropped or why.

Now:

    validInputCount 4   duplicateInputCount 1   invalidCount 2
    excludedRows [("not-an-email","INVALID_EMAIL"), ("bad@@example","INVALID_EMAIL")]

## Verified working

- **People CSV export returns 3,006 lines** — 3,005 people plus a header. This was the
  time-sensitive question from the first review, and the export is not truncated.
- **Notification audience** reports 2,874 recipients, matching active members (it would
  have been 1,000 before the fix above).
- **Invite send** created the invite with a seven-day expiry and reported
  `attemptedCount 1, createdCount 1, sentCount 1`.
- **Email test send is correctly blocked** with `EMAIL_COMPLIANCE_BLOCKED` — "Complete the
  camp mailing address in Billing before sending" — which is the right guard to have, not
  a defect.

API suite: 56/56 suites, 400/400 tests.

---

# Fix status — round 4 (2026-09-06)

The last three P2s from the first review. One of them needed no work.

## UI-20 — Media Stream header ~~collapses at tablet width~~ — ALREADY FIXED

Measured on staging at 749px, the width the finding named: the description is
**699px wide by 38px tall**, and the Sort/Upload controls sit on their own row
below it. Checked again at 900, 979 and 1000px — never collapses, never shares a
row.

The `flex-wrap: wrap` that fixes it is in `photo-stream.css` inside
`@media (max-width: 980px)`, which covers 749px. It landed in an earlier round
and this document's "Still open" list was stale. No change made.

## UI-07 — Inconsistent name styling in result cards — FIXED

The original note ("one member name rendered underlined while all others were
not") was the cursor: `.as2-name:hover` and `.sr-name:hover` both underline, so
whichever name the pointer was over looked different from its neighbours. That
part is working as designed.

Looking properly turned up a real inconsistency underneath it, across surfaces
rather than within one list. A member's name links to their profile in four
places, and hovering it did four different things:

| | hover |
| --- | --- |
| `.as2-name` — Advanced Search result | underline |
| `.sr-name` — Search Results | underline |
| `.ps-name` — Media Stream author | nothing (only the shared 0.92 opacity) |
| `.p1-suggest-name`, `.activity-target` — chips | colour + background + shadow |

`.ps-name` had no hover rule at all outside a `@media (max-width: 640px)` block,
where it explicitly set `text-decoration: none` — so on the desktop screens where
hover actually happens, the same element behaved differently depending on which
page you met it on.

`.ps-name` now underlines on hover like the other two name links, and the
narrow-screen block no longer contradicts it. The two chip-shaped ones keep their
background treatment: they are a different component, not a bare text link.

Verified live: hovering "Maya Rossi" on Media Stream reports
`textDecorationLine: "underline"`.

## UI-08 — "Complete Your Profile" modal appears over unloaded content — FIXED

The `stats` gate added in an earlier round removed most of this but not all of it.
Measured on staging before the change:

    t=3874ms  prompt appears, 4 skeletons still on screen
    t=4663ms  skeletons clear

The bootstrap payload sets `stats`, but the two side cards fetch for themselves
and finish later, so the dialog still opened over roughly 800ms of skeletons.

Each preview card now reports when it has settled — including when its request
fails, so a broken card cannot hold the prompt shut forever — and the prompt waits
for both.

Tracked by name rather than counted. `RelatedProfilesCard` settles once on the
no-user-yet path and again when the profile arrives, so a counter reached two from
that card alone and the gate opened with the other still loading. The test caught
that; the first version of this fix was wrong.

Measured after:

    t=3950ms  skeletons clear
    t=4394ms  prompt appears, 0 skeletons

## Still open from the original list

Nothing. UI-01 through UI-21 are now fixed, withdrawn, or — for UI-20 — were
already fixed before this round.
