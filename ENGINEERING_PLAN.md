# PondBridge Platform - Engineering Plan

**Author:** System Architect (Deep Codebase Audit)
**Date:** March 2, 2026
**Priority:** CRITICAL - Must be completed before onboarding additional live camps
**Audience:** Lead Engineer

---

## Table of Contents

1. [Zero-Downtime Deployment & Data Safety](#1-zero-downtime-deployment--data-safety)
2. [Session Persistence & 10-Minute Logout Fix](#2-session-persistence--10-minute-logout-fix)
3. [Super Admin Test/Demo Camp Network](#3-super-admin-testdemo-camp-network)
4. [System Health - Full Audit Findings & Fixes](#4-system-health---full-audit-findings--fixes)

---

## 1. Zero-Downtime Deployment & Data Safety

### Current State

The platform currently uses:
- **Render.com** for API (`render.yaml` - Node.js starter plan, auto-deploy enabled)
- **Vercel/Cloudflare Pages** for frontend (`vercel.json`)
- **Supabase** (hosted PostgreSQL) for the database
- **No CI/CD pipeline** - no `.github/workflows/` directory exists

### Risk Assessment: Can a deploy delete camp data?

**Short answer: Very unlikely under current architecture, but gaps exist.**

**What's safe:**
- Database lives in Supabase (external hosted service) - code deploys to Render/Vercel do NOT touch the database
- No `postinstall` hooks or migration scripts run automatically on deploy
- Schema application (`applySupabaseSchema.js`) is manual-only via `npm run supabase:apply-schema`
- The DB reset function (`supabaseDocumentModel.js:50-75`) has 4 safety layers: `NODE_ENV=test`, `PONDBRIDGE_ALLOW_DB_RESET=1`, `PONDBRIDGE_TEST_RESET_ACK=1`, and a DB marker check for localhost

**What's NOT safe:**
- Auto-deploy is enabled on Render - every push to main deploys immediately with no approval gate
- No staging environment exists - changes go straight to production
- No automated tests run before deploy
- No database backup automation before deploys
- Environment variable confusion risk: root `.env` vs `apps/api/.env` loading order in `apps/api/src/config/env.js:7-16` could theoretically point to wrong DB if misconfigured

### Required Changes

#### 1.1 - Implement CI/CD Pipeline with Deployment Gates

Create `.github/workflows/deploy.yml`:

```
Trigger: push to main
Steps:
  1. Install dependencies
  2. Run linter (npm run lint)
  3. Run API test suite (npm test --workspace @pondbridge/api)
  4. Run db:preflight check against production schema
  5. Build frontend (npm run build --workspace @pondbridge/web)
  6. IF all pass → deploy to Render (API) and Cloudflare Pages (web)
  7. IF any fail → block deploy, notify via Slack/email
```

**Key files to create/modify:**
- `/.github/workflows/deploy.yml` (new)
- `/.github/workflows/preflight.yml` (new - runs on PR)

#### 1.2 - Add Staging Environment

Create a separate Supabase project for staging:

- New Supabase project: `pondbridge-staging`
- New Render service: `pondbridge-api-staging` (deploy from `staging` branch)
- New Cloudflare Pages project: `pondbridge-staging` (deploy from `staging` branch)
- Git workflow: `feature/* → staging → main`

**Configuration:**
- `render-staging.yaml` (new) - identical to `render.yaml` but with staging env vars
- Staging environment variables point to staging Supabase, separate Clerk dev instance, separate Stripe test keys

#### 1.3 - Automated Database Backups Before Deploy

**Option A (Recommended):** Use Supabase's built-in daily backups (Pro plan includes point-in-time recovery)

**Option B:** Pre-deploy backup script:

```bash
# scripts/backup-before-deploy.sh
pg_dump $SUPABASE_DB_URL --format=custom --file="backups/pre-deploy-$(date +%Y%m%d-%H%M%S).dump"
```

Add to CI pipeline as Step 0 before any deploy.

#### 1.4 - Disable Auto-Deploy on Render

**File:** `render.yaml`
**Change:** Line with auto-deploy setting

```yaml
# Change from:
# (implicitly auto-deploy: true)
# To:
autoDeploy: false
```

Deploys should only happen through the CI/CD pipeline after all checks pass.

#### 1.5 - Environment Variable Safety

**File:** `apps/api/src/config/env.js`

Add a startup assertion that prevents production from running with test/local DB URLs:

```javascript
// Add after env loading (around line 20):
if (process.env.NODE_ENV === 'production') {
  const dbUrl = process.env.SUPABASE_DB_URL || '';
  if (dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1')) {
    throw new Error('FATAL: Production server configured with localhost database URL');
  }
}
```

#### 1.6 - Protect Dangerous Scripts

**File:** `apps/api/scripts/seed.js`

The seed script already has a production guard (`PONDBRIDGE_ALLOW_PROD_SEED` flag at line 68), which is good. Additionally:

- Add a confirmation prompt when `NODE_ENV=production` even with the flag set
- Log all seed operations to audit table
- Never include seed script in production Docker image:

**File:** `Dockerfile.api` - add exclusion:
```dockerfile
# Add to .dockerignore:
apps/api/scripts/seed.js
apps/api/scripts/applySupabaseSchema.js
```

---

## 2. Session Persistence & 10-Minute Logout Fix

### Root Cause Analysis

After a thorough audit of the auth system, there are **multiple factors** likely contributing to camp users being logged out every ~10 minutes:

#### Factor 1: Idle Timeout Configuration

**File:** `apps/web/src/context/AuthContext.jsx:15-22`

```javascript
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 30);
```

- Default is 30 minutes of inactivity, not 10
- However, `VITE_AUTO_LOGOUT_MINUTES` is a **build-time** variable (Vite embeds it at build)
- If this was ever set to `10` in ANY `.env` file during a build, that value is baked into the production bundle
- **CHECK:** Inspect the deployed production JS bundle for the actual embedded value

**The idle logout hook** (`useIdleLogout` at lines 106-150) resets on: `mousemove`, `mousedown`, `keydown`, `scroll`, `touchstart`, and `visibilitychange`. If the user is reading content without interacting (very common on alumni directory pages), the timer does NOT reset.

#### Factor 2: Clerk Session Token Lifetime

**Clerk's default session token lifetime is 60 seconds.** The short-lived JWT is refreshed by the Clerk SDK automatically, but:

- Token sync runs every 45 seconds (`CLERK_TOKEN_SYNC_INTERVAL_MS = 45 * 1000` at line 23)
- If the Clerk SDK's internal session (the long-lived session, not the JWT) expires, the short-lived tokens stop being issued
- **Clerk's default session lifetime is configurable in the Clerk Dashboard** under Sessions → Session lifetime
- **CHECK:** Verify the session lifetime setting in the Clerk dashboard - if set to 10 minutes, this is your culprit

#### Factor 3: Token is Volatile (Lost on Refresh)

**File:** `apps/web/src/context/AuthContext.jsx:302-308`

```javascript
const [token, setToken] = useState("");  // Volatile - lives only in React state
const tokenRef = useRef("");             // Also volatile
```

The token is stored in React state and a ref - both are lost on page refresh. The user object is cached in localStorage, but the actual auth token is not. On every page refresh:

1. Token is empty
2. `sessionRefreshing` starts as `true` (line 304)
3. Bootstrap effect fires, calls `resolveBootstrapToken()` which retries up to 4 times
4. If Clerk SDK isn't loaded fast enough, bootstrap can fail
5. If Clerk session has expired, `getToken()` returns null, and user gets logged out

#### Factor 4: Tab Close / New Tab Behavior

**File:** `apps/web/src/context/AuthContext.jsx:26-30`

```javascript
const FORCE_RELOGIN_ON_TAB_CLOSE = !["0", "false", "off", "no"].includes(
  String(import.meta.env.VITE_FORCE_LOGOUT_ON_TAB_CLOSE || "false")
    .trim()
    .toLowerCase()
);
```

Default is `false` (don't force relogin on tab close), but if `VITE_FORCE_LOGOUT_ON_TAB_CLOSE` is set to anything truthy in the build environment, users will be logged out when they close/reopen a tab.

#### Factor 5: 401/403 Response Handling

**File:** `apps/web/src/context/AuthContext.jsx:410-421`

When the backend returns 401 or 403 (e.g., because a Clerk JWT expired between the 45-second sync intervals):

```javascript
if (error?.status === 401 || error?.status === 403) {
  if (hasExistingUser && isSignedIn) {
    writeAuthToStorage(clerkToken, userRef.current);
    markTabSessionAuthenticated();
    return null;  // ← Swallows the error, keeps cached user
  }
  clearLocalAuth();  // ← Logs out user
  clearTabSessionAuthenticated();
  clearTabLoginIntent();
  return null;
}
```

If `isSignedIn` is momentarily `false` during Clerk SDK reloading (e.g., after a network hiccup), the user gets fully logged out.

### Required Changes

#### 2.1 - Increase and Verify Idle Timeout

**File:** `apps/web/src/context/AuthContext.jsx`

Change the default idle timeout to 60 minutes (matching the 1 hour requirement):

```javascript
// Line 18 - Change from:
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 30);
// To:
const AUTO_LOGOUT_MINUTES = Number(import.meta.env.VITE_AUTO_LOGOUT_MINUTES || 60);
```

Also explicitly set in the production web `.env`:
```
VITE_AUTO_LOGOUT_MINUTES=60
```

**IMPORTANT:** This must be set BEFORE building and deploying. Vite bakes env vars at build time.

#### 2.2 - Configure Clerk Session Lifetime

In the **Clerk Dashboard** (dashboard.clerk.com):

1. Navigate to **Sessions** settings
2. Set **Session lifetime** to `3600` seconds (1 hour) minimum
3. Set **Inactivity timeout** to `3600` seconds (1 hour)
4. Ensure **Multi-session handling** is set to "Allow multiple sessions"

This is the most likely cause of the 10-minute logouts if Clerk's session lifetime was set to a short value.

#### 2.3 - Persist Token to sessionStorage

**File:** `apps/web/src/context/AuthContext.jsx`

The token should survive page refreshes within the same browser session. Change token storage from volatile state to sessionStorage-backed state:

```javascript
// In ClerkBackedAuthProvider (around line 302):
// Instead of:
const [token, setToken] = useState("");

// Use sessionStorage-backed initial state:
const [token, setToken] = useState(() => {
  try {
    return sessionStorage.getItem('pondbridgeAuthToken') || "";
  } catch { return ""; }
});

// Add effect to sync token to sessionStorage:
useEffect(() => {
  try {
    if (token) {
      sessionStorage.setItem('pondbridgeAuthToken', token);
    } else {
      sessionStorage.removeItem('pondbridgeAuthToken');
    }
  } catch { /* ignore */ }
}, [token]);
```

And clear it on logout in `clearLocalAuth()`:
```javascript
const clearLocalAuth = useCallback(() => {
  setToken("");
  setUser(null);
  clearAuthStorage();
  clearTabSessionAuthenticated();
  try { sessionStorage.removeItem('pondbridgeAuthToken'); } catch {}
  bootstrappedSessionIdRef.current = "";
  pendingBootstrapRetriesRef.current = 0;
}, []);
```

#### 2.4 - Add Pre-emptive Token Refresh

**File:** `apps/web/src/context/AuthContext.jsx`

Instead of only refreshing on a fixed 45-second interval, also refresh BEFORE the token expires:

```javascript
// In the token sync effect (around line 444):
// Add: decode the JWT to check expiry, refresh 30 seconds before it expires

const syncToken = async (forceRefresh = false) => {
  try {
    const currentToken = tokenRef.current;
    if (currentToken && !forceRefresh) {
      // Check if token expires within 30 seconds
      try {
        const payload = JSON.parse(atob(currentToken.split('.')[1]));
        const expiresAt = (payload.exp || 0) * 1000;
        const refreshThreshold = 30 * 1000; // 30 seconds before expiry
        if (Date.now() < expiresAt - refreshThreshold) {
          return; // Token is still fresh, skip refresh
        }
      } catch { /* proceed with refresh if decode fails */ }
    }
    await getAuthToken({ forceRefresh: true });
  } catch {
    // Ignore token refresh failures
  }
};
```

#### 2.5 - Graceful Degradation on 401 During Refresh

**File:** `apps/web/src/context/AuthContext.jsx`

Don't immediately logout on 401 - retry once with a fresh token first:

```javascript
// In refreshSession catch block (around line 410):
if (error?.status === 401 || error?.status === 403) {
  // Before clearing auth, try one more time with a force-refreshed token
  if (!retried) {
    try {
      const freshToken = await getAuthToken({ forceRefresh: true });
      if (freshToken) {
        // Retry the session call once
        const retryPayload = await requestJson("/api/auth/session", {
          token: freshToken,
          headers: tenantSlug ? { "X-Tenant-Slug": tenantSlug } : {}
        });
        // If retry succeeds, update state normally
        const normalizedUser = normalizeUserShape(retryPayload?.user);
        setUser(normalizedUser);
        writeAuthToStorage(freshToken, normalizedUser);
        return retryPayload;
      }
    } catch { /* fall through to existing logic */ }
  }
  // ... existing 401 handling ...
}
```

#### 2.6 - Add Session Health Indicator

**New component suggestion:** Add a non-intrusive session health indicator that warns users before their session expires, rather than abruptly logging them out.

```
- Show a toast/banner 5 minutes before idle timeout: "Your session will expire in 5 minutes due to inactivity. Move your mouse or press a key to stay logged in."
- On session expiry, show a modal with "Session Expired - Click to log back in" instead of silently redirecting to login page
```

**Implementation location:** `apps/web/src/context/AuthContext.jsx` - add a `sessionWarning` state that triggers at `AUTO_LOGOUT_TIMEOUT_MS - (5 * 60 * 1000)`.

---

## 3. Super Admin Test/Demo Camp Network

### Current State

- Super admin can create tenants via `POST /api/super/tenants` (super.js:848-989)
- Test tenants are auto-detected by slug/name pattern: `/(^|[-_.\s])(test\d*|sandbox|qa|staging|dev|demo)([-_.\s]|$)/i` (super.js:64-65)
- Hidden from super console by default (must use `includeHidden: true`)
- **NO mechanism exists to create fake profiles without real user accounts** - the `profiles` table has a `NOT NULL` constraint on `user_id` and a trigger (`trigger_enforce_profile_user_tenant_consistency`) that validates the user exists in the same tenant

### Architecture for Test/Demo Network

#### 3.1 - Create Dedicated Test Tenant

Use the existing super admin tenant creation endpoint to create a permanent test camp:

```
POST /api/super/tenants
{
  "name": "PondBridge Demo Camp",
  "slug": "demo",
  "planTier": "base"
}
```

This tenant will:
- Be auto-hidden from the super console (slug matches "demo" pattern)
- Be fully isolated from real camp data (tenant-scoped RLS)
- Be available for testing all features end-to-end

#### 3.2 - Seed Script for Demo Camp

**New file:** `apps/api/scripts/seedDemoCamp.js`

Create a dedicated seed script that populates the demo camp with realistic test data:

```javascript
// Seed script responsibilities:
// 1. Create or find the "demo" tenant
// 2. Create 20-30 fake users with fake Clerk-compatible identities
// 3. Create full profiles with realistic data (names, locations, jobs, schools)
// 4. Create sample conversations, forum posts, photos
// 5. Create sample family tree connections
// 6. Create sample newsletters and email broadcasts
// 7. Mark all profiles as 80-100% complete

// Safety: Only runs against tenants matching HIDDEN_TENANT_PATTERN
// Idempotent: Can be re-run without duplicating data
```

**Fake user generation approach:**
- Use a fixed set of deterministic fake identities (not random) so they're reproducible
- Each fake user gets a real `user` row in the database (required by FK constraint)
- Users get a special marker: `metadata.isTestUser: true` or a dedicated flag
- Clerk user IDs can use a prefix like `demo_user_` to distinguish from real users
- Email format: `{firstname}.{lastname}@demo.pondbridge.local`

**Package.json addition:**
```json
"seed:demo": "node scripts/seedDemoCamp.js"
```

#### 3.3 - Demo Camp Reset Endpoint

**File:** `apps/api/src/routes/super.js`

Add a new endpoint that resets ONLY the demo camp data back to its seeded state:

```
POST /api/super/tenants/:tenantId/reset-demo
```

**Requirements:**
- Only works on tenants matching `HIDDEN_TENANT_PATTERN`
- Requires `super_admin` role
- Deletes all tenant data (using existing `TENANT_PURGE_STEPS` cascade)
- Re-seeds the demo data
- Does NOT require the triple-confirmation of hard-delete (since it's re-creating, not destroying)
- Logs to audit table

#### 3.4 - Fake Profile Generation Without Real Accounts

The database enforces that every profile must have a `user_id`. To create "fake" profiles for the demo camp, you must create corresponding user records. Here's the approach:

**Option A (Recommended): Internal-only users with no Clerk account**

Create users with `auth_provider: "internal"` or `auth_provider: "demo"`:
- These users exist in the `users` table with valid IDs
- They have NO Clerk account (no `clerk_user_id`)
- They cannot log in (no auth credentials)
- Their profiles appear in the directory, search, map, etc.
- They are identified by a metadata flag or a naming convention

**Required changes:**

1. **Schema:** No changes needed - `clerk_user_id` is already nullable in the users table
2. **Identity service (`identityUsers.js`):** Add a `createDemoUser()` function that creates a user without Clerk identity:

```javascript
export async function createDemoUser({ tenantId, email, firstName, lastName }) {
  const user = await UserModel.create({
    tenantId,
    email,
    roles: ["user"],
    status: "active",
    metadata: { isDemoUser: true }
  });
  await ensureProfileForUser({ tenantId, user, identity: { firstName, lastName, email } });
  return user;
}
```

3. **Profile completion (`profileCompletion.js`):** No changes needed - `ensureProfileForUser` already works with any user object
4. **Search/directory:** No changes needed - profiles are queried by `tenant_id`, not by auth status
5. **Login guards:** Add check to prevent demo users from logging in:

```javascript
// In requireAuth middleware:
if (user.metadata?.isDemoUser) {
  return res.status(403).json({ error: { code: "DEMO_ACCOUNT", message: "Demo accounts cannot authenticate" } });
}
```

#### 3.5 - Feature Flag System for Test Camp

Add a lightweight feature flag system so new features can be tested on the demo camp before rolling out:

**File:** `apps/api/src/config/env.js`

```javascript
// New env var:
FEATURE_FLAG_TENANTS: JSON string mapping feature names to tenant IDs
// Example: {"new_search_v2": ["demo"], "ai_profiles": ["demo", "test1"]}
```

**File:** New middleware `apps/api/src/middleware/featureFlag.js`

```javascript
export function requireFeature(featureName) {
  return (req, res, next) => {
    const flaggedTenants = getFeatureFlagTenants(featureName);
    if (flaggedTenants.includes(req.tenant?.slug) || flaggedTenants.includes('*')) {
      return next();
    }
    return res.status(404).json({ error: { code: "NOT_FOUND" } });
  };
}
```

This allows routes to be gated:
```javascript
router.get("/new-feature", requireFeature("new_search_v2"), handler);
```

#### 3.6 - Super Console Demo Controls

Add UI controls to the super admin console for managing the demo camp:

- "Reset Demo Camp" button (calls the reset endpoint)
- "Add N Fake Profiles" action
- "Generate Sample Content" action (forums, messages, photos)
- Toggle to show/hide demo camp in the camp list
- Visual badge on demo camps: `[DEMO]` or `[TEST]`

---

## 4. System Health - Full Audit Findings & Fixes

### Overall Grade: B+ (75/100)

The system is production-capable but has several areas that need attention to reach A+ status.

---

### 4.1 - CRITICAL: Security Issues

#### 4.1.1 - Credentials in Root `.env` File

**File:** `/.env` (root of pondbridge-platform)

The root `.env` contains live production credentials:
- Cloudflare API token
- Clerk secret key (`sk_live_...`)
- Stripe secret key (currently test key)
- R2 access keys
- Supabase service role key

**Action:**
- Verify `.env` is in `.gitignore` (it should be, but verify)
- Rotate any keys that may have been committed to git history
- Move secrets to a secrets manager (Render environment variables, Doppler, or 1Password CLI)
- Never store `sk_live_*` keys in files on developer machines

#### 4.1.2 - CORS Allows Missing Origin

**File:** `apps/api/src/config/cors.js:24`

The CORS configuration currently allows requests with no `Origin` header to pass. While this is necessary for some non-browser clients (like curl or server-to-server), it weakens CORS protection.

**Action:** Add explicit logic to only allow missing origin in non-production environments or for authenticated API-key-based requests.

#### 4.1.3 - Missing Rate Limit on Profile Updates

**File:** `apps/api/src/routes/profiles.js`

The `PUT /api/profiles/me` endpoint has no rate limiting, allowing unlimited profile update requests.

**Action:** Add rate limiting:
```javascript
const profileUpdateLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  message: { error: { code: "RATE_LIMITED", message: "Too many profile updates." } }
});
router.put("/me", profileUpdateLimiter, handler);
```

---

### 4.2 - HIGH: Error Handling Gaps

#### 4.2.1 - Empty Catch Blocks (15+ locations)

These silently swallow errors, making debugging impossible:

| File | Line(s) | Context |
|------|---------|---------|
| `AuthContext.jsx` | 98, 108 | Token failures |
| `http.js` | 146, 172 | Response parsing |
| `ChatAndForums.jsx` | Multiple | Socket/message operations |
| `EditProfile.jsx` | 909, 928 | Photo upload, save |

**Action:** Replace empty catches with proper error handling:
- Log to an error reporting service (Sentry recommended)
- Show user-facing error messages for UI operations
- At minimum, log errors with contextual information

#### 4.2.2 - No Error Reporting Service

**File:** `apps/web/src/components/ErrorBoundary.jsx:29`

The error boundary catches React errors but only `console.error`s them. In production, these are invisible.

**Action:** Integrate Sentry or similar:
```javascript
// In ErrorBoundary.jsx componentDidCatch:
Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
```

#### 4.2.3 - No Timeout on External API Calls

Calls to Resend (email), Stripe, Clerk, and OpenAI have no timeout configuration. A hung external service could block the API indefinitely.

**Action:** Add timeouts to all external HTTP clients:
```javascript
// For Resend, Stripe SDK, etc:
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 10000); // 10 second timeout
```

---

### 4.3 - HIGH: Frontend Robustness

#### 4.3.1 - Missing Error States in Key Pages

| Page | Issue |
|------|-------|
| `DirectoryPage.jsx` | No error state if profile search API fails |
| `ProfileViewPage.jsx` | No 404 handling if profile doesn't exist |
| `LocationMap.jsx` | Logs error on line 374 but continues with broken map |
| `ChatAndForums.jsx` | 15+ silent failures in click handlers |

**Action:** Add error state handling to each page:
```jsx
if (error) return <ErrorState message="Failed to load directory" onRetry={refetch} />;
if (!data && !loading) return <EmptyState message="No results found" />;
```

#### 4.3.2 - Untracked Async Operations

**File:** `apps/web/src/cedar/pages/EditProfile.jsx:500-600`

Photo autosave and profile save operations fire async but don't track completion. Users don't know if their changes saved.

**Action:**
- Add save indicators (spinning icon, "Saving...", "Saved" checkmark)
- Properly await async operations
- Show error toast if save fails

#### 4.3.3 - Memory Leak Risk in Socket.io

**File:** `apps/web/src/lib/socket.js`

Socket event listeners may not be fully cleaned up on component unmount.

**Action:** Audit all `socket.on()` calls and ensure corresponding `socket.off()` in cleanup functions.

---

### 4.4 - MEDIUM: Performance Issues

#### 4.4.1 - N+1 Query Pattern in Family Trees

**File:** `apps/api/src/routes/familyTrees.js`

Individual member fetches likely perform separate queries without batch loading.

**Action:** Implement batch fetching or eager loading for family tree queries.

#### 4.4.2 - Bundle Size (Map Library)

`maplibre-gl` (~250KB) is loaded on all routes even when the map isn't displayed.

**Action:** Lazy-load the map component:
```jsx
const LocationMap = React.lazy(() => import('./LocationMap'));
```

#### 4.4.3 - Profile Search Performance

**File:** `apps/api/src/db/models/ProfileModel.js:99-111`

Client-side fuzzy matching (trigram) runs in-memory for all results when RPC is unavailable. With large directories (1000+ profiles), this will be slow.

**Action:**
- Ensure the PostgreSQL `pg_trgm` extension and `search_profiles` RPC function are deployed
- Add proper database indexes on searchable fields
- Add pagination to search results

#### 4.4.4 - 225+ useEffect Hooks

The web app has a very high number of useEffect hooks. Many may have incorrect or missing dependency arrays, causing unnecessary re-renders.

**Action:** Run the `react-hooks/exhaustive-deps` ESLint rule across ALL files (currently cedar/ directory is excluded from linting - see `eslint.config.cjs:40-45`).

---

### 4.5 - MEDIUM: Code Quality

#### 4.5.1 - Console Statements in Production Code (~95 total)

Key locations to clean up:

| File | Count | Notes |
|------|-------|-------|
| `socketServer.js` | 8 | Debug logging for connections/disconnections |
| `EditProfile.jsx` | 4 | Error logging |
| `PhotoStream.jsx` | 3 | Upload debugging |
| `super.js` | 2 | Hard delete warnings |
| `admin.js` | 3 | Email send debugging |
| `clerkIdentity.js` | 1 | Token resolution |
| Various cedar pages | 18+ | Scattered console.error calls |

**Action:**
- Replace all `console.log` in API with structured logger (e.g., `pino` or `winston`)
- Replace all `console.error` in frontend with error reporting service calls
- Remove all debug `console.log` statements

#### 4.5.2 - Lint Coverage Gap

**File:** `eslint.config.cjs:40-45`

ESLint only runs on specific directories. The `cedar/pages` and `cedar/components` directories are excluded.

**Action:** Extend ESLint coverage to all source files:
```javascript
// In eslint.config.cjs:
files: ["apps/web/src/**/*.{js,jsx}"]  // Cover everything
```

#### 4.5.3 - No TypeScript

The entire codebase is plain JavaScript with no type safety. This increases the risk of runtime type errors, especially around API response shapes.

**Action (Long-term):** Consider gradual TypeScript adoption:
1. Start with `jsconfig.json` / `tsconfig.json` in checkJs mode
2. Add JSDoc type annotations to critical paths (auth, models, API routes)
3. Migrate new files to `.ts`/`.tsx`

---

### 4.6 - LOW: Testing Gaps

#### Current State:
- **API:** 81 test files exist covering access isolation, auth boundaries, search, resume security, and tenancy
- **Web:** **ZERO tests** - `package.json` says "No tests yet"
- **E2E:** None

#### Recommended Test Plan:

**Phase 1 (Immediate):**
- Add frontend unit tests for `AuthContext.jsx` (most critical component)
- Add frontend unit tests for `http.js` (request/response handling)
- Add integration tests for the login → session → protected route flow

**Phase 2 (Before scaling):**
- Add E2E tests with Playwright or Cypress for:
  - Camp director onboarding flow
  - Alumni join flow (open join + invite)
  - Profile creation and search
  - Super admin tenant management
- Target 50% API test coverage
- Target 30% frontend test coverage

**Phase 3 (Ongoing):**
- Require tests for all new features
- Add visual regression testing for UI components
- Add performance benchmarks for search and directory

---

### 4.7 - Database Health

#### 4.7.1 - Missing Index Audit

Run `npm run db:preflight` against production and review output. Key indexes to verify:

- `users(tenant_id)` - used in every tenant-scoped query
- `users(email)` - used in identity resolution
- `users(clerk_user_id)` - used in Clerk auth
- `profiles(tenant_id)` - used in directory/search
- `profiles(user_id)` - used in profile lookup
- `messages(conversation_id)` - used in chat
- `forum_posts(forum_id)` - used in forum display

#### 4.7.2 - Row-Level Security Verification

Run `npm run rls:audit` and verify all tenant-scoped tables have RLS policies enabled. The schema defines JWT-based RLS functions (`jwt_tenant_id()`, `jwt_roles()`) but coverage may be incomplete.

#### 4.7.3 - Foreign Key Cascade Behavior

Currently, no FK constraints have `ON DELETE CASCADE`. All cascading deletes are handled in application code (super.js `TENANT_PURGE_STEPS`). This means:

- If the application cascade misses a table, orphaned rows remain
- If a new table is added, the cascade must be manually updated

**Action:** Consider adding `ON DELETE CASCADE` to FK constraints for tenant-scoped tables, so database-level referential integrity handles cleanup automatically. This must be done carefully with a migration.

---

## Execution Priority

### Phase 1 - URGENT (Before next live camp onboard)
1. Fix session/logout issue (Section 2.1, 2.2, 2.3)
2. Verify .env is gitignored and secrets not in history (Section 4.1.1)
3. Set `autoDeploy: false` on Render (Section 1.4)
4. Run db:preflight and rls:audit (Section 4.7)

### Phase 2 - HIGH (Within 2 weeks)
5. Create CI/CD pipeline (Section 1.1)
6. Create staging environment (Section 1.2)
7. Create demo camp and seed script (Section 3.1, 3.2)
8. Fix empty catch blocks (Section 4.2.1)
9. Add error reporting (Sentry) (Section 4.2.2)

### Phase 3 - MEDIUM (Within 1 month)
10. Pre-emptive token refresh (Section 2.4)
11. Session health indicator (Section 2.6)
12. Demo camp reset endpoint (Section 3.3)
13. Feature flag system (Section 3.5)
14. Fix frontend error states (Section 4.3.1)
15. Remove console statements (Section 4.5.1)
16. Extend lint coverage (Section 4.5.2)

### Phase 4 - IMPROVEMENT (Ongoing)
17. Fake profile generation system (Section 3.4)
18. Super console demo controls (Section 3.6)
19. Lazy-load map component (Section 4.4.2)
20. Add frontend tests (Section 4.6)
21. Gradual TypeScript adoption (Section 4.5.3)
22. Database cascade migration (Section 4.7.3)

---

## Summary

| Area | Current Grade | Target Grade | Key Blocker |
|------|--------------|--------------|-------------|
| Deployment Safety | B | A | No CI/CD, no staging, auto-deploy on |
| Session Management | C | A | Multiple factors causing premature logout |
| Test/Demo Infrastructure | D | B+ | No demo camp, no fake profiles, no feature flags |
| Security | A- | A+ | Credentials in .env, CORS gap, missing rate limits |
| Error Handling | B+ | A | Empty catches, no error reporting |
| Performance | B | A- | Bundle size, N+1 queries, missing indexes |
| Code Quality | C+ | B+ | Console statements, lint gaps, no types |
| Testing | C | B | Zero frontend tests |
| **Overall** | **B+** | **A** | **Session fix + CI/CD + demo camp** |
