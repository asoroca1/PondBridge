-- A phone clip is usually HEVC in a QuickTime container, which only Safari can
-- decode, so a video post now points at a Cloudflare Stream encode instead of
-- the raw upload.
--
-- image_url still holds the original in R2: it is what Stream ingests from, and
-- it is the fallback a Safari viewer can still play while an encode is in
-- flight. The new columns carry the encode -- its id, how far along it is, and
-- the HLS manifest to play once it is ready.

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS stream_uid text;

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS stream_status text;

ALTER TABLE public.photos
  ADD COLUMN IF NOT EXISTS stream_playback_url text;

ALTER TABLE public.photos
  DROP CONSTRAINT IF EXISTS photos_stream_status_check;

-- A still leaves this null; only a video ever carries a status.
ALTER TABLE public.photos
  ADD CONSTRAINT photos_stream_status_check
    CHECK (stream_status IS NULL OR stream_status IN ('pending', 'processing', 'ready', 'error'));

-- The webhook arrives knowing only the Stream uid, so that lookup needs an
-- index. Videos are a small slice of the table, hence the partial index.
CREATE INDEX IF NOT EXISTS photos_stream_uid_idx
  ON public.photos (stream_uid)
  WHERE stream_uid IS NOT NULL;
