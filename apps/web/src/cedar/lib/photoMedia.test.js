import { describe, expect, it } from "vitest";
import { formatDuration, isVideoFile, isVideoPost } from "./photoMedia.js";

function fileStub(name, type) {
  return { name, type };
}

describe("telling a clip from a still", () => {
  it("trusts an explicit video MIME type", () => {
    expect(isVideoFile(fileStub("clip.mp4", "video/mp4"))).toBe(true);
    expect(isVideoFile(fileStub("clip.mov", "video/quicktime"))).toBe(true);
    expect(isVideoFile(fileStub("clip.webm", "video/webm"))).toBe(true);
  });

  it("treats an explicit image MIME type as a still", () => {
    expect(isVideoFile(fileStub("photo.jpg", "image/jpeg"))).toBe(false);
    expect(isVideoFile(fileStub("photo.png", "image/png"))).toBe(false);
  });

  // The regression this module was extracted for: a browser that hands back no
  // MIME type used to send the clip down the still path, where it was posted as
  // an image the feed could only render as a broken <img>.
  it("falls back to the extension when the browser gives no MIME type", () => {
    expect(isVideoFile(fileStub("clip.mov", ""))).toBe(true);
    expect(isVideoFile(fileStub("CLIP.MOV", ""))).toBe(true);
    expect(isVideoFile(fileStub("clip.mp4", ""))).toBe(true);
    expect(isVideoFile(fileStub("clip.webm", ""))).toBe(true);
  });

  it("does not guess video from the name once a type is present", () => {
    // An explicit type is the browser's answer; only silence justifies guessing.
    expect(isVideoFile(fileStub("clip.mov", "image/jpeg"))).toBe(false);
  });

  it("leaves untyped stills and unknown extensions alone", () => {
    expect(isVideoFile(fileStub("photo.jpg", ""))).toBe(false);
    expect(isVideoFile(fileStub("archive.zip", ""))).toBe(false);
    expect(isVideoFile(fileStub("noextension", ""))).toBe(false);
    expect(isVideoFile(null)).toBe(false);
    expect(isVideoFile(undefined)).toBe(false);
  });
});

describe("reading a post's media kind", () => {
  it("recognises a video post", () => {
    expect(isVideoPost({ mediaType: "video" })).toBe(true);
    expect(isVideoPost({ mediaType: "VIDEO" })).toBe(true);
  });

  it("treats anything else, including rows written before videos existed, as a still", () => {
    expect(isVideoPost({ mediaType: "image" })).toBe(false);
    expect(isVideoPost({})).toBe(false);
    expect(isVideoPost(null)).toBe(false);
  });
});

describe("clip duration display", () => {
  it("formats as minutes and padded seconds", () => {
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(600)).toBe("10:00");
  });

  it("rounds to the nearest second", () => {
    expect(formatDuration(9.6)).toBe("0:10");
  });

  it("renders nothing when there is no usable duration", () => {
    // A clip the browser could not measure reports 0 or Infinity; the pill hides
    // rather than showing "0:00" or "NaN:NaN".
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(Infinity)).toBe("");
    expect(formatDuration(NaN)).toBe("");
    expect(formatDuration(undefined)).toBe("");
    expect(formatDuration(-5)).toBe("");
  });
});
