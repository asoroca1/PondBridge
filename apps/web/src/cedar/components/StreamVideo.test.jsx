import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import StreamVideo from "./StreamVideo.jsx";

/**
 * These assert the markup the player starts from. Attaching the manifest is an
 * effect, so what matters here is that the initial render does not also point a
 * `src` at the original file -- that would load the clip twice on Safari and
 * play the undecodable original on Chrome.
 */
describe("the clip player's initial markup", () => {
  it("leaves src off when there is a manifest to attach", () => {
    const html = renderToStaticMarkup(
      <StreamVideo
        hlsUrl="https://customer-xyz.cloudflarestream.com/uid/manifest/video.m3u8"
        fallbackSrc="https://media.example.com/IMG_6854.MOV"
        poster="https://media.example.com/cover.jpg"
      />
    );

    expect(html).not.toContain("IMG_6854.MOV");
    expect(html).toContain('poster="https://media.example.com/cover.jpg"');
  });

  it("plays the original when there is no manifest, so old posts still work", () => {
    const html = renderToStaticMarkup(
      <StreamVideo fallbackSrc="https://media.example.com/old-clip.mp4" />
    );
    expect(html).toContain('src="https://media.example.com/old-clip.mp4"');
  });

  it("stays inline on iOS rather than taking over the screen", () => {
    const html = renderToStaticMarkup(<StreamVideo fallbackSrc="https://media.example.com/a.mp4" />);
    expect(html).toContain("playsInline");
    expect(html).toContain('preload="metadata"');
  });

  it("renders nothing to play when it has neither source", () => {
    const html = renderToStaticMarkup(<StreamVideo />);
    expect(html).not.toContain("src=");
    expect(html).not.toContain("poster=");
  });
});
