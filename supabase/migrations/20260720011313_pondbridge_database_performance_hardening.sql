BEGIN;

-- Tenant-first indexes support application queries but do not cover reverse
-- foreign-key validation. These leading-column indexes keep deletes and
-- relationship updates predictable as camp data grows.
CREATE INDEX IF NOT EXISTS idx_messages_conversation_fk
  ON public.messages (conversation_id);
CREATE INDEX IF NOT EXISTS idx_forum_posts_forum_fk
  ON public.forum_posts (forum_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_profile_fk
  ON public.event_rsvps (profile_id);
CREATE INDEX IF NOT EXISTS idx_event_rsvps_user_fk
  ON public.event_rsvps (user_id);
CREATE INDEX IF NOT EXISTS idx_event_messages_event_fk
  ON public.event_messages (event_id);
CREATE INDEX IF NOT EXISTS idx_mobile_notifications_user_fk
  ON public.mobile_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_notification_devices_user_fk
  ON public.mobile_notification_devices (user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_notification_preferences_user_fk
  ON public.mobile_notification_preferences (user_id);

COMMIT;
