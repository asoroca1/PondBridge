# PondBridge Native Mobile Shells

Native shells for the existing `@pondbridge/web` app. Full architecture, release
blockers, and deep-link setup live in [`docs/NATIVE_SHELL.md`](../../docs/NATIVE_SHELL.md).

Architecture rules:

- `apps/web` remains the source of truth for UI, routes, and feature behavior.
- `apps/ios` is the historical workspace name; it now contains both the Xcode and Gradle projects.
- Both phone apps load the live PondBridge web app so auth, branding, and feature changes mirror production immediately.
- New features should be implemented in shared web code first so they appear in web, iOS, and Android together.
- Android is currently out of scope, and `apps/ios/android/` is **not tracked in git**. Commit it before resuming Android work.

Useful commands:

- `npm run ios:build`
- `npm run ios:sync`
- `npm run ios:open`
- `npm run ios:doctor`
- `npm run clean:icloud-dups` (and `:dry` to preview)

Build target:

- `capacitor.config.js` defaults to `https://app.pondbridgealumni.com`.
- Override it with `PONDBRIDGE_APP_URL` to build a shell against staging or a LAN dev server.
  A physical phone must never use `localhost`; plain `http` is rejected for anything
  other than `localhost` and LAN addresses.

Native API notes:

- Because the shell loads the live app domain, Clerk and tenant auth run against the same production origin as the web app.
- `@capacitor/app` refreshes the signed-in session and notification state when the app resumes, and routes trusted PondBridge custom/deep links into the shared SPA.
- `@capacitor/network` exposes offline and restored-connection feedback without replacing the persistent server-backed inbox.
- `@capacitor/browser` keeps external destinations inside a secure in-app browser while same-origin links remain in the SPA.
- `@capacitor/push-notifications` registers the correct app identity and receives foreground notifications; account-level push and notification-category choices remain server owned.
- The custom URL format is `pondbridge://open/t/<camp-slug>/<path>` and works without any association file.
- HTTPS Universal Links are claimed through `apps/web/public/.well-known/apple-app-site-association`,
  which deliberately excludes `/auth/callback` so Clerk OAuth completes in the browser that started it.

Offline behavior:

- `server.errorPath` serves a bundled `offline.html` when the live app is unreachable,
  including a first-ever cold start with no connectivity.
- This is a failure screen, not offline-first: no cached shell, no offline data, no queued writes.
- Because it ships from `apps/web/dist`, **run `npm run ios:sync` before any release build**.

Release validation checklist:

1. Run `npm run ios:sync`, `npm run ios:doctor`, and a clean simulator build.
2. Test sign-in, sign-out, switch-camp, resume, offline/reconnect, custom links, external links, and all tab destinations on small and large iPhones.
3. On signed physical devices, verify APNs permission states, token registration, foreground/background/tapped notifications, account-level push pause, category preferences, and inbox persistence.
4. Send a reviewed director broadcast to a staging audience and verify eligible-recipient preview, immediate delivery, scheduled delivery, cancellation, and no-recipient blocking.
5. Complete VoiceOver, Dynamic Type, Reduce Motion, keyboard/switch access, contrast, safe-area/inset, and rotation checks before TestFlight.

Known release constraints:

- **The signing team is a free personal team and cannot ship.** Personal teams do not
  support Push Notifications or Associated Domains, so device builds fail at
  provisioning and TestFlight is unavailable until the account is enrolled in the
  Apple Developer Program. Push has only ever worked in the simulator.
- Do not claim Universal Links until the App ID has the Associated Domains capability
  and the association file is verified in production.
- Do not claim production push readiness from simulator builds; APNs delivery requires
  signed physical-device rehearsals.
- The shell loads a remote URL, so App Store Guideline 4.2 applies. The native
  capabilities that answer it are listed in `docs/NATIVE_SHELL.md`.
