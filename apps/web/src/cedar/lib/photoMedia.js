/**
 * Telling a photo-stream post's media apart, in one place.
 *
 * The feed, the lightbox and the upload modal all have to agree on whether they
 * are looking at a still or a clip, and the answer is less obvious than it
 * looks: a browser does not always give a File a usable MIME type.
 */

// The extensions the API infers a video type from, kept in step with
// assertPhotoStreamContentType so the two ends never disagree about a file.
export const VIDEO_EXTENSION_RE = /\.(mp4|mov|webm)$/i;

export function isVideoFile(file) {
  if (!file) return false;
  const type = String(file.type || "").toLowerCase();
  if (type.startsWith("video/")) return true;
  if (type) return false;
  // Some browsers report an empty type for .mov, and anything chosen through an
  // "All Files" picker arrives that way too. Without this fallback the clip goes
  // down the still-image path and posts as a broken <img> the feed cannot render.
  return VIDEO_EXTENSION_RE.test(String(file.name || ""));
}

export function isVideoPost(post) {
  return String(post?.mediaType || "").toLowerCase() === "video";
}

export function formatDuration(seconds) {
  const value = Number(seconds);
  // A browser reports Infinity for a clip it has not finished measuring, which
  // would otherwise render a pill reading "Infinity:NaN".
  if (!Number.isFinite(value) || value <= 0) return "";
  const total = Math.round(value);
  if (!total) return "";
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
