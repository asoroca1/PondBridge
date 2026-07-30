import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attemptAutomaticChunkRecovery,
  CHUNK_UPDATE_EVENT,
  cleanChunkRecoveryUrl,
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
  const replace = vi.fn();
  const replaceState = vi.fn();

  return {
    __PONDBRIDGE_BUILD__: "test-build",
    location: {
      href: "https://app.pondbridgealumni.com/t/camp/home?view=feed#latest",
      pathname: "/t/camp/home",
      search: "?view=feed",
      hash: "#latest",
      assign,
      replace
    },
    history: {
      state: { source: "test" },
      replaceState
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
    vi.stubGlobal("window", createWindowStub());
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("automatically recovers an actively rendered stale route once", () => {
    const error = new Error("Importing a module script failed");

    expect(attemptAutomaticChunkRecovery(error)).toBe(true);
    expect(window.location.replace).toHaveBeenCalledTimes(1);
    expect(window.location.replace.mock.calls[0][0]).toContain(
      "/t/camp/home?view=feed&pb_update="
    );
    expect(window.location.replace.mock.calls[0][0]).toContain("#latest");

    expect(attemptAutomaticChunkRecovery(error)).toBe(false);
    expect(window.location.replace).toHaveBeenCalledTimes(1);
  });

  it("does not automatically reload an offline screen", () => {
    vi.stubGlobal("navigator", { onLine: false });

    expect(
      attemptAutomaticChunkRecovery(
        new Error("Failed to fetch dynamically imported module")
      )
    ).toBe(false);
    expect(readChunkUpdateNotice()).toBeTruthy();
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("cleans the temporary recovery parameter without navigating", () => {
    window.location.href =
      "https://app.pondbridgealumni.com/t/camp/home?view=feed&pb_update=123#latest";

    cleanChunkRecoveryUrl();

    expect(window.history.replaceState).toHaveBeenCalledWith(
      { source: "test" },
      "",
      "/t/camp/home?view=feed#latest"
    );
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("loads the latest build only after an explicit action", () => {
    loadLatestBuild();

    expect(window.assign).toHaveBeenCalledTimes(1);
    expect(window.assign.mock.calls[0][0]).toMatch(/^https:\/\/app\.pondbridgealumni\.com\/t\/camp\/home\?/);
    expect(window.assign.mock.calls[0][0]).toContain("pb_update=");
  });
});
