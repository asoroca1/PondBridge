import { afterEach, describe, expect, it } from "vitest";
import { getNativeAppId, getNativePlatform, isNativeApp } from "./nativeApp.js";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe("native app platform identity", () => {
  it("keeps normal browsers on the web path", () => {
    globalThis.window = {};
    expect(getNativePlatform()).toBe("web");
    expect(getNativeAppId()).toBe("");
    expect(isNativeApp()).toBe(false);
  });

  it.each([
    ["ios", "com.pondbridge.ios"],
    ["android", "com.pondbridge.android"]
  ])("registers %s with its real application id", (platform, appId) => {
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => platform
      }
    };

    expect(getNativePlatform()).toBe(platform);
    expect(getNativeAppId()).toBe(appId);
    expect(isNativeApp()).toBe(true);
  });

  it("does not trust an unknown bridge platform", () => {
    globalThis.window = {
      Capacitor: {
        isNativePlatform: () => true,
        getPlatform: () => "desktop"
      }
    };

    expect(getNativePlatform()).toBe("web");
    expect(isNativeApp()).toBe(false);
  });
});
