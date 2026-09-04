import { describe, expect, it } from "vitest";

import {
  isProcessingPost,
  isStreamErrorPost,
  isVideoFile,
  isVideoPost,
  videoSources
} from "./photoMedia.js";

describe("telling a clip from a still", () => {
  it("trusts a video MIME type", () => {
    expect(isVideoFile({ type: "video/quicktime", name: "IMG_6854.MOV" })).toBe(true);
    expect(isVideoFile({ type: "image/jpeg", name: "photo.jpg" })).toBe(false);
  });

  it("falls back to the extension when the browser reports no type", () => {
    // Safari and "All Files" pickers both hand over a .mov with an empty type.
    expect(isVideoFile({ type: "", name: "IMG_6854.MOV" })).toBe(true);
    expect(isVideoFile({ type: "", name: "notes.txt" })).toBe(false);
  });
});

describe("choosing where a clip plays from", () => {
  it("prefers the Stream encode, the only source every browser decodes", () => {
    const sources = videoSources({
      mediaType: "video",
      streamStatus: "ready",
      playbackUrl: "https://customer-xyz.cloudflarestream.com/uid/manifest/video.m3u8",
      imageUrl: "https://media.example.com/IMG_6854.MOV"
    });
    expect(sources.hlsUrl).toContain("manifest/video.m3u8");
    expect(sources.isProcessing).toBe(false);
  });

  it("keeps the original upload as the fallback for a post made before Stream", () => {
    const sources = videoSources({
      mediaType: "video",
      imageUrl: "https://media.example.com/old-clip.mp4"
    });
    expect(sources.hlsUrl).toBe("");
    expect(sources.originalUrl).toBe("https://media.example.com/old-clip.mp4");
    // There is something to play, so this is not a processing placeholder.
    expect(sources.isProcessing).toBe(false);
  });
});

describe("a clip's encode status", () => {
  it("reads pending and processing as still working", () => {
    expect(isProcessingPost({ mediaType: "video", streamStatus: "pending" })).toBe(true);
    expect(isProcessingPost({ mediaType: "video", streamStatus: "processing" })).toBe(true);
  });

  it("reads ready and error as finished", () => {
    expect(isProcessingPost({ mediaType: "video", streamStatus: "ready" })).toBe(false);
    expect(isProcessingPost({ mediaType: "video", streamStatus: "error" })).toBe(false);
    expect(isStreamErrorPost({ mediaType: "video", streamStatus: "error" })).toBe(true);
  });

  it("never treats a still as processing, whatever the status says", () => {
    expect(isProcessingPost({ mediaType: "image", streamStatus: "processing" })).toBe(false);
    expect(isVideoPost({ mediaType: "image" })).toBe(false);
  });

  it("treats a post from before Stream existed as finished, not stuck", () => {
    // These rows carry no status at all and must still show a play badge.
    expect(isProcessingPost({ mediaType: "video" })).toBe(false);
    expect(isProcessingPost({ mediaType: "video", streamStatus: "" })).toBe(false);
  });
});
