import { readObjectKeyFromUrl } from "../src/services/objectStorage.js";

/**
 * The photo stream stores a URL the client hands back rather than a key, so the
 * only thing standing between the feed and an arbitrary <img src> is proving
 * that URL names an object we put in our own bucket. These are the shapes that
 * have to be recognised, and the ones that must not be.
 */
const PUBLIC_BASE = "https://pub-abc123.r2.dev";
const PROXY_BASE = "https://api.example.com/api/t/cedar/uploads/object";
const opts = { publicBaseUrl: PUBLIC_BASE, objectProxyBaseUrl: PROXY_BASE };

describe("readObjectKeyFromUrl", () => {
  test("recovers a key from the public CDN form", () => {
    expect(readObjectKeyFromUrl(`${PUBLIC_BASE}/cedar/photos/u1/1773-abc.jpg`, opts)).toBe(
      "cedar/photos/u1/1773-abc.jpg"
    );
  });

  test("recovers a key from the proxy form", () => {
    const url = `${PROXY_BASE}?key=${encodeURIComponent("cedar/photos/u1/1773-abc.jpg")}`;
    expect(readObjectKeyFromUrl(url, opts)).toBe("cedar/photos/u1/1773-abc.jpg");
  });

  test("decodes percent-escaped path segments", () => {
    expect(readObjectKeyFromUrl(`${PUBLIC_BASE}/cedar/photos/u1/a%20b.jpg`, opts)).toBe(
      "cedar/photos/u1/a b.jpg"
    );
  });

  test("refuses a host that is not ours", () => {
    expect(readObjectKeyFromUrl("https://attacker.example/cedar/photos/u1/x.jpg", opts)).toBe("");
    // Same path, different origin -- the whole point of the check.
    expect(readObjectKeyFromUrl("https://pub-abc123.r2.dev.evil.test/cedar/photos/x.jpg", opts)).toBe("");
  });

  test("refuses junk, relative, and non-http values", () => {
    for (const value of ["", "   ", "not a url", "/cedar/photos/u1/x.jpg", "javascript:alert(1)"]) {
      expect(readObjectKeyFromUrl(value, opts)).toBe("");
    }
  });

  test("refuses the proxy origin on a different path", () => {
    const url = "https://api.example.com/api/t/other/uploads/object?key=cedar/photos/u1/x.jpg";
    expect(readObjectKeyFromUrl(url, opts)).toBe("");
  });

  test("returns nothing when no bases are configured", () => {
    expect(readObjectKeyFromUrl(`${PUBLIC_BASE}/cedar/photos/u1/x.jpg`, {})).toBe("");
  });
});

/**
 * The prefix rule the photo route applies on top of the key, kept here so the
 * cross-scope cases are pinned even though the route builds the string inline.
 */
describe("photo scope prefix", () => {
  const photoPrefix = (slug) => `${slug.toLowerCase()}/photos/`;

  test("accepts this camp's own photo objects", () => {
    const key = readObjectKeyFromUrl(`${PUBLIC_BASE}/cedar/photos/u1/x.jpg`, opts);
    expect(key.toLowerCase().startsWith(photoPrefix("cedar"))).toBe(true);
  });

  test("rejects another camp's objects and other scopes in this camp", () => {
    const foreign = readObjectKeyFromUrl(`${PUBLIC_BASE}/other/photos/u1/x.jpg`, opts);
    expect(foreign.toLowerCase().startsWith(photoPrefix("cedar"))).toBe(false);

    // A chat attachment is under this camp but is not a photo-stream object.
    const chat = readObjectKeyFromUrl(`${PUBLIC_BASE}/cedar/chat/c1/x.jpg`, opts);
    expect(chat.toLowerCase().startsWith(photoPrefix("cedar"))).toBe(false);
  });
});
