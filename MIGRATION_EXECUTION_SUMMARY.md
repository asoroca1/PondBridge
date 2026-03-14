# Migration Execution Summary

- Dry run: no
- Target tenant slug: `cedar`
- Target tenant ID: `5f87cef25f677d340dca6426`
- Import timestamp: 2026-03-13T21:09:10.631Z

## Imported records

- Users: 282
- Profiles: 282
- Activity items: 338
- Forums: 27
- Forum posts: 1
- Conversations: 12
- Messages: 15
- Photos: 18
- Newsletters: 12
- Family trees: 1

## Auth strategy

- Decision: `clerk_bcrypt_digest_import`
- Passwords preserved in Clerk: yes
- Clerk users reused: 282
- Clerk users created: 0
- Users left for claim flow: 0

## Preserved but not imported

- Legacy prelaunch signups: 372
- Legacy custom city and city-geo collections were audited but not imported because PondBridge treats those as derived/supporting data, not tenant-owned alumni membership records.

## Artifacts

- Import summary JSON: `migration/cedar-mapping-files/cedar-import-summary.json`
- Tenant manifest: `migration/cedar-mapping-files/cedar-new-tenant-manifest.json`
- Legacy/user ID maps: `migration/cedar-mapping-files/*.json`
