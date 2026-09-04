import { useEffect, useRef, useState } from "react";

/**
 * Plays a Cloudflare Stream clip in any browser.
 *
 * Safari decodes HLS natively, so it just gets the manifest. Everyone else
 * needs Media Source Extensions driven by hls.js, which is imported only when
 * a clip actually plays -- a member who never opens a video never downloads it.
 *
 * `fallbackSrc` is the original upload. It is what a post made before Stream
 * existed still plays from, and the last resort if the manifest fails.
 */
export default function StreamVideo({
  hlsUrl = "",
  fallbackSrc = "",
  poster = "",
  className = "",
  controls = true,
  autoPlay = false,
  ...videoProps
}) {
  const videoRef = useRef(null);
  const [useFallback, setUseFallback] = useState(false);

  const manifest = useFallback ? "" : String(hlsUrl || "");

  useEffect(() => {
    setUseFallback(false);
  }, [hlsUrl, fallbackSrc]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !manifest) return undefined;

    // Safari and iOS play HLS from a plain src; attaching hls.js there would
    // fight the native player rather than help it.
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = manifest;
      return undefined;
    }

    let cancelled = false;
    let hls = null;

    import("hls.js")
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setUseFallback(true);
          return;
        }
        hls = new Hls({ enableWorker: true });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          // Only a fatal error is worth abandoning the manifest for; hls.js
          // recovers from the rest on its own.
          if (data?.fatal) setUseFallback(true);
        });
        hls.loadSource(manifest);
        hls.attachMedia(video);
      })
      .catch(() => {
        if (!cancelled) setUseFallback(true);
      });

    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [manifest]);

  return (
    <video
      ref={videoRef}
      className={className}
      // A native-HLS browser gets its src from the effect above, so setting one
      // here too would load the clip twice.
      src={manifest ? undefined : fallbackSrc || undefined}
      poster={poster || undefined}
      controls={controls}
      autoPlay={autoPlay}
      playsInline
      preload="metadata"
      onError={() => {
        if (manifest) setUseFallback(true);
      }}
      {...videoProps}
    />
  );
}
