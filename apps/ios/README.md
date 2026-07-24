# PondBridge Native Mobile Shells

This workspace provides native iOS and Android shells for the existing `@pondbridge/web` app.

Architecture rules:

- `apps/web` remains the source of truth for UI, routes, and feature behavior.
- `apps/ios` is the historical workspace name; it now contains both the Xcode and Gradle projects.
- Both phone apps load the live PondBridge web app from `https://app.pondbridgealumni.com` so auth, branding, and feature changes mirror production immediately.
- New features should be implemented in shared web code first so they appear in web, iOS, and Android together.

Useful commands:

- `npm run ios:build`
- `npm run ios:sync`
- `npm run ios:open`
- `npm run ios:doctor`
- `npm run android:sync`
- `npm run android:build`
- `npm run android:open`

Native API notes:

- A physical phone must never use `localhost` for API traffic.
- Because the shell loads the live app domain, Clerk and tenant auth run against the same production origin as the web app.
- If you ever switch the native shell back to bundled web assets for local testing, keep `VITE_NATIVE_API_BASE` pointed at a reachable API origin.

Native experience bridge:

- `@capacitor/app` refreshes the signed-in session and notification state when the app resumes, and routes trusted PondBridge custom/deep links into the shared SPA.
- `@capacitor/network` exposes offline and restored-connection feedback without replacing the persistent server-backed inbox.
- `@capacitor/browser` keeps external destinations inside a secure in-app browser while same-origin links remain in the SPA.
- `@capacitor/push-notifications` registers the correct iOS or Android app identity and receives foreground notifications; account-level push and notification-category choices remain server owned.
- Android creates the `pondbridge_updates` notification channel before registering with Firebase. The API sends through FCM HTTP v1 with short-lived OAuth access tokens; the retired FCM server-key endpoint is not used.
- The custom URL format is `pondbridge://open/t/<camp-slug>/<path>`. HTTPS links require Apple `apple-app-site-association` and Android `.well-known/assetlinks.json` files tied to the final signing identities.
- Directors receive a native `Manage` tab that opens the responsive camp control room. Members retain the standard Home, Search, Messages, Events, and Profile tabs.

Release validation checklist:

1. Run `npm run ios:sync`, `npm run android:sync`, `npm run ios:doctor`, and clean simulator/emulator builds.
2. Test sign-in, sign-out, switch-camp, resume, offline/reconnect, custom links, external links, and all five tab destinations on small and large iPhone and Android devices.
3. On signed physical devices, verify APNs/FCM permission states, platform-correct token registration, foreground/background/tapped notifications, account-level push pause, category preferences, and inbox persistence.
4. Send a reviewed director broadcast to a staging audience and verify eligible-recipient preview, immediate delivery, scheduled delivery, cancellation, and no-recipient blocking.
5. Complete VoiceOver/TalkBack, Dynamic Type/font scaling, Reduce Motion, keyboard/switch access, contrast, safe-area/inset, and rotation checks before TestFlight or Play promotion.

Android release setup:

1. Install Android Studio and an API 24+ emulator; Capacitor 8 targets API 36 in the generated project.
2. Register the Android application ID `com.pondbridge.android` in Firebase and supply `google-services.json` to `apps/ios/android/app/` through the local/CI secret store.
3. Enable the Firebase Cloud Messaging API and configure the API-only `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, and `FCM_PRIVATE_KEY` secrets.
4. Create a Play signing key outside the repository, record its SHA-256 certificate fingerprint, and publish `.well-known/assetlinks.json` before claiming verified App Links.
5. Produce a signed Android App Bundle, complete the Play data-safety declaration, and validate through an internal test track.

Known release constraints:

- The shell currently loads `https://app.pondbridgealumni.com`; a first-ever cold start without connectivity cannot load a bundled offline app. Treat bundled fallback/offline-first startup as an explicit product and release decision.
- Do not claim universal/App Links until the production association files and signing fingerprints are configured and tested.
- Do not claim production push readiness from simulator/emulator builds; APNs and FCM delivery require signed physical-device rehearsals.
