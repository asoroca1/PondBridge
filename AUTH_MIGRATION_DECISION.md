# Auth Migration Decision

## Decision

- Strategy: `clerk_bcrypt_digest_import`
- Passwords preserved: yes

## Evidence

- Legacy Cedar stores passwords in MongoDB at `users.passwordHash`.
- All sampled hashes and the full hash-prefix audit matched bcrypt `$2b$12`.
- The installed Clerk Backend SDK exposes `users.createUser({ passwordDigest, passwordHasher: "bcrypt" })` in [`@clerk/backend/dist/api/endpoints/UserApi.d.ts`](/Users/asoroca/Desktop/PondBridge System/pondbridge-platform/node_modules/@clerk/backend/dist/api/endpoints/UserApi.d.ts).
- Official Clerk docs for user creation and password-digest migration were also checked: [Create user](https://clerk.com/docs/reference/backend/user/create-user) and [Import users / password hashes](https://clerk.com/docs/guides/development/migrating/authjs).

## Implementation

- Existing Clerk users were reused when the same email already existed.
- Missing Clerk users were created with their legacy bcrypt digest and a Clerk `externalId` derived from the legacy Cedar user ID.
- PondBridge app-user rows store `clerk_user_id` and use `password_hash="clerk_managed"` because runtime authentication is Clerk-based in this repo.
- If a Clerk create call failed, the PondBridge membership row can still be claimed later by a Clerk account using the same email, because the app auth layer links Cedar memberships by email on first successful Clerk login.
