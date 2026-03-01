# PondBridge Production Debug Plan

**Status**: Ready for implementation
**Created**: 2026-03-01
**Issues**: 3 critical bugs identified in production auth/routing flow

---

## Issue 1: Super Admin Can Log Into Camp Networks (Creates Unwanted Profile/User Records)

### Problem
When the super admin navigates to a camp's login page and signs in, the system creates a tenant-scoped user record AND profile for the super admin inside that camp. This inflates member counts and pollutes the camp's data.

### Root Cause Analysis

The problem lives in the **Clerk auth callback flow** at `apps/web/src/pages/TenantAuthCallbackPage.jsx`.

When a super admin (already signed into Clerk) navigates to a camp URL like `/t/cedar/login`, Clerk recognizes them as signed in. The `<SignIn>` component in `apps/web/src/cedar/pages/Login.jsx` redirects to `/t/cedar/auth/callback`. The callback page then:

1. Calls `GET /api/t/:slug/access/decision` (line 187-191 of TenantAuthCallbackPage.jsx)
2. The `buildAccessDecision()` function in `apps/api/src/routes/access.js` (line 281-416) checks if the identity has a membership via `findTenantUserForIdentity()`
3. If the super admin has NO membership in this camp, the decision returns `state: "not_member"` with `action: "join_network"` (for open camps)
4. The callback page then calls `POST /api/t/:slug/access/join` (line 231-234 of TenantAuthCallbackPage.jsx)
5. This creates a new User record AND Profile via `createTenantMembershipFromIdentity()` and `ensureProfileForUser()`

There IS a partial guard in `access.js` line 472-479 inside the `director-bootstrap` endpoint that checks for `super_admin` role and returns `SUPER_ADMIN_SESSION_REQUIRES_SIGN_OUT`, but this guard does NOT exist in:
- The `/access/decision` endpoint itself
- The `/access/join` endpoint
- The TenantAuthCallbackPage's `shouldBootstrapFromPrelaunchFallback` logic

Additionally, in `TenantScopeRoutes` (App.jsx line 192-203), the `alreadyScopedToTenant` check passes for super_admin without verifying they SHOULD be there - it just bypasses the scope check:
```js
const alreadyScopedToTenant = Boolean(
  user && ((tenantId && userTenantId && userTenantId === tenantId) ||
    (isSuperAdmin && !onDirectorBootstrapRoute))
);
```

### Fix Strategy

**A. Frontend: Block super admin from camp login/callback flows**

File: `apps/web/src/pages/TenantAuthCallbackPage.jsx`
- In `ClerkAuthCallbackPage`, after getting the session and before calling `/access/decision`, check if the current user is a super_admin (via refreshSession or the user object from AuthContext)
- If super_admin: redirect to `/super/tenants` with a flash message instead of proceeding with camp join flow
- Add check around lines 173-244: before any join/bootstrap action, verify the user is NOT a super_admin

File: `apps/web/src/cedar/pages/Login.jsx`
- In `ClerkLogin`, add a check: if the user from `useAuth()` has `super_admin` role and is already authenticated, show a warning message like "You're signed in as Super Admin. Super admin accounts cannot join camp networks. Sign out first or use a separate account." and provide a link back to `/super/tenants`
- This prevents the Clerk `<SignIn>` from auto-redirecting to callback

**B. Backend: Guard the access/join and access/decision endpoints**

File: `apps/api/src/routes/access.js`
- In `buildAccessDecision()` (line 281): Add a check at the top - if the identity resolves to a super_admin user (via `ensureGlobalSuperAdmin()`), return a special decision state like `state: "super_admin_blocked"` with `action: "use_super_console"` and `nextRoute: "/super/tenants"`
- In the `POST /join` handler (line 546): Add the same guard as `director-bootstrap` has (line 472-479) - if `req.user?.roles` includes `super_admin`, reject with 409
- In `POST /invite/accept` (line 763): Same guard - super admins should not accept invites to camps
- In `POST /director-bootstrap` (line 447): Guard already exists but verify it works correctly

File: `apps/api/src/middleware/requireAuth.js`
- The `requireAuth` middleware (line 129) should NOT create tenant-scoped memberships for super_admins when resolving their identity against a tenant. Currently at line 140-148, when a super admin hits a tenant-scoped endpoint, `ensureGlobalSuperAdmin` is called and finds the global user. This is correct behavior - the super admin should pass auth as a global user, not get a new tenant user created.

**C. Data Cleanup**
- After deploying fixes, write a one-time script to find and remove any User/Profile records in tenant-scoped tables where the user's email matches the super admin email AND there exists a corresponding global super_admin user with tenantId: null
- Check each camp's member count after cleanup

### Files to Modify
1. `apps/web/src/pages/TenantAuthCallbackPage.jsx` - Add super admin guard in callback flow
2. `apps/web/src/cedar/pages/Login.jsx` - Add super admin warning on camp login page
3. `apps/api/src/routes/access.js` - Add super admin guards in decision/join/invite endpoints
4. `apps/web/src/components/ProtectedRoute.jsx` - Consider: should super_admin accessing camp routes be treated differently?

---

## Issue 2: Glitching and Reloading When Loading Super Admin or Camp Pages

### Problem
When navigating to the super admin console or a camp page, there is visible flickering, multiple re-renders, and the page feels like it reloads multiple times before settling.

### Root Cause Analysis

There are **multiple cascading re-render triggers** in the auth/routing system:

**A. The `isRouting` state transition in App.jsx (lines 636-652)**

```js
useEffect(() => {
  setIsRouting(true);                    // FLASH 1: sets routing state
  window.clearTimeout(routeTimerRef.current);
  routeTimerRef.current = window.setTimeout(() => {
    setIsRouting(false);                 // FLASH 2: clears routing state after 220ms
  }, 220);
  ...
}, [location.pathname, location.search, location.hash]);
```

This causes a CSS class `is-routing` to toggle on/off the main shell div, which triggers a CSS transition on `.app-route-progress`. Every route change creates a 220ms "routing" animation. If there are multiple rapid route changes (which there are due to redirects), this stacks up and creates visual glitching.

**B. The ClerkBackedAuthProvider bootstrap effect (AuthContext.jsx lines 391-461)**

This effect has an extensive dependency array:
```js
[clearLocalAuth, isLoaded, isSignedIn, refreshSession, sessionId, token, user]
```

The problem: `refreshSession` updates `token` and `user`, which are in the dependency array, which re-triggers the effect. The `bootstrappedSessionIdRef` guard (line 421) prevents infinite loops, but the effect still re-runs multiple times during bootstrap:

1. **Run 1**: `isLoaded` becomes true -> triggers effect -> calls `bootstrapSession()`
2. `bootstrapSession()` calls `refreshSession()` which sets `token` and `user`
3. **Run 2**: `token` changed -> effect re-runs -> `bootstrappedSessionIdRef` check passes (already set) -> bails early
4. **Run 3**: `user` changed -> effect re-runs -> bails early again

Each of these runs causes React to re-render the entire auth tree, which cascades down to TenantScopeRoutes.

**C. TenantScopeRoutes membership sync effect (App.jsx lines 174-213)**

This effect calls `refreshSession({ tenantSlug: slug })` which again updates auth state. It has its own guard (`membershipSyncKeyRef`), but the first call still triggers an auth state update, which cascades.

**D. TenantScopeRoutes wrong-network check effect (App.jsx lines 215-262)**

This effect runs on EVERY render where auth state changes. It checks if user's tenantId matches the current tenant's id. During the bootstrap phase, `user` may be stale or partially loaded, which can cause a brief flash where the wrong-network state is momentarily triggered before the correct state arrives.

**E. TenantContext double-render (TenantContext.jsx)**

When `TenantProvider` mounts, it:
1. Sets `loading: true` (render 1 - shows "Loading your camp...")
2. Applies cached theme (may cause visual change)
3. Fetches tenant config
4. Sets tenant state (render 2 - shows actual content)

If there's a cached theme that differs from the fetched config, there's a visual shift.

**F. The `isReady` flag timing**

In `ClerkBackedAuthProvider` (line 500):
```js
isReady: Boolean(isLoaded) && !sessionRefreshing,
```

`sessionRefreshing` starts as `true` (line 300). It becomes `false` only after `refreshSession` completes. During this time, `ProtectedRoute` (line 14) returns `null`:
```js
if (!isReady && !hasResolvedUser) {
  return null;     // BLANK FLASH
}
```

And TenantScopeRoutes (line 294) shows "Checking your account...":
```js
if (!isReady && !hasResolvedUser) {
  return <section>...<h1>Checking your account...</h1>...</section>;
}
```

So the sequence on every page load is:
1. FLASH: "Loading your camp..." (TenantContext loading)
2. FLASH: "Checking your account..." (auth not ready)
3. FLASH: Actual page content
4. Possible FLASH: routing animation from `isRouting` CSS transition

### Fix Strategy

**A. Eliminate the 220ms routing animation or make it non-blocking**

File: `apps/web/src/App.jsx`
- Remove the `isRouting` state and the `app-route-progress` bar entirely, or
- Move it to a CSS-only approach that doesn't cause React re-renders (e.g., use CSS `navigation-timing` or a simple CSS animation triggered by a key prop)
- At minimum, reduce the 220ms timeout and ensure the opacity/transform transitions don't cause layout shifts

**B. Stabilize the ClerkBackedAuthProvider bootstrap effect**

File: `apps/web/src/context/AuthContext.jsx`
- Remove `token` and `user` from the dependency array of the bootstrap effect (lines 391-461). These are OUTPUT of the effect, not inputs. Use refs to track them instead.
- The dependency array should only be: `[clearLocalAuth, isLoaded, isSignedIn, sessionId]`
- The `refreshSession` callback should be called INSIDE the effect, not as a dependency. Use a ref to hold the latest `refreshSession` function.

**C. Debounce or batch the membership sync in TenantScopeRoutes**

File: `apps/web/src/App.jsx`
- The membership sync effect (lines 174-213) should wait for `isReady` before attempting to sync, to avoid racing with the bootstrap
- Add `isReady` to the early-return conditions: if `!isReady`, return early and let the bootstrap complete first
- This prevents the sync from triggering a SECOND `refreshSession` call while the first is still in flight

**D. Stabilize the wrong-network check**

File: `apps/web/src/App.jsx`
- The wrong-network effect (lines 215-262) should be gated behind `isReady && !membershipSyncInFlightRef.current`
- Currently it checks `membershipSyncInFlightRef.current` but this ref may not be set yet when the effect runs

**E. Prevent ProtectedRoute blank flash**

File: `apps/web/src/components/ProtectedRoute.jsx`
- Instead of returning `null` when not ready, show a minimal skeleton/spinner
- Or better: keep showing the previous content while auth refreshes (but this requires more complex state management)

**F. Cache auth state more aggressively**

File: `apps/web/src/context/AuthContext.jsx`
- On initial load, if there's a cached user in localStorage and a session marker in sessionStorage, render with the cached user IMMEDIATELY while the background refresh happens
- This eliminates the "Checking your account..." flash for returning users
- The current code partially does this (lines 181-184) but only in LegacyAuthProvider, not in ClerkBackedAuthProvider

### Files to Modify
1. `apps/web/src/App.jsx` - Fix routing animation, stabilize effects
2. `apps/web/src/context/AuthContext.jsx` - Fix dependency arrays, reduce re-renders
3. `apps/web/src/components/ProtectedRoute.jsx` - Eliminate blank flash

---

## Issue 3: Getting Bumped Back to Login Page After Successful Login

### Problem
Sometimes after logging in (either to super admin or to a camp), the user is redirected back to the login page despite having valid credentials.

### Root Cause Analysis

There are **multiple potential causes**, and they likely compound each other:

**A. Volatile token loss on page navigation**

File: `apps/web/src/lib/authMemory.js`
The auth token is stored in a module-level variable:
```js
let volatileAuthToken = "";
```

This is intentionally volatile - it's lost on page reload. The token is NOT in localStorage. The design relies on:
1. The `__session` cookie (set by `setAuthCookie` on login) to persist across page loads
2. A `refreshSession()` call on each page load to re-establish the token

**The problem**: If the `refreshSession()` call fails or returns before the cookie is sent, the user appears unauthenticated.

The `requestJson` function in `http.js` (line 80-158) DOES include `credentials: "include"` which sends cookies. But the flow is:
1. Page loads -> AuthContext bootstraps -> reads volatile token (empty after reload)
2. `isAuthenticated` = `Boolean(token || user?.id)` -> if both are empty, user appears unauthenticated
3. `ProtectedRoute` sees `isAuthenticated = false` -> redirects to login
4. RACE: `refreshSession()` is called asynchronously but `ProtectedRoute` has already redirected

**B. The `isReady` / `hasResolvedUser` race condition**

In `ProtectedRoute.jsx` (lines 14-20):
```js
if (!isReady && !hasResolvedUser) {
  return null;
}
if (!isAuthenticated) {
  return <Navigate to={loginPath} replace />;
}
```

There's a window where `isReady` is `true` but the user hasn't been resolved yet from the session refresh. If `isReady` becomes `true` before `user` is set (because the Clerk SDK loads fast but the backend session call is slow), then:
- `!isReady && !hasResolvedUser` = `false` (isReady is true)
- Falls through to `!isAuthenticated` check
- `isAuthenticated` = `Boolean(token || user?.id)` = `false` (both empty)
- Redirects to login

This race is especially likely in `ClerkBackedAuthProvider` where `isReady` is:
```js
isReady: Boolean(isLoaded) && !sessionRefreshing,
```

If `sessionRefreshing` briefly flickers to `false` before the session result updates `user`, there's a window.

**C. The `FORCE_RELOGIN_ON_TAB_CLOSE` flag with Clerk**

File: `apps/web/src/context/AuthContext.jsx` (lines 397-410)
```js
if (FORCE_RELOGIN_ON_TAB_CLOSE && !isSignedIn && !tabSessionExists && !loginIntentExists && !onAuthRoute) {
  clearLocalAuth();
  bootstrappedSessionIdRef.current = "";
  setSessionRefreshing(false);
  return;
}
```

In Clerk mode, `isSignedIn` depends on the Clerk SDK loading. There's a moment where `isLoaded = true` but `isSignedIn` hasn't resolved yet (it might be `undefined` or `false` temporarily). If `FORCE_RELOGIN_ON_TAB_CLOSE` is enabled and the session marker doesn't exist (new tab), this code path clears auth and sets `sessionRefreshing = false`, which makes `isReady = true` with no user, triggering the redirect.

**D. The wrong-network effect force-logout**

File: `apps/web/src/App.jsx` (lines 215-262)
This effect calls `logout()` and redirects to login if the user's tenantId doesn't match the current tenant. During the bootstrap phase, the user object may have stale tenantId data (from localStorage cache) that doesn't match the new tenant being loaded. This causes a premature logout.

The guard `if (wrongNetwork || ...)` (line 229) is supposed to prevent re-triggering, but the initial check can still fire.

**E. Cookie domain / path mismatch**

File: `apps/api/src/utils/authCookie.js`
If the `__session` cookie is set with a domain that doesn't match the subdomain being accessed (e.g., set for `pondbridgealumni.com` but accessed from `cedar.pondbridgealumni.com`), the cookie won't be sent with requests, and the `refreshSession()` call will fail with 401, which clears auth state and redirects to login.

**F. JWT expiration timing**

File: `apps/api/src/utils/auth.js`
If `JWT_EXPIRES_IN` is set too short, tokens may expire between the time they're issued and when the session refresh happens on the next page load. This would cause a 401 from the backend, which clears auth state.

### Fix Strategy

**A. Fix the ProtectedRoute race condition (HIGHEST PRIORITY)**

File: `apps/web/src/components/ProtectedRoute.jsx`
- Add a "session resolving" state: don't redirect to login until we're CERTAIN auth has been fully evaluated
- Proposed logic:
```jsx
// Don't make any routing decisions until auth is fully ready
if (!isReady) {
  return null; // or a loading spinner
}
// Only after isReady is true, check authentication
if (!isAuthenticated) {
  return <Navigate to={loginPath} replace />;
}
```
- Remove the `hasResolvedUser` bypass - it's creating a race where we render before auth is settled

**B. Fix the ClerkBackedAuthProvider `sessionRefreshing` flicker**

File: `apps/web/src/context/AuthContext.jsx`
- `sessionRefreshing` should NOT be set to `false` until the session has been FULLY resolved (user object is set)
- In the bootstrap effect (lines 391-461), when `isSignedIn` changes from false to true or on initial load, keep `sessionRefreshing = true` until AFTER `refreshSession` completes AND sets the user
- Move `setSessionRefreshing(false)` into the `.then()` of `refreshSession`, not into early-return branches (except for the "not signed in" branch)

**C. Strengthen the token persistence for page reloads**

File: `apps/web/src/context/AuthContext.jsx`
- In `ClerkBackedAuthProvider`, on mount, read the cached user from localStorage IMMEDIATELY and set it as the initial user state (just like `LegacyAuthProvider` does at line 181-184)
- This provides a user object during the bootstrap phase, preventing `isAuthenticated` from being `false` while Clerk loads
- The background `refreshSession` will update/replace this cached user once it completes

**D. Fix the wrong-network premature logout**

File: `apps/web/src/App.jsx`
- Gate the wrong-network effect behind BOTH `isReady` AND `!membershipSyncInFlightRef.current`
- Add an additional guard: don't trigger wrong-network logout if the user object hasn't been refreshed for the CURRENT tenant yet (i.e., if the user data is stale from a previous tenant)
- Consider adding a small delay (200-300ms) before acting on wrong-network to allow the membership sync to complete

**E. Verify cookie configuration**

File: `apps/api/src/utils/authCookie.js`
- Ensure the `__session` cookie is set with `domain` that covers all subdomains (e.g., `.pondbridgealumni.com`)
- Ensure `path: "/"` is set
- Ensure `sameSite: "lax"` or `"none"` (with `secure: true`) for cross-subdomain requests
- Verify `httpOnly` is appropriate - if the frontend needs to read the cookie, it can't be httpOnly (but the current code uses Bearer tokens, so httpOnly is fine as long as the backend reads it)

**F. Add JWT expiration buffer**

File: `apps/api/src/utils/auth.js`
- Ensure `JWT_EXPIRES_IN` is at least "24h" for legacy tokens
- In `requestJson` (http.js), the 401 retry logic (lines 127-141) already force-refreshes Clerk tokens, which is good
- But for legacy tokens, a 401 immediately clears auth state without retry - add a similar retry mechanism

### Files to Modify
1. `apps/web/src/components/ProtectedRoute.jsx` - Fix race condition
2. `apps/web/src/context/AuthContext.jsx` - Fix sessionRefreshing flicker, add cached user hydration for Clerk
3. `apps/web/src/App.jsx` - Fix wrong-network premature logout
4. `apps/api/src/utils/authCookie.js` - Verify cookie domain configuration
5. `apps/api/src/utils/auth.js` - Verify JWT expiration

---

## Implementation Priority Order

### Phase 1: Stop the Login Bounce (Issue 3) - MOST DISRUPTIVE TO USERS
1. Fix `ProtectedRoute.jsx` race condition
2. Fix `ClerkBackedAuthProvider` sessionRefreshing flicker
3. Hydrate cached user in Clerk provider on mount
4. Verify cookie configuration

### Phase 2: Stop the Glitching (Issue 2) - VISUAL QUALITY
1. Remove or fix the `isRouting` animation in App.jsx
2. Fix ClerkBackedAuthProvider effect dependency array
3. Gate membership sync behind `isReady`
4. Stabilize wrong-network check

### Phase 3: Block Super Admin Camp Access (Issue 1) - DATA INTEGRITY
1. Add super admin guard in TenantAuthCallbackPage.jsx
2. Add super admin warning in camp Login.jsx
3. Add backend guards in access.js endpoints
4. Data cleanup script

---

## Key File Reference

| File | Path | Role |
|------|------|------|
| AuthContext | `apps/web/src/context/AuthContext.jsx` | All auth state management |
| TenantContext | `apps/web/src/context/TenantContext.jsx` | Tenant config loading |
| App Router | `apps/web/src/App.jsx` | All routing, redirects, scope checks |
| ProtectedRoute | `apps/web/src/components/ProtectedRoute.jsx` | Auth gate for protected pages |
| Camp Login | `apps/web/src/cedar/pages/Login.jsx` | Camp login page (Clerk + Legacy) |
| Super Login | `apps/web/src/pages/SuperLoginPage.jsx` | Super admin login |
| Auth Callback | `apps/web/src/pages/TenantAuthCallbackPage.jsx` | Post-Clerk-signin flow |
| HTTP Client | `apps/web/src/lib/http.js` | API requests, token refresh |
| Auth Storage | `apps/web/src/lib/storage.js` | localStorage read/write |
| Volatile Token | `apps/web/src/lib/authMemory.js` | In-memory token |
| Backend Auth MW | `apps/api/src/middleware/requireAuth.js` | Token verification |
| Access Routes | `apps/api/src/routes/access.js` | Join/decision/invite endpoints |
| Tenant Auth | `apps/api/src/routes/tenantAuth.js` | Login/register/magic-link |
| Super Auth | `apps/api/src/routes/superAuth.js` | Super login, session endpoint |
| Identity Users | `apps/api/src/services/identityUsers.js` | User resolution, role policy |
| Auth Cookie | `apps/api/src/utils/authCookie.js` | Cookie set/clear |
| Auth Utils | `apps/api/src/utils/auth.js` | JWT sign, password hash |

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Super admin can log into super console without issues
- [ ] Super admin navigating to a camp URL sees a warning/block, NOT a join flow
- [ ] Super admin cannot create a User/Profile in any camp
- [ ] Camp director can log into their camp smoothly (no flashes)
- [ ] Camp member can log into their camp smoothly
- [ ] Page reload on a protected camp page does NOT bounce to login
- [ ] Opening a new tab to a protected camp page works (cookie-based re-auth)
- [ ] Logging out actually logs out (no stale state)
- [ ] Wrong-network detection still works (user from Camp A can't access Camp B)
- [ ] Director onboarding flow still works end-to-end
- [ ] Invite accept flow still works end-to-end
