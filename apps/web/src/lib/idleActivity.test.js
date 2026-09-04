import { describe, it, expect, vi } from "vitest";
import { createIdleWatcher } from "./idleActivity.js";

/**
 * The point of this module is that recording activity costs one assignment.
 * These tests pin the decisions it makes, and the two that are easy to get
 * wrong: a warning must not repeat every check, and a tab that was suspended
 * past the whole window must log out rather than warn about a session that is
 * already over.
 */

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const MINUTE = 60_000;

function watcher({ timeoutMs = 60 * MINUTE, warningMs = 55 * MINUTE } = {}) {
  const c = clock();
  const onWarn = vi.fn();
  const onTimeout = vi.fn();
  const w = createIdleWatcher({ timeoutMs, warningMs, onWarn, onTimeout, now: c.now });
  return { c, w, onWarn, onTimeout };
}

describe("idle watcher", () => {
  it("stays quiet while the user is inside the window", () => {
    const { c, w, onWarn, onTimeout } = watcher();
    c.advance(30 * MINUTE);
    expect(w.check()).toBe("active");
    expect(onWarn).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("warns once, not on every check", () => {
    const { c, w, onWarn } = watcher();
    c.advance(56 * MINUTE);
    expect(w.check()).toBe("warned");
    expect(w.check()).toBe("already_warned");
    c.advance(MINUTE);
    expect(w.check()).toBe("already_warned");
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it("logs out once, not on every check", () => {
    const { c, w, onTimeout } = watcher();
    c.advance(61 * MINUTE);
    expect(w.check()).toBe("timed_out");
    expect(w.check()).toBe("already_timed_out");
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("logs out rather than warning when a suspended tab wakes up past the window", () => {
    const { c, w, onWarn, onTimeout } = watcher();
    c.advance(90 * MINUTE);
    expect(w.check()).toBe("timed_out");
    expect(onWarn).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("treats activity as a full reset, including an already-issued warning", () => {
    const { c, w, onWarn } = watcher();
    c.advance(56 * MINUTE);
    expect(w.check()).toBe("warned");

    w.noteActivity();
    c.advance(MINUTE);
    expect(w.check()).toBe("active");

    c.advance(55 * MINUTE);
    expect(w.check()).toBe("warned");
    expect(onWarn).toHaveBeenCalledTimes(2);
  });

  it("does nothing at all when no timeout is configured", () => {
    const { c, w, onWarn, onTimeout } = watcher({ timeoutMs: 0 });
    c.advance(10_000 * MINUTE);
    expect(w.check()).toBe("disabled");
    expect(onWarn).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("records activity without scheduling anything", () => {
    const { c, w } = watcher();
    c.advance(5 * MINUTE);
    w.noteActivity();
    expect(w.idleFor()).toBe(0);
    expect(w.getLastActivityAt()).toBe(5 * MINUTE);
  });
});
