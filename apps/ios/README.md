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
