# Native Shell (iOS)

How the phone app is built, what it can and cannot do today, and what still
blocks a store release.

Android exists in `apps/ios/android/` but is deliberately out of scope right now.
It is also **not tracked in git** — see [Android is untracked](#android-is-untracked).

## Architecture

`apps/ios` is a **Capacitor 8 remote-URL shell**. It does not run bundled web
assets: `server.url` points the native WebView at the live web app, so a feature
shipped to web reaches the phone without an App Store release.

```
apps/web  ──build──>  apps/web/dist  ──cap copy──>  apps/ios/ios/App/App/public
   │                                                          │
   │  source of truth for all UI, routes, behavior            │  bundled fallback only
   ▼                                                          ▼
https://app.pondbridgealumni.com  ◄────── WebView loads this ──┘
```

The bundled copy exists for exactly one reason: `server.errorPath` serves
`offline.html` from it when the remote origin cannot be reached. Everything else
in that folder is unused at runtime, but it is still bundled into the `.app`.

Native behavior lives in [`NativeAppExperience.jsx`](../apps/web/src/components/NativeAppExperience.jsx)
and [`MobileNotificationsContext.jsx`](../apps/web/src/context/MobileNotificationsContext.jsx):
resume → session refresh, deep links → SPA routes, `target="_blank"` → in-app
browser, network changes → connectivity banner, APNs → server-owned inbox.

## Building against a different origin

`capacitor.config.js` reads `PONDBRIDGE_APP_URL`. It defaults to production.

```bash
PONDBRIDGE_APP_URL=https://staging.pondbridgealumni.com npm run ios:sync
```

A physical phone can never reach `localhost`, so use the Mac's LAN address for
device testing. Plain `http` is accepted only for `localhost` and LAN IPs, and
the config throws on any other insecure origin so a production shell can never be
built with an ATS exception:

```bash
PONDBRIDGE_APP_URL=http://192.168.1.20:5174 npm run ios:sync
```

`offline.html` reads the origin back from the Capacitor bridge, so a staging
shell retries against staging rather than jumping to production.

## Offline behavior

A first-ever cold start with no connectivity used to render a blank white screen.
`server.errorPath` now serves a bundled offline page with a retry button that
also fires automatically on the `online` event.

This is a **failure screen, not offline-first**. There is no cached shell, no
offline data, and no queued writes. Making the app genuinely usable offline is a
separate product decision, not a config change.

Because the offline page ships from `apps/web/dist`, **`npm run ios:sync` must run
before any release build**. A stale bundle means a stale offline page.

## Release blockers

### The signing team is a personal team

`DEVELOPMENT_TEAM = 9RZ3X4XNLD` is a free personal team. A device build fails at
provisioning:

> Personal development teams, including "Aden Soroca", do not support the
> Associated Domains and Push Notifications capabilities.

This predates any recent work — push notifications have never worked on a
physical device, only in the simulator. Until the account is enrolled in the
**Apple Developer Program**, the app cannot:

- register for APNs on a real device,
- claim Universal Links,
- ship to TestFlight or the App Store.

Everything below assumes that enrollment happens first.

### After enrolling

1. Enable **Push Notifications** and **Associated Domains** on the
   `com.pondbridge.ios` App ID in the developer portal.
2. Confirm `https://app.pondbridgealumni.com/.well-known/apple-app-site-association`
   serves as `application/json` over a `200` with no redirect.
3. Build to a signed physical device and verify APNs registration, foreground,
   background, and tapped notifications.
4. Tap a `https://app.pondbridgealumni.com/t/<slug>/...` link from Mail or
   Messages and confirm it opens the app rather than Safari.

## Universal Links

`apps/web/public/.well-known/apple-app-site-association` claims tenant routes and
email preference links. It deliberately **excludes** `/auth/callback` and
`/t/*/auth/callback`: those are Clerk OAuth redirects, and capturing them into the
app mid-flow breaks sign-in. `/super*` and `/api/*` are excluded too, mirroring
the rejections in [`nativeNavigation.js`](../apps/web/src/lib/nativeNavigation.js).

Two serving details matter and both are easy to regress:

- `_redirects` needs the association-file passthrough **above** the `/* / 200` SPA
  fallback, or Apple is handed `index.html`. `npm run prebuild` fails the build if
  that rule is missing or out of order.
- `_headers` sets `Content-Type: application/json`, because the file has no
  extension and iOS will not verify it otherwise.

The `pondbridge://open/t/<slug>/<path>` custom scheme works today without any of
this, since custom schemes need no association file.

## Push environment

`aps-environment` is driven by the `APS_ENVIRONMENT` build setting rather than
hardcoded — `development` for Debug, `production` for Release. Hardcoding
`development`, as this project did previously, silently breaks push on TestFlight
and App Store builds: registration appears to succeed and no notification ever
arrives.

## App Store Guideline 4.2

A WebView pointed at a website is the textbook "minimum functionality" rejection.
The mitigations are real and worth stating in the review notes:

| Capability | Where |
| --- | --- |
| APNs push with a server-owned inbox and per-category preferences | `MobileNotificationsContext.jsx` |
| Universal Links and a custom URL scheme into tenant-scoped routes | `nativeNavigation.js`, AASA |
| Native tab bar, role-aware (directors get a Manage tab) | `NativeMemberTabBar.jsx` |
| In-app browser for external links, SPA routing for internal | `NativeAppExperience.jsx` |
| Network-state awareness and an offline failure screen | `NativeAppExperience.jsx`, `offline.html` |
| App lifecycle → session refresh on resume | `NativeAppExperience.jsx` |

This package usually clears review. It is not a guarantee — the same binary can
pass four times and get flagged by a different reviewer on the fifth. Expect to
argue it rather than assume it.

## The repository lives in iCloud Drive

`Desktop` is synced to iCloud Drive, so the checkout is inside it. iCloud resolves
sync conflicts by writing numbered siblings — `NativeAppExperience 2.jsx`,
`config 5.xml`, `gradlew 2` — and it restores them **while a build is running**.
A sweep found 299 of them, including 58 that had already been copied into the iOS
bundle.

Mitigations in place:

- `.gitignore` blocks the `* 2.ext` pattern so they can never be committed.
- `npm run clean:icloud-dups` (`:dry` to preview) sweeps the working tree.
- `npm run ios:sync` cleans immediately before `cap copy` and then **fails the
  build** if any conflict copy survived into the bundle.

These are guardrails, not a fix. The actual fix is to move the repository out of
iCloud Drive — `~/Developer/pondbridge`, for example — or disable Desktop &
Documents syncing in System Settings → Apple Account → iCloud → Drive.

## Android is untracked

`apps/ios/android/` contains a real, customized Gradle project — FCM notification
channel, icon and color metadata, App Links intent filter, FileProvider,
`allowBackup=false` — and **not one file of it is in git**. It is not ignored;
it was simply never added. It exists only on this Mac.

`npx cap add android` regenerates a stock project, not those customizations. When
Android comes back into scope, commit it before doing anything else.

## Known rough edges

- The workspace is named `@pondbridge/ios` but holds both platforms, so
  `npm run android:*` scripts live under an `ios` package name.
- `CODE_SIGN_IDENTITY = "iPhone Developer"` is a stale Capacitor default in the
  Release config. Automatic signing overrides it, so it is harmless today, but it
  is misleading if signing is ever switched to manual.
- `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` are both `1.0`/`1` and are not
  wired to any release process.
