# Dependency security follow-up — September 8, 2026

Fresh npm registry audit against main `deaea6b` found six affected dependency
entries: three moderate, two high and one critical. Omitting development
dependencies found four: one moderate, two high and one critical. These are
dependency counts, not distinct advisory counts. Both audit views report zero
after this patch. Earlier zero-vulnerability results were snapshots and do not
describe the newly queried registry evidence.

| Dependency | Before | After | Exposure and fix |
| --- | --- | --- | --- |
| maplibre-gl | 5.18.0 | 6.4.1 | Critical attribution sanitizer bypass. The map consumes third-party OpenFreeMap style/source attribution, so this path is relevant even though profile popup values are already escaped. 6.4.1 is the first vendor-patched version. |
| multer | 2.2.0 | 2.3.0 | High multipart field-name process crash/CPU denial of service and aborted-upload cleanup issues. Inspected parsers follow member/admin authentication, but an authenticated attacker can affect the shared API. Pin patched release and explicitly cap bracket-array indices at 100 for all four parsers. Existing byte limits remain. |
| nodemailer | 9.0.3 | 9.1.1 | High address-parser denial of service and recipient/path-resolution advisories. The configured production provider uses Resend, and app SMTP attachments are normalized to content buffers; the legacy public plugin resolver is unused. Patch the alternate SMTP runtime anyway. |
| colord | 2.9.3 | 2.9.4 | Moderate oversized malformed color-string CPU issue. No application import found; patch retained dependency. |
| vitest / @vitest/mocker | 4.1.10 | 4.1.11 | Moderate development mock-server path traversal. CI uses `vitest run`; this is not the deployed API or static web runtime. Patch the test tooling and constrain its Vite dependency to the app's existing 7.3.6. |

Maintainer sources: [MapLibre advisory](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579),
[Multer field parsing](https://github.com/expressjs/multer/security/advisories/GHSA-wc9g-mqfw-jrwm),
[Multer array limit](https://github.com/expressjs/multer/security/advisories/GHSA-535w-7cp7-47q4),
[Nodemailer resolver](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-8m3c-c648-2xjj),
[Nodemailer recipient parsing](https://github.com/nodemailer/nodemailer/security/advisories/GHSA-cc9r-2j5m-2m83),
[colord advisory](https://github.com/omgovich/colord/security/advisories/GHSA-2wm5-q62r-hmrv),
[Vitest advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9).

## MapLibre compatibility

The major upgrade follows the [vendor migration guide](https://github.com/maplibre/maplibre-gl-js/blob/v6.0.0/docs/guides/v5-to-v6-migration-guide.md).
The lazy map loader uses the ESM namespace and explicitly configures the worker
URL. Vite's `?worker&url` pipeline bundles the worker's imports into a same-origin
asset; no CDN worker or CSP expansion is needed. The map now probes WebGL2, as
required by v6. Devices without it retain the accessible city/profile picker and
receive a clear fallback message. The application does not use the removed
internal camera transform, legacy style-image callback, or second `setData`
argument. Clustering, public camera methods and escaped popup markup remain.

## Verification and reproducibility

Use Node 22.12 or newer. npm 10.9.8 hit an Arborist optional-peer `edgesOut` crash
while resolving the Vitest update. The lock was generated with npm 11, with the
Vite override preventing an unrelated Vite 8 upgrade; its dependency placement
changes account for much of the lock diff. Ordinary Node 22/npm 10 `npm ci
--ignore-scripts` is checked against the resulting lock.

Checks include both fresh `npm audit --json` and `npm audit --omit=dev --json`,
all safe API tests, all web tests, full lint, and a production web build. The
final clean install passed 94 API suites / 764 tests, 70 web suites / 480 tests,
lint (only two existing API warnings), production build and all web size budgets.
Both final registry audits returned zero in every severity category. The
focused tests exercise actual Multer rejecting an oversized multipart array
index followed by a successful ordinary upload, actual Nodemailer composing a
message entirely in memory, and the actual MapLibre AttributionControl stripping
consecutive event-handler attributes while retaining the provider credit link.
The map component test verifies its usable city picker with unavailable WebGL2.
No live email, production data mutation, or external attack scan is part of this
validation. Headless DOM checks do not prove GPU rendering on every device.

Deploy the API and web dependency builds together through the normal release
process. No database migration or tenant configuration change is required.
Do not retain an older vulnerable dependency as a permanent rollback strategy.
