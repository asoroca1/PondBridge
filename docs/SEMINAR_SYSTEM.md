# Registered-Member Seminar System

## Purpose

PondBridge seminars are live career, college, financial-literacy, and
mentorship programs hosted by a registered member of one camp network. They
share the existing event calendar and RSVP system, but add an online meeting
room, a program track and audience, one or more registered presenters,
capacity controls, and audited access.

The first release supports secure HTTPS links for Zoom, Microsoft Teams,
Google Meet, and another director-approved provider. PondBridge does not send
the meeting link in event lists, member detail responses, search output,
mobile alerts, or event email.

## Director flow

1. Open **Events & Seminars** and choose **New Event or Seminar**.
2. Select **Online seminar**.
3. Add the seminar title, topic, program track, intended audience, summary,
   description, dates, RSVP deadline, and optional registration capacity.
4. Choose online or hybrid delivery and a meeting provider.
5. Add the private HTTPS meeting link.
6. Search the camp directory and add one or more active registered members as
   presenters. Each one is marked as going automatically, and the first is the
   lead presenter. Presenters can also be added or removed later from the event
   detail pane without reopening the composer.
7. Save the draft and review the member-facing page.
8. Publish when every required field is ready.
9. Monitor registrations and the audited count of seminar-room opens.
10. Use the existing reviewed member-email workflow for invitations,
    reminders, updates, or cancellation. The meeting link is never inserted
    into the generated event block.

The API and database both reject a presenter who is inactive, unregistered, or
from another camp. Removing a presenter also clears the RSVP that adding them
created, but leaves an RSVP the member made themselves untouched.

## Member flow

1. A signed-in member opens **Events & Seminars**.
2. The member can filter the schedule to seminars or community events.
3. Seminar cards show the topic, provider, date, response state, and attendance
   count without exposing the meeting link.
4. The detail page shows the program track, audience, capacity, every
   registered presenter, description, and RSVP controls.
5. The member selects **Going**.
6. **Join seminar** becomes available.
7. Opening the room makes a fresh authenticated API request. The API rechecks
   the member profile, seminar status, RSVP, and end time before returning the
   HTTPS provider link.

Any registered presenter can open the room without creating a separate RSVP. A
member who is not attending, is inactive, lacks a profile, belongs to another
camp, or attempts to open a draft/canceled/expired seminar cannot receive the
link.

## Data and security model

- Public program metadata is stored on `events`.
- Presenters are stored in `event_presenters`, ordered by `sort_order`.
  `events.host_profile_id` mirrors the first presenter so host-aware code paths
  keep working unchanged.
- Private meeting URLs are stored in `event_meeting_details`.
- Room access is recorded in `event_join_access_logs`.
- The two private tables force row-level security, grant CRUD only to
  `service_role`, and explicitly revoke `anon` and `authenticated`.
- Tenant-consistency triggers protect seminar hosts, presenters, meeting
  records, join actors, and RSVPs even if an API bug attempts a cross-camp
  write.
- Capacity is enforced twice: an early API check gives a friendly response,
  while a database trigger locks the event row and atomically rejects the
  over-capacity RSVP race.
- The join endpoint is rate limited and returns `Cache-Control: no-store`.
- Meeting access is time-bounded through four hours after the scheduled end.
- Analytics records `seminar_join_link_opened` without storing the link.

## Product surfaces

Seminars are reflected in:

- member desktop and phone event discovery;
- the member seminar detail and RSVP experience;
- director event creation, editing, publishing, email, registration, and room
  access metrics;
- director onboarding and the shared feature inventory;
- director and member notification settings;
- tenant navigation and route titles;
- Cedar AI member starters and event-navigation answers;
- the Capacitor mobile shell through the shared responsive event routes.

## Rollout sequence

1. Apply `20260730015621_add_registered_member_seminars.sql`, followed by
   `20260731003100_add_seminar_foreign_key_indexes.sql` and
   `20260824090000_add_event_presenters.sql`, in an isolated staging project.
2. Run the complete tenant/RLS verification suite from a clean reset.
3. Create one synthetic Zoom seminar and one synthetic Teams seminar.
4. Verify lead presenter, co-presenter, attending member, non-attending member,
   inactive member, and cross-camp outcomes.
5. Verify capacity with concurrent final-seat requests.
6. Confirm list, detail, email, notification, AI, and logs never disclose the
   meeting URL.
7. Rehearse desktop, 390-pixel phone, keyboard, VoiceOver, and NVDA journeys.
8. Pilot with one camp before enabling seminars broadly.

## Provider integration follow-on

PondBridge controls who can obtain a meeting link from PondBridge. A plain
Zoom, Teams, or Meet URL can still be forwarded after an authorized member
opens it. Fully enforcing registered-person attendance inside the provider
requires the next integration phase:

- camp-owned Zoom OAuth and Microsoft Graph connections;
- automatic meeting creation with waiting-room/lobby controls;
- provider registration or per-attendee join tokens where supported;
- calendar invitations and timed reminders;
- provider webhook attendance, recording, and follow-up data;
- director controls for recordings, consent, host handoff, and retention.

Until those controls are connected and verified, directors should enable the
provider waiting room/lobby and admit only expected registered attendees.
