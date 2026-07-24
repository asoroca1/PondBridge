import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHUNK_UPDATE_EVENT,
  installChunkRecoveryListeners,
  isLikelyMissingChunkError,
  loadLatestBuild,
  readChunkUpdateNotice,
  recoverFromMissingChunk
} from "./chunkRecovery.js";

function createWindowStub() {
  const listeners = new Map();
  const storage = new Map();
  const assign = vi.fn();

  return {
    __PONDBRIDGE_BUILD__: "test-build",
    location: {
      href: "https://app.pondbridgealumni.com/t/camp/home?view=feed#latest",
      pathname: "/t/camp/home",
      search: "?view=feed",
      hash: "#latest",
      assign
    },
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    CustomEvent: class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    addEventListener(type, callback) {
      const group = listeners.get(type) || new Set();
      group.add(callback);
      listeners.set(type, group);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
    },
    emit(type, event) {
      for (const callback of listeners.get(type) || []) callback(event);
    },
    assign
  };
}

describe("chunk update stability", () => {
  beforeEach(() => {
    globalThis.window = createWindowStub();
  });

  afterEach(() => {
    delete globalThis.window;
  });

  it("recognizes lazy asset failures without treating ordinary network errors as chunks", () => {
    expect(isLikelyMissingChunkError(new Error("Failed to fetch dynamically imported module"))).toBe(true);
    expect(isLikelyMissingChunkError(new Error("The API request failed"))).toBe(false);
  });

  it("reports a missing chunk without reloading or navigating the document", () => {
    const events = [];
    window.addEventListener(CHUNK_UPDATE_EVENT, (event) => events.push(event.detail));

    expect(recoverFromMissingChunk(new Error("ChunkLoadError: Loading chunk 12 failed"))).toBe(true);

    expect(window.assign).not.toHaveBeenCalled();
    expect(events).toHaveLength(1);
    expect(events[0].route).toBe("/t/camp/home?view=feed#latest");
    expect(readChunkUpdateNotice()?.build).toBe("test-build");
  });

  it("keeps global error listeners non-destructive", () => {
    installChunkRecoveryListeners();
    window.emit("unhandledrejection", {
      reason: new Error("Importing a module script failed")
    });

    expect(readChunkUpdateNotice()).toBeTruthy();
    expect(window.assign).not.toHaveBeenCalled();
  });

  it("loads the latest build only after an explicit action", () => {
    loadLatestBuild();

    expect(window.assign).toHaveBeenCalledTimes(1);
    expect(window.assign.mock.calls[0][0]).toMatch(/^https:\/\/app\.pondbridgealumni\.com\/t\/camp\/home\?/);
    expect(window.assign.mock.calls[0][0]).toContain("pb_update=");
  });
});
