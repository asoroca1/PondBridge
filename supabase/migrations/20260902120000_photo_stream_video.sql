-- The photo stream carries videos as well as stills.
--
-- A video post reuses the existing row: image_url holds the playable media and
-- thumb_url holds a poster frame captured at upload time, so every feed read
-- keeps working unchanged. Two new columns tell the client which of the two it
-- is looking at, and how long the clip runs.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'image';

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS duration_seconds numeric NOT NULL DEFAULT 0;

ALTER TABLE public.photos
  DROP CONSTRAINT IF EXISTS photos_media_type_check;

ALTER TABLE public.photos
  ADD CONSTRAINT photos_media_type_check
    CHECK (media_type IN ('image', 'video'));
