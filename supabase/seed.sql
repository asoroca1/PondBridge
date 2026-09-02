-- PondBridge local staging seed.
-- Every record is synthetic. Reserved example.test addresses guarantee that
-- reset/rehearsal data cannot accidentally reach a real recipient.

BEGIN;

INSERT INTO public.tenants (
  id,
  name,
  slug,
  status,
  plan_tier,
  onboarding_status,
  onboarding_step,
  onboarding_checklist,
  onboarding_fee_amount,
  onboarding_fee_paid,
  billing_status,
  theme,
  content,
  settings,
  modules,
  access_settings,
  onboarding_progress,
  launch,
  notification_prefs,
  custom_domain
)
VALUES
  (
    'tenant_local_cedar',
    'Camp Cedar — Local Staging',
    'cedar',
    'active',
    'premium',
    'live',
    'review_launch',
    '[{"id":"name_branding","label":"Brand your network","status":"completed"},{"id":"welcome_message","label":"Name and welcome message","status":"completed"},{"id":"signup_controls","label":"Choose who can join","status":"completed"},{"id":"import_alumni","label":"Import your alumni list","status":"completed"},{"id":"modules","label":"Enable modules","status":"completed"},{"id":"review_launch","label":"Review and launch","status":"completed"}]'::jsonb,
    2500,
    true,
    'active',
    '{"brandPrimary":"#002b5c","brandSecondary":"#d3dde8","brandAccent":"#f2b134","bg":"#f5f7fa","text":"#0f172a","card":"#ffffff","logoUrl":"","heroImageUrl":"","fontToken":"cedar_default"}'::jsonb,
    '{"campType":"coed","networkDisplayName":"Camp Cedar Alumni Network — Local Staging","welcomeHeadline":"Welcome to the synthetic Cedar network","welcomeBody":"All people, messages, and activity in this environment are fictional.","aboutText":"A safe local rehearsal tenant for PondBridge.","contactEmail":"director@cedar.example.test","supportUrl":"","footerLinks":[]}'::jsonb,
    '{"environment":"local_staging","synthetic":true,"signupMode":"open","accessCodeHash":"","accessCodeHint":"","allowedEmailDomains":[],"allowSearchByDefault":true,"allowDirectoryBrowse":true,"requireProfileCompletion":false,"mobileAppCodeLookup":"CEDAR1","mobileAppCodeHint":"Local staging only","providerSafety":{"outboundEmail":"mock","push":"disabled","ai":"disabled","billing":"mock"}}'::jsonb,
    '{"directory":true,"search":true,"photoStream":true,"chat":true,"map":true,"familyTrees":true,"relatedProfiles":true,"newsletter":true,"merchShop":true}'::jsonb,
    '{"signupMode":"open","accessCode":""}'::jsonb,
    '{"currentStep":6,"completedSteps":[1,2,3,4,5,6],"lastImportStats":{"imported":3,"skipped":0,"rowsRead":3}}'::jsonb,
    jsonb_build_object('launchedAt', now(), 'launchedByUserId', '000000000000000000000101'),
    '{"mobileEnabled":true,"pushEnabled":false,"inboxEnabled":true,"newMemberJoined":true,"approvalRequests":true,"memberFlagged":true,"eventPublished":true,"eventCanceled":true,"newsletterPublished":true,"customBroadcasts":true,"weeklySummary":false,"soundEnabled":false}'::jsonb,
    'cedar.localhost'
  ),
  (
    'tenant_local_control',
    'Pine Ridge Control Camp — Local Staging',
    'pine-control',
    'active',
    'base',
    'live',
    'review_launch',
    '[{"id":"name_branding","label":"Brand your network","status":"completed"},{"id":"welcome_message","label":"Name and welcome message","status":"completed"},{"id":"signup_controls","label":"Choose who can join","status":"completed"},{"id":"import_alumni","label":"Import your alumni list","status":"completed"},{"id":"modules","label":"Enable modules","status":"completed"},{"id":"review_launch","label":"Review and launch","status":"completed"}]'::jsonb,
    0,
    true,
    'active',
    '{"brandPrimary":"#24533f","brandSecondary":"#dce9df","brandAccent":"#d6a84b","bg":"#f7faf8","text":"#13251c","card":"#ffffff","logoUrl":"","heroImageUrl":"","fontToken":"control_default"}'::jsonb,
    '{"campType":"coed","networkDisplayName":"Pine Ridge Control Network","welcomeHeadline":"Control-camp baseline","welcomeBody":"This fictional camp verifies that non-target behavior stays unchanged.","aboutText":"Synthetic control tenant.","contactEmail":"director@pine-control.example.test","supportUrl":"","footerLinks":[]}'::jsonb,
    '{"environment":"local_staging","synthetic":true,"controlTenant":true,"signupMode":"approval_queue","accessCodeHash":"","accessCodeHint":"","allowedEmailDomains":[],"allowSearchByDefault":true,"allowDirectoryBrowse":true,"requireProfileCompletion":false,"mobileAppCodeLookup":"PINE01","mobileAppCodeHint":"Local staging control","providerSafety":{"outboundEmail":"mock","push":"disabled","ai":"disabled","billing":"mock"}}'::jsonb,
    '{"directory":true,"search":true,"photoStream":true,"chat":true,"map":true,"familyTrees":true,"relatedProfiles":true,"newsletter":true,"merchShop":false}'::jsonb,
    '{"signupMode":"approval_queue","accessCode":""}'::jsonb,
    '{"currentStep":6,"completedSteps":[1,2,3,4,5,6]}'::jsonb,
    jsonb_build_object('launchedAt', now(), 'launchedByUserId', '000000000000000000000201'),
    '{"mobileEnabled":true,"pushEnabled":false,"inboxEnabled":true,"newMemberJoined":true,"approvalRequests":true,"memberFlagged":true,"eventPublished":true,"eventCanceled":true,"newsletterPublished":true,"customBroadcasts":true,"weeklySummary":false,"soundEnabled":false}'::jsonb,
    'pine-control.localhost'
  ),
  (
    'tenant_local_fresh',
    'Fresh Camp Rehearsal — Local Staging',
    'fresh-camp',
    'active',
    'base',
    'not_started',
    'name_branding',
    '[{"id":"name_branding","label":"Brand your network","status":"not_started"},{"id":"welcome_message","label":"Name and welcome message","status":"not_started"},{"id":"signup_controls","label":"Choose who can join","status":"not_started"},{"id":"import_alumni","label":"Import your alumni list","status":"not_started"},{"id":"modules","label":"Enable modules","status":"not_started"},{"id":"review_launch","label":"Review and launch","status":"not_started"}]'::jsonb,
    0,
    false,
    'trialing',
    '{}'::jsonb,
    '{"campType":"coed","networkDisplayName":"Fresh Camp Rehearsal","contactEmail":"director@fresh-camp.example.test"}'::jsonb,
    '{"environment":"local_staging","synthetic":true,"freshCampRehearsal":true,"signupMode":"invite_only","allowSearchByDefault":true,"allowDirectoryBrowse":true,"requireProfileCompletion":true,"providerSafety":{"outboundEmail":"mock","push":"disabled","ai":"disabled","billing":"mock"}}'::jsonb,
    '{"directory":true,"search":true,"photoStream":false,"chat":false,"map":false,"familyTrees":false,"relatedProfiles":false,"newsletter":false,"merchShop":false}'::jsonb,
    '{"signupMode":"invite_only","accessCode":""}'::jsonb,
    '{"currentStep":1,"completedSteps":[]}'::jsonb,
    '{}'::jsonb,
    '{"mobileEnabled":false,"pushEnabled":false,"inboxEnabled":true,"soundEnabled":false}'::jsonb,
    ''
  );

INSERT INTO public.users (id, tenant_id, email, password_hash, roles, status)
VALUES
  ('user_local_superadmin', NULL, 'superadmin@pondbridge.example.test', '$2a$10$MVN0Z7dYadNJx17WkuHvTeAA0a6C1SvNOR6.AYUIOw9CLpLL5OKwK', ARRAY['super_admin'], 'active'),
  ('000000000000000000000101', 'tenant_local_cedar', 'director@cedar.example.test', '$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu', ARRAY['tenant_admin','user'], 'active'),
  ('000000000000000000000102', 'tenant_local_cedar', 'alex.rivera@cedar.example.test', '$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu', ARRAY['user'], 'active'),
  ('000000000000000000000103', 'tenant_local_cedar', 'sam.chen@cedar.example.test', '$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu', ARRAY['user'], 'active'),
  ('000000000000000000000201', 'tenant_local_control', 'director@pine-control.example.test', '$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu', ARRAY['tenant_admin','user'], 'active'),
  ('000000000000000000000202', 'tenant_local_control', 'member@pine-control.example.test', '$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu', ARRAY['user'], 'active'),
  ('000000000000000000000301', 'tenant_local_fresh', 'director@fresh-camp.example.test', '$2a$10$jS4oqIRVjrED596U9KAoQebo9TogTPAKKktwwhk.F1akWpqJoLzvu', ARRAY['tenant_admin','user'], 'active');

INSERT INTO public.identities (id, primary_email, verified_emails, status, metadata)
VALUES
  ('identity_local_cedar_admin', 'director@cedar.example.test', ARRAY['director@cedar.example.test'], 'active', '{"synthetic":true}'::jsonb),
  ('identity_local_cedar_member_1', 'alex.rivera@cedar.example.test', ARRAY['alex.rivera@cedar.example.test'], 'active', '{"synthetic":true}'::jsonb),
  ('identity_local_cedar_member_2', 'sam.chen@cedar.example.test', ARRAY['sam.chen@cedar.example.test'], 'active', '{"synthetic":true}'::jsonb),
  ('identity_local_control_admin', 'director@pine-control.example.test', ARRAY['director@pine-control.example.test'], 'active', '{"synthetic":true}'::jsonb),
  ('identity_local_control_member', 'member@pine-control.example.test', ARRAY['member@pine-control.example.test'], 'active', '{"synthetic":true}'::jsonb),
  ('identity_local_fresh_director', 'director@fresh-camp.example.test', ARRAY['director@fresh-camp.example.test'], 'active', '{"synthetic":true}'::jsonb);

INSERT INTO public.tenant_memberships (
  id, tenant_id, identity_id, legacy_user_id, roles, status, join_method
)
VALUES
  ('membership_local_cedar_admin', 'tenant_local_cedar', 'identity_local_cedar_admin', '000000000000000000000101', ARRAY['tenant_admin','user'], 'active', 'admin_created'),
  ('membership_local_cedar_member_1', 'tenant_local_cedar', 'identity_local_cedar_member_1', '000000000000000000000102', ARRAY['user'], 'active', 'admin_created'),
  ('membership_local_cedar_member_2', 'tenant_local_cedar', 'identity_local_cedar_member_2', '000000000000000000000103', ARRAY['user'], 'active', 'admin_created'),
  ('membership_local_control_admin', 'tenant_local_control', 'identity_local_control_admin', '000000000000000000000201', ARRAY['tenant_admin','user'], 'active', 'admin_created'),
  ('membership_local_control_member', 'tenant_local_control', 'identity_local_control_member', '000000000000000000000202', ARRAY['user'], 'active', 'admin_created'),
  ('membership_local_fresh_director', 'tenant_local_fresh', 'identity_local_fresh_director', '000000000000000000000301', ARRAY['tenant_admin','user'], 'active', 'admin_created');

INSERT INTO public.profiles (
  id, tenant_id, user_id, tenant_membership_id, first_name, last_name, emails,
  city_state, role_at_camp, colleges, college_years, current_jobs, past_jobs,
  industry, socials, privacy, bio, status
)
VALUES
  ('000000000000000000000401', 'tenant_local_cedar', '000000000000000000000101', 'membership_local_cedar_admin', 'Casey', 'Director', ARRAY['director@cedar.example.test'], 'Portland, ME', 'Director', ARRAY['University of Maine'], ARRAY['2005'], '[{"role":"Camp Director","company":"Camp Cedar","years":"2014-Present"}]'::jsonb, '[]'::jsonb, 'Education', '{}'::jsonb, '{"email":"members","phone":"private"}'::jsonb, 'Fictional director used for local staging.', 'active'),
  ('000000000000000000000402', 'tenant_local_cedar', '000000000000000000000102', 'membership_local_cedar_member_1', 'Alex', 'Rivera', ARRAY['alex.rivera@cedar.example.test'], 'Boston, MA', 'Counselor', ARRAY['Boston University'], ARRAY['2018'], '[{"role":"Product Manager","company":"Example Labs","years":"2022-Present"}]'::jsonb, '[{"role":"Counselor","company":"Camp Cedar","years":"2016-2019"}]'::jsonb, 'Technology', '{"linkedin":"https://www.linkedin.com/in/example"}'::jsonb, '{"email":"members","phone":"private"}'::jsonb, 'Fictional member profile for search and directory testing.', 'active'),
  ('000000000000000000000403', 'tenant_local_cedar', '000000000000000000000103', 'membership_local_cedar_member_2', 'Sam', 'Chen', ARRAY['sam.chen@cedar.example.test'], 'New York, NY', 'Camper', ARRAY['New York University'], ARRAY['2020'], '[{"role":"Analyst","company":"Example Partners","years":"2023-Present"}]'::jsonb, '[]'::jsonb, 'Finance', '{}'::jsonb, '{"email":"members","phone":"private"}'::jsonb, 'Fictional member profile for messaging and events.', 'active'),
  ('000000000000000000000404', 'tenant_local_control', '000000000000000000000201', 'membership_local_control_admin', 'Morgan', 'Director', ARRAY['director@pine-control.example.test'], 'Denver, CO', 'Director', ARRAY['Colorado State University'], ARRAY['2007'], '[]'::jsonb, '[]'::jsonb, 'Non-Profit', '{}'::jsonb, '{"email":"members","phone":"private"}'::jsonb, 'Fictional control-camp director.', 'active'),
  ('000000000000000000000405', 'tenant_local_control', '000000000000000000000202', 'membership_local_control_member', 'Taylor', 'Brooks', ARRAY['member@pine-control.example.test'], 'Boulder, CO', 'Counselor', ARRAY['University of Colorado Boulder'], ARRAY['2019'], '[]'::jsonb, '[]'::jsonb, 'Healthcare', '{}'::jsonb, '{"email":"members","phone":"private"}'::jsonb, 'Fictional control-camp member.', 'active'),
  ('000000000000000000000406', 'tenant_local_fresh', '000000000000000000000301', 'membership_local_fresh_director', 'Jordan', 'Founder', ARRAY['director@fresh-camp.example.test'], 'Chicago, IL', 'Director', ARRAY[]::text[], ARRAY[]::text[], '[]'::jsonb, '[]'::jsonb, 'Education', '{}'::jsonb, '{"email":"private","phone":"private"}'::jsonb, 'Fictional director for the fresh-camp onboarding rehearsal.', 'active');

UPDATE public.users
SET profile_id = CASE id
  WHEN '000000000000000000000101' THEN '000000000000000000000401'
  WHEN '000000000000000000000102' THEN '000000000000000000000402'
  WHEN '000000000000000000000103' THEN '000000000000000000000403'
  WHEN '000000000000000000000201' THEN '000000000000000000000404'
  WHEN '000000000000000000000202' THEN '000000000000000000000405'
  WHEN '000000000000000000000301' THEN '000000000000000000000406'
  ELSE profile_id
END
WHERE id ~ '^[0-9a-f]{24}$';

INSERT INTO public.feature_rollouts (
  id, feature_key, state, kill_switch, tenant_ids, excluded_tenant_ids, config
)
VALUES
  ('rollout_local_director_copilot', 'director_copilot_v1', 'disabled', true, ARRAY['tenant_local_cedar'], ARRAY['tenant_local_control'], '{"environment":"local_staging","synthetic":true}'::jsonb),
  ('rollout_local_email_agent', 'director_email_agent_v1', 'disabled', true, ARRAY['tenant_local_cedar'], ARRAY['tenant_local_control'], '{"environment":"local_staging","synthetic":true,"draftOnly":true}'::jsonb),
  ('rollout_local_ai_search', 'camp_ai_search_v1', 'disabled', true, ARRAY['tenant_local_cedar'], ARRAY['tenant_local_control'], '{"environment":"local_staging","synthetic":true}'::jsonb),
  ('rollout_local_multi_camp', 'multi_camp_identity_v1', 'disabled', true, ARRAY['tenant_local_cedar'], ARRAY['tenant_local_control'], '{"environment":"local_staging","synthetic":true}'::jsonb);

INSERT INTO public.alumni_contacts (
  id, tenant_id, email, first_name, last_name, source, contact_status, tags, camp_years, notes, created_by_user_id
)
VALUES
  ('alumni_local_cedar_1', 'tenant_local_cedar', 'alumni.one@cedar.example.test', 'Avery', 'Alumni', 'local_seed', 'active', '["reunion"]'::jsonb, '["2011","2012"]'::jsonb, 'Synthetic pre-member contact.', '000000000000000000000101'),
  ('alumni_local_cedar_2', 'tenant_local_cedar', 'alumni.two@cedar.example.test', 'Riley', 'Alumni', 'local_seed', 'active', '["newsletter"]'::jsonb, '["2015"]'::jsonb, 'Synthetic pre-member contact.', '000000000000000000000101'),
  ('alumni_local_control_1', 'tenant_local_control', 'alumni@pine-control.example.test', 'Quinn', 'Control', 'local_seed', 'active', '[]'::jsonb, '["2014"]'::jsonb, 'Synthetic control-camp contact.', '000000000000000000000201');

INSERT INTO public.conversations (
  id, tenant_id, type, participant_ids, name, created_by, last_message, members, read_by
)
VALUES (
  '000000000000000000000501',
  'tenant_local_cedar',
  'dm',
  ARRAY['000000000000000000000102','000000000000000000000103'],
  '',
  '000000000000000000000102',
  '{"text":"Looking forward to the reunion rehearsal.","senderId":"000000000000000000000103"}'::jsonb,
  '["000000000000000000000102","000000000000000000000103"]'::jsonb,
  '["000000000000000000000102"]'::jsonb
);

INSERT INTO public.messages (id, tenant_id, conversation_id, sender_id, text, client_message_id)
VALUES
  ('000000000000000000000601', 'tenant_local_cedar', '000000000000000000000501', '000000000000000000000102', 'Welcome to the synthetic Cedar conversation.', 'local-seed-1'),
  ('000000000000000000000602', 'tenant_local_cedar', '000000000000000000000501', '000000000000000000000103', 'Looking forward to the reunion rehearsal.', 'local-seed-2');

INSERT INTO public.forums (id, tenant_id, name, created_by, creator_id, member_ids, moderators, posts_count)
VALUES (
  '000000000000000000000701',
  'tenant_local_cedar',
  'Reunion Planning',
  'Casey Director',
  '000000000000000000000101',
  ARRAY['000000000000000000000101','000000000000000000000102','000000000000000000000103'],
  ARRAY['000000000000000000000101'],
  1
);

INSERT INTO public.forum_posts (id, tenant_id, forum_id, author_id, text)
VALUES (
  '000000000000000000000801',
  'tenant_local_cedar',
  '000000000000000000000701',
  '000000000000000000000102',
  'This fictional post verifies the forum experience without production data.'
);

INSERT INTO public.events (
  id, tenant_id, slug, status, title, summary, body_html, starts_at, ends_at,
  timezone, location_name, location_address, published_at, created_by_user_id, updated_by_user_id
)
VALUES (
  '000000000000000000000901',
  'tenant_local_cedar',
  'fall-reunion-rehearsal',
  'published',
  'Fall Reunion Rehearsal',
  'A synthetic event for end-to-end staging checks.',
  '<p>No real invitations will be sent from local staging.</p>',
  now() + interval '30 days',
  now() + interval '30 days 3 hours',
  'America/New_York',
  'Camp Cedar — Local Staging',
  '1 Example Trail, Testville, ME',
  now(),
  '000000000000000000000101',
  '000000000000000000000101'
);

INSERT INTO public.event_rsvps (
  id, tenant_id, event_id, profile_id, user_id, status
)
VALUES (
  'rsvp_local_cedar_1',
  'tenant_local_cedar',
  '000000000000000000000901',
  '000000000000000000000402',
  '000000000000000000000102',
  'attending'
);

INSERT INTO public.activity_items (
  id, tenant_id, actor_user_id, actor, type, message, target, pinned
)
VALUES
  ('activity_local_cedar_1', 'tenant_local_cedar', '000000000000000000000101', '{"firstName":"Casey","lastName":"Director"}'::jsonb, 'announcement.post', 'Welcome to the isolated local staging network.', '{"type":"tenant","id":"tenant_local_cedar"}'::jsonb, true),
  ('activity_local_control_1', 'tenant_local_control', '000000000000000000000201', '{"firstName":"Morgan","lastName":"Director"}'::jsonb, 'announcement.post', 'Control-camp baseline activity.', '{"type":"tenant","id":"tenant_local_control"}'::jsonb, false);

INSERT INTO public.mobile_notification_preferences (
  id, tenant_id, user_id, push_enabled, categories
)
VALUES
  ('mobile_pref_local_cedar_1', 'tenant_local_cedar', '000000000000000000000102', false, '{"announcements":true,"events":true,"community":true,"account":true,"admin":true}'::jsonb),
  ('mobile_pref_local_control_1', 'tenant_local_control', '000000000000000000000202', false, '{"announcements":true,"events":true,"community":true,"account":true,"admin":true}'::jsonb);

INSERT INTO public.mobile_notifications (
  id, tenant_id, user_id, batch_id, created_by_user_id, kind, category, title, body,
  deep_link, data, delivery
)
VALUES (
  'mobile_notification_local_cedar_1',
  'tenant_local_cedar',
  '000000000000000000000102',
  'local-seed',
  '000000000000000000000101',
  'custom_admin',
  'announcements',
  'Local staging notification',
  'This notification is inbox-only and was never sent to APNS or FCM.',
  '/events/fall-reunion-rehearsal',
  '{"synthetic":true}'::jsonb,
  '{"pushRequested":false,"provider":"none","status":"inbox_only"}'::jsonb
);

-- Giving marketplace rehearsal data. Totals intentionally add up to the
-- headline shown in the member experience: $84,250 from 312 alumni.
INSERT INTO public.giving_causes (
  id, tenant_id, slug, title, short_description, description, why_it_matters,
  category, created_by_user_id, created_by_profile_id, creator_name,
  creator_affiliation, origin, status, approved_by_user_id, approved_at,
  goal_amount_cents, amount_raised_cents, donor_count, featured,
  fundraising_open, is_general_fund, charity_designation_id, start_date, end_date
)
VALUES
  (
    '000000000000000000000a01', 'tenant_local_cedar', 'support-cedar',
    'Support Cedar', 'Give where Cedar needs it most.',
    'Unrestricted gifts give Cedar the flexibility to respond to the camp community’s most important needs throughout the year.',
    'A strong general fund keeps the places, people, and traditions alumni love ready for the next generation.',
    'other', '000000000000000000000101', '000000000000000000000401',
    'Camp Cedar', '', 'official', 'active', '000000000000000000000101', now(),
    0, 3250000, 112, true, true, true, 'general-fund', current_date - 180, null
  ),
  (
    '000000000000000000000a02', 'tenant_local_cedar', 'send-a-camper-to-cedar',
    'Send a Camper to Cedar', 'Open a summer at Cedar to a family who needs a hand.',
    'Camperships cover tuition for children whose families could not otherwise make a Cedar summer possible. Every contribution moves another camper closer to opening day.',
    'The confidence, friendships, and belonging built at camp should not depend on a family’s ability to pay full tuition.',
    'camperships', '000000000000000000000101', '000000000000000000000401',
    'Camp Cedar', '', 'official', 'active', '000000000000000000000101', now(),
    2500000, 1825000, 68, true, true, false, 'campership-fund', current_date - 90, current_date + 120
  ),
  (
    '000000000000000000000a03', 'tenant_local_cedar', 'restore-the-council-ring',
    'Restore the Council Ring', 'Help rebuild seating and lighting for evenings together.',
    'The Council Ring has held songs, stories, awards, and last-night reflections for generations. This project will rebuild the weathered benches, improve the path, and add low-impact lighting.',
    'Restoring the space preserves one of Cedar’s most meaningful traditions while making it safer and more welcoming after dark.',
    'traditions', '000000000000000000000102', '000000000000000000000402',
    'Alex Rivera', 'Counselor • 2016–2019', 'alumni_led', 'active', '000000000000000000000101', now(),
    1250000, 845000, 47, true, true, false, 'council-ring-project', current_date - 45, current_date + 75
  ),
  (
    '000000000000000000000a04', 'tenant_local_cedar', 'new-waterfront-equipment',
    'New Waterfront Equipment', 'Refresh the boats and safety gear that keep the lake moving.',
    'This cause will replace well-loved paddleboards, update personal flotation devices, and add adaptive waterfront equipment for campers with different mobility needs.',
    'The waterfront is where campers learn courage one swim, paddle, and sail at a time.',
    'programs', '000000000000000000000101', '000000000000000000000401',
    'Camp Cedar', '', 'official', 'active', '000000000000000000000101', now(),
    2700000, 1380000, 51, false, true, false, 'waterfront-equipment', current_date - 35, current_date + 105
  ),
  (
    '000000000000000000000a05', 'tenant_local_cedar', 'arts-cabin-renewal',
    'Arts Cabin Renewal', 'A brighter, more flexible home for making things together.',
    'Alumni fully funded new worktables, storage, ventilation, and accessible tools for the arts cabin.',
    'Creative spaces give every camper another way to find their voice.',
    'facilities', '000000000000000000000101', '000000000000000000000401',
    'Camp Cedar', '', 'official', 'completed', '000000000000000000000101', now() - interval '8 months',
    1125000, 1125000, 34, false, false, false, 'arts-cabin-renewal', current_date - 365, current_date - 150
  ),
  (
    '000000000000000000000a06', 'tenant_local_cedar', 'senior-hill-overlook',
    'Renew the Senior Hill Overlook', 'Create a safer gathering place for the final summer group.',
    'The overlook needs a stable path, fresh seating, and thoughtful erosion control before it can host evening gatherings again.',
    'Senior Hill is one of the places where a final Cedar summer becomes a lifelong memory.',
    'facilities', '000000000000000000000102', '000000000000000000000402',
    'Alex Rivera', 'Counselor • 2016–2019', 'alumni_led', 'pending', null, null,
    900000, 0, 0, false, true, false, '', current_date, current_date + 150
  );

INSERT INTO public.giving_donations (
  id, tenant_id, cause_id, provider, provider_donation_id, donor_user_id,
  donor_profile_id, donor_display_name, donor_affiliation, donor_email,
  amount_cents, display_preference, donor_message, status, completed_at
)
VALUES
  ('giving_donation_local_01', 'tenant_local_cedar', '000000000000000000000a03', 'local_mock', 'mock-council-01', '000000000000000000000103', '000000000000000000000403', 'Sam Chen', 'Camper • 2020', 'sam.chen@cedar.example.test', 100000, 'public', 'For the summers that changed my life.', 'succeeded', now() - interval '2 days'),
  ('giving_donation_local_02', 'tenant_local_cedar', '000000000000000000000a03', 'local_mock', 'mock-council-02', null, null, 'Michael R.', 'Alumni • 1998', 'michael@example.test', 50000, 'public', '', 'succeeded', now() - interval '4 days'),
  ('giving_donation_local_03', 'tenant_local_cedar', '000000000000000000000a03', 'local_mock', 'mock-council-03', null, null, '', '', 'anonymous@example.test', 25000, 'anonymous', 'Keep the fire bright.', 'succeeded', now() - interval '6 days'),
  ('giving_donation_local_04', 'tenant_local_cedar', '000000000000000000000a03', 'local_mock', 'mock-council-04', null, null, 'Alex T.', 'Alumni • 2012', 'alex.t@example.test', 10000, 'hide_amount', '', 'succeeded', now() - interval '8 days'),
  ('giving_donation_local_05', 'tenant_local_cedar', '000000000000000000000a02', 'local_mock', 'mock-campership-01', null, null, 'Sarah K.', 'Alumni • 2007', 'sarah@example.test', 100000, 'public', 'Everyone deserves a first Cedar summer.', 'succeeded', now() - interval '3 days');

INSERT INTO public.giving_cause_updates (
  id, tenant_id, cause_id, author_user_id, title, body, milestone_type, published_at
)
VALUES
  ('giving_update_local_01', 'tenant_local_cedar', '000000000000000000000a03', '000000000000000000000102', 'Two-thirds of the way there', 'We crossed $8,000 this week. Thank you to everyone helping bring the Council Ring back to life.', 'percent', now() - interval '5 days'),
  ('giving_update_local_02', 'tenant_local_cedar', '000000000000000000000a03', '000000000000000000000101', 'Plans approved', 'The camp team approved the new bench layout and low-impact path lighting. Work can begin as soon as the campaign is funded.', 'update', now() - interval '18 days'),
  ('giving_update_local_03', 'tenant_local_cedar', '000000000000000000000a05', '000000000000000000000101', 'Funded by Cedar alumni', 'The Arts Cabin Renewal is fully funded. Installation begins after closing day.', 'completed', now() - interval '150 days');

COMMIT;
