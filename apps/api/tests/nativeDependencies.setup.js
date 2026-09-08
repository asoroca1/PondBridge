import { jest } from "@jest/globals";

// sanitize-html 2.17.7 depends on ESM htmlparser2. Jest 29 cannot require ESM,
// so the environment supplies the real package loaded with Node >=22.12.
jest.unstable_mockModule("sanitize-html", () => ({ default: globalThis.__pondbridgeNativeSanitizeHtml }));
