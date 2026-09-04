import { jest } from "@jest/globals";
import { createReadinessProbe } from "../src/services/readiness.js";

/**
 * `/health` always answered ok and only described configuration, so a process
 * that could not reach its database still looked healthy and kept taking
 * traffic. These tests hold the properties that make /readyz worth trusting:
 * it asks the database something, it gives up rather than hanging, and it
 * cannot become load in its own right.
 */

function clientReturning(result, { delayMs = 0, clock = null } = {}) {
  const calls = { count: 0 };
  const client = {
    from() {
      return {
        select() {
          calls.count += 1;
          if (!delayMs) return Promise.resolve(result);
          // Never resolves on its own; the test's fake clock decides.
          return new Promise((resolve) => {
            if (clock) clock.pending.push({ at: clock.now() + delayMs, resolve, result });
          });
        }
      };
    }
  };
  return { client, calls };
}

function fakeClock(start = 1000) {
  let t = start;
  const clock = {
    pending: [],
    now: () => t,
    advance(ms) {
      t += ms;
      for (const job of clock.pending.splice(0)) {
        if (job.at <= t) job.resolve(job.result);
        else clock.pending.push(job);
      }
    }
  };
  return clock;
}

describe("readiness probe", () => {
  it("reports ready when the database answers", async () => {
    const { client, calls } = clientReturning({ error: null, count: 3 });
    const check = createReadinessProbe({ getClient: () => client });

    const result = await check();
    expect(result.ready).toBe(true);
    expect(result.error).toBe("");
    expect(calls.count).toBe(1);
  });

  it("reports not ready, with the reason, when the database errors", async () => {
    const { client } = clientReturning({ error: { message: "connection refused" } });
    const check = createReadinessProbe({ getClient: () => client });

    const result = await check();
    expect(result.ready).toBe(false);
    expect(result.error).toMatch(/connection refused/);
  });

  it("fails on its own deadline instead of hanging on a stuck database", async () => {
    jest.useFakeTimers();
    const client = { from: () => ({ select: () => new Promise(() => {}) }) };
    const check = createReadinessProbe({ getClient: () => client, timeoutMs: 2000 });

    const pending = check();
    jest.advanceTimersByTime(2001);
    const result = await pending;

    expect(result.ready).toBe(false);
    expect(result.error).toMatch(/exceeded 2000ms/);
    jest.useRealTimers();
  });

  it("caches its answer so frequent probes are not their own load", async () => {
    const clock = fakeClock();
    const { client, calls } = clientReturning({ error: null });
    const check = createReadinessProbe({
      getClient: () => client,
      cacheMs: 5000,
      now: clock.now
    });

    await check();
    await check();
    await check();
    expect(calls.count).toBe(1);

    clock.advance(5001);
    await check();
    expect(calls.count).toBe(2);
  });

  it("collapses concurrent probes into one database round trip", async () => {
    const clock = fakeClock();
    const { client, calls } = clientReturning({ error: null }, { delayMs: 10, clock });
    const check = createReadinessProbe({ getClient: () => client, now: clock.now });

    const all = Promise.all([check(), check(), check()]);
    clock.advance(10);
    const results = await all;

    expect(calls.count).toBe(1);
    expect(results.every((r) => r.ready)).toBe(true);
  });
});
