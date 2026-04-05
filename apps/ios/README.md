# PondBridge iOS Shell

This workspace provides a separate native iOS shell for the existing `@pondbridge/web` app.

Architecture rules:

- `apps/web` remains the source of truth for UI, routes, and feature behavior.
- `apps/ios` is only the native shell and Xcode project.
- The iPhone app loads the live PondBridge web app from `https://app.pondbridgealumni.com` so auth, branding, and feature changes mirror production immediately.
- New features should be implemented in shared web code first so they appear in both web and iOS experiences.

Useful commands:

- `npm run ios:build`
- `npm run ios:sync`
- `npm run ios:open`
- `npm run ios:doctor`

Native API notes:

- The iPhone app should not use `localhost` for API traffic on a physical device.
- Because the shell loads the live app domain, Clerk and tenant auth run against the same production origin as the web app.
- If you ever switch the native shell back to bundled web assets for local testing, keep `VITE_NATIVE_API_BASE` pointed at a reachable API origin.
