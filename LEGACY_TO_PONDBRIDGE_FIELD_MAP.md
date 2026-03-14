# Legacy To PondBridge Field Map

## Identity and membership

- Legacy `users._id` -> PondBridge `users.id`
- Legacy `users._id` -> PondBridge `profiles.id`
- Legacy `users._id` -> PondBridge `profiles.user_id`
- Legacy `users.email` -> PondBridge `users.email`
- Legacy `users.passwordHash` -> Clerk `passwordDigest` with `passwordHasher: "bcrypt"`
- Legacy `users._id` -> Clerk `externalId` (`legacy_cedar_user_<id>`)
- Legacy `users.email == aden@sorocafamily.com` -> PondBridge `users.roles = ["tenant_admin","user"]`
- All other legacy users -> PondBridge `users.roles = ["user"]`

## Profile core

- Legacy `firstName` -> PondBridge `profiles.first_name`
- Legacy `lastName` -> PondBridge `profiles.last_name`
- Legacy `email` -> PondBridge `profiles.emails[0]`
- Legacy `phone` -> PondBridge `profiles.phones[]`
- Legacy `city/state/country` -> PondBridge `profiles.city_state`
- Legacy `roles[]` -> PondBridge `profiles.role_at_camp` as a comma-separated label
- Legacy `highSchool` -> PondBridge `profiles.high_school`
- Legacy `education[].college` -> PondBridge `profiles.colleges[]`
- Legacy `education[].year` -> PondBridge `profiles.college_years[]`
- Legacy `currentJobs[]` -> PondBridge `profiles.current_jobs`
- Legacy `pastJobs[]` -> PondBridge `profiles.past_jobs`
- Legacy `industry` -> PondBridge `profiles.industry`
- Legacy `uploads.photoUrl` -> PondBridge `profiles.avatar_url` (copied to R2 when possible)

## Profile JSON metadata

- Legacy `nickname` -> PondBridge `profiles.socials.nickname` and `campNickname`
- Legacy `camperYears` -> PondBridge `profiles.socials.camperYears`
- Legacy `roles[]` -> PondBridge `profiles.socials.roles`
- Legacy `education[].major` -> PondBridge `profiles.socials.collegeMajors` and `educationMajors`
- Legacy social links -> PondBridge `profiles.socials.linkedin`, `instagram`, `facebook`
- Legacy `legalAcceptance` -> PondBridge `profiles.socials.legalAgreement`

## Content models

- Legacy `activities` -> PondBridge `activity_items`
- Legacy `forums` -> PondBridge `forums`
- Legacy `forumposts` -> PondBridge `forum_posts`
- Legacy `conversations` -> PondBridge `conversations`
- Legacy `messages` -> PondBridge `messages`
- Legacy `photos` -> PondBridge `photos`
- Legacy `photocomments` -> PondBridge `photos.comments[]`
- Legacy `newsletters` -> PondBridge `newsletters`
- Legacy `familytrees` -> PondBridge `family_trees`

## Not migrated automatically

- Legacy `prelaunchsignups`: preserved in audit artifacts only
- Legacy `citygeos`: preserved in audit artifacts only
- Legacy `customcities`: preserved in audit artifacts only
