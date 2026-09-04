import { describe, it, expect } from "vitest";
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_MAX_BACKOFF_MS,
  createPollPlanner
} from "./pollPlanner.js";

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

describe("poll planner", () => {
  it("does no work while the tab is hidden", () => {
    const planner = createPollPlanner({ isVisible: () => false });
    expect(planner.shouldRun()).toBe(false);
  });

  it("does no work while offline", () => {
    const planner = createPollPlanner({ isOnline: () => false });
    expect(planner.shouldRun()).toBe(false);
  });

  it("works when visible and online", () => {
    expect(createPollPlanner().shouldRun()).toBe(true);
  });

  it("widens the gap while the API keeps failing, and caps it", () => {
    const planner = createPollPlanner({ intervalMs: 25_000, maxBackoffMs: 300_000 });
    expect(planner.delayMs()).toBe(25_000);

    planner.noteRun(false);
    expect(planner.delayMs()).toBe(50_000);
    planner.noteRun(false);
    expect(planner.delayMs()).toBe(100_000);

    for (let i = 0; i < 20; i += 1) planner.noteRun(false);
    expect(planner.delayMs()).toBe(300_000);
  });

  it("returns to the normal interval as soon as one call succeeds", () => {
    const planner = createPollPlanner({ intervalMs: 25_000 });
    planner.noteRun(false);
    planner.noteRun(false);
    expect(planner.failureCount()).toBe(2);

    planner.noteRun(true);
    expect(planner.failureCount()).toBe(0);
    expect(planner.delayMs()).toBe(25_000);
  });

  it("refreshes on the first wake, before anything has run", () => {
    expect(createPollPlanner().isStale()).toBe(true);
  });

  it("does not spend a request when the tab was only away a moment", () => {
    const c = clock();
    const planner = createPollPlanner({ intervalMs: 25_000, now: c.now });
    planner.noteRun(true);

    c.advance(2_000);
    expect(planner.isStale()).toBe(false);

    c.advance(23_000);
    expect(planner.isStale()).toBe(true);
  });

  it("ships with a sane interval and cap", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(25_000);
    expect(DEFAULT_MAX_BACKOFF_MS).toBeGreaterThan(DEFAULT_POLL_INTERVAL_MS);
  });
});
