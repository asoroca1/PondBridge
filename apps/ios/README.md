# PondBridge iOS Shell

This workspace packages the existing `@pondbridge/web` app as a separate native iOS app.

Architecture rules:

- `apps/web` remains the source of truth for UI, routes, and feature behavior.
- `apps/ios` is only the native shell and Xcode project.
- New features should be implemented in shared web code first so they appear in both web and iOS builds.

Useful commands:

- `npm run ios:build`
- `npm run ios:sync`
- `npm run ios:open`
- `npm run ios:doctor`

Native API notes:

- The iPhone app should not use `localhost` for API traffic on a physical device.
- Set `VITE_NATIVE_API_BASE` when you need the native shell to talk to a specific API origin.
- If `VITE_API_BASE` is a local dev URL, the native app falls back to the production API unless `VITE_NATIVE_API_BASE` is set.
