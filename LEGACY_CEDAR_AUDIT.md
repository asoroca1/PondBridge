# Legacy Cedar Audit

## App shape

- Backend: Node.js + Express 5 + MongoDB/Mongoose
- Frontend: Vite + React 19
- Auth: JWT sessions backed by MongoDB users and bcrypt password hashes
- Media: AWS S3 public URLs for profile photos, photo posts, and newsletter PDFs

## Collections and counts

- `users`: 282
- `activities`: 338
- `citygeos`: 131
- `customcities`: 6
- `conversations`: 15
- `messages`: 21
- `forums`: 26
- `forumposts`: 1
- `photos`: 18
- `photocomments`: 1
- `newsletters`: 12
- `familytrees`: 1
- `prelaunchsignups`: 372

## User/auth findings

- Primary auth collection: `users`
- Auth fields:
  - `email`
  - `passwordHash`
  - `resetPasswordTokenHash`
  - `resetPasswordExpiresAt`
- Password hashing:
  - all 282 sampled hashes share bcrypt prefix `$2b$`
  - bcrypt cost factor observed: `12`
- Email hygiene:
  - 282 total user emails
  - 0 missing emails
  - 0 duplicate emails
  - 0 uppercase/normalization anomalies in the stored data

## Legacy user profile shape

- `firstName`, `lastName`, `nickname`, `phone`
- `locationMode`, `city`, `state`, `country`
- `roles` (camp-role labels such as Camper, Counselor, CIT, JC, Admin)
- `uploads.photoUrl`
- `camperYears.firstYear`, `firstGroup`, `lastYear`, `lastGroup`
- `highSchool`
- `education[]`
- `industry`
- `currentJobs[]`, `pastJobs[]`
- `social.linkedin`, `instagram`, `facebook`
- `legalAcceptance`

## Important auth/role nuance

- Legacy administrative access was determined by env allowlists (`ADMIN_EMAILS`, `ADMIN_USER_IDS`), not by the `roles` array on user documents.
- Therefore `roles: ["Admin"]` is a camp-history label, not a reliable authorization flag for PondBridge migration.

## Content findings

- Forums are mostly seeded city-based community rooms.
- Family trees use edges between user/profile IDs.
- Newsletters store `pdfUrl` plus legacy `s3Key`.
- Photos store public `imageUrl` plus `likedBy` arrays.
- Photo comments live in a separate collection and need to be merged into PondBridge `photos.comments`.

## Data kept for audit but not auto-imported

- `prelaunchsignups`
- `citygeos`
- `customcities`
