import crypto from "node:crypto";

const WEBHOOK_SECRET = "test-stream-webhook-secret";

process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET = WEBHOOK_SECRET;

const { toStreamState, verifyWebhookSignature, STREAM_STATUS } = await import(
  "../src/services/cloudflareStream.js"
);

function sign(body, { secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const sig = crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `time=${timestamp},sig1=${sig}`;
}

describe("reading a Stream video's state", () => {
  it("counts a video as ready as soon as one quality level exists", () => {
    // Waiting for every rendition would leave a watchable post looking stuck.
    const state = toStreamState({
      uid: "abc123",
      readyToStream: true,
      status: { state: "inprogress", pctComplete: 40 },
      playback: { hls: "https://customer-xyz.cloudflarestream.com/abc123/manifest/video.m3u8" },
      duration: 12.5
    });

    expect(state.streamStatus).toBe(STREAM_STATUS.READY);
    expect(state.streamPlaybackUrl).toContain("manifest/video.m3u8");
    expect(state.durationSeconds).toBe(12.5);
  });

  it("keeps a still-encoding video out of the ready state", () => {
    const state = toStreamState({
      uid: "abc123",
      readyToStream: false,
      status: { state: "inprogress" }
    });
    expect(state.streamStatus).toBe(STREAM_STATUS.PROCESSING);
    expect(state.streamPlaybackUrl).toBe("");
  });

  it("carries Stream's own reason through on a failed encode", () => {
    const state = toStreamState({
      uid: "abc123",
      status: { state: "error", errorReasonText: "The file is not a valid video" }
    });
    expect(state.streamStatus).toBe(STREAM_STATUS.ERROR);
    expect(state.streamError).toBe("The file is not a valid video");
  });

  it("reports a zero duration rather than a negative or missing one", () => {
    expect(toStreamState({ uid: "a", duration: -1 }).durationSeconds).toBe(0);
    expect(toStreamState({ uid: "a" }).durationSeconds).toBe(0);
  });
});

describe("verifying a Stream webhook", () => {
  const body = JSON.stringify({ uid: "abc123", readyToStream: true });

  it("accepts a signature over the exact bytes that were sent", () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
    expect(verifyWebhookSignature(Buffer.from(body), sign(body))).toBe(true);
  });

  it("rejects a body that changed after it was signed", () => {
    const header = sign(body);
    expect(verifyWebhookSignature(`${body} `, header)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, { secret: "not-the-secret" }))).toBe(false);
  });

  it("rejects a replayed signature once it falls outside the tolerance", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhookSignature(body, sign(body, { timestamp: old }))).toBe(false);
  });

  it("rejects a malformed or absent header rather than throwing", () => {
    expect(verifyWebhookSignature(body, "")).toBe(false);
    expect(verifyWebhookSignature(body, "garbage")).toBe(false);
    expect(verifyWebhookSignature(body, "time=123")).toBe(false);
    // A short hex string must not blow up the constant-time comparison.
    expect(verifyWebhookSignature(body, "time=123,sig1=ab")).toBe(false);
  });
});
