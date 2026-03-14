# Aden Director Assignment

## Identity used

- Email: `aden@sorocafamily.com`
- Existing global PondBridge user: yes
- Existing Clerk user: `user_3A5LunFWD8XlTvyhkfHz25VXRVZ`

## Assignment method

- The Cedar migration importer treats Aden as the only Cedar tenant admin by actual rule, not by legacy display-role text.
- During user import, the Cedar tenant-scoped `users` row for Aden was upserted with:
  - `tenant_id = 5f87cef25f677d340dca6426`
  - `email = aden@sorocafamily.com`
  - `clerk_user_id = user_3A5LunFWD8XlTvyhkfHz25VXRVZ`
  - `roles = ["tenant_admin", "user"]`
  - `status = active`
- The Cedar `profiles` row for Aden was also upserted using the migrated legacy Cedar profile data.
- The Cedar tenant row itself was updated so launch/contact/director acceptance metadata points at Aden’s Cedar tenant user ID:
  - `launch.launchedByUserId`
  - `content.contactEmail`
  - `directorLegalAgreement.acceptedByUserId`

## Why this was the correct path

- PondBridge authorization is tenant-scoped through the Cedar tenant `users` row and its `roles` array.
- Clerk remains the authentication authority, so the migrated Cedar tenant membership had to link to the real Clerk user instead of a fake local-only admin shortcut.
- The legacy Cedar app did not expose a durable database-backed admin model for multiple tenant directors; actual admin access was controlled by environment allowlists. Because of that, only Aden was elevated in PondBridge.

## Verification

- Cedar tenant ID: `5f87cef25f677d340dca6426`
- Verified Cedar user row for Aden exists and is active.
- Verified Cedar user row for Aden includes `tenant_admin`.
- Verified Cedar user row for Aden includes the real Clerk user ID.
