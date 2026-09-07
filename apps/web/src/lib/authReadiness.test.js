import { afterEach, describe, expect, test, vi } from "vitest";
import {
  armAuthBootstrap,
  isAuthBootstrapPending,
  resetAuthReadiness,
  settleAuthBootstrap,
  whenAuthSettled
} from "./authReadiness.js";

/**
 * The gate exists so that nothing authenticated leaves the browser while the
 * in-memory token is still being restored. A request that lost that race went
 * out with no Authorization header, earned a 401, and got the member signed out
 * and reloaded.
 *
 * The property that matters most is the last one: the gate must never be the
 * reason the app sits there loading nothing.
 */

afterEach(() => {
  resetAuthReadiness();
  vi.useRealTimers();
});

describe("the auth readiness gate", () => {
  test("does not wait when nothing armed it", async () => {
    await expect(whenAuthSettled()).resolves.toBeUndefined();
    expect(isAuthBootstrapPending()).toBe(false);
  });

  test("holds a caller while the bootstrap is in flight, and releases it", async () => {
    armAuthBootstrap();
    expect(isAuthBootstrapPending()).toBe(true);

    let released = false;
    const waiting = whenAuthSettled().then(() => { released = true; });

    await Promise.resolve();
    expect(released).toBe(false);

    settleAuthBootstrap();
    await waiting;
    expect(released).toBe(true);
  });

  test("releases every waiter, not just the first", async () => {
    armAuthBootstrap();
    const order = [];
    const all = Promise.all([
      whenAuthSettled().then(() => order.push("a")),
      whenAuthSettled().then(() => order.push("b")),
      whenAuthSettled().then(() => order.push("c"))
    ]);
    settleAuthBootstrap();
    await all;
    expect(order).toHaveLength(3);
  });

  test("costs nothing once settled", async () => {
    armAuthBootstrap();
    settleAuthBootstrap();
    expect(isAuthBootstrapPending()).toBe(false);
    await expect(whenAuthSettled()).resolves.toBeUndefined();
  });

  test("settling twice is harmless", () => {
    armAuthBootstrap();
    settleAuthBootstrap();
    expect(() => settleAuthBootstrap()).not.toThrow();
    expect(isAuthBootstrapPending()).toBe(false);
  });

  test("gives up if the bootstrap never settles, rather than hanging forever", async () => {
    vi.useFakeTimers();
    armAuthBootstrap();

    let released = false;
    const waiting = whenAuthSettled({ timeoutMs: 4000 }).then(() => { released = true; });

    await vi.advanceTimersByTimeAsync(3999);
    expect(released).toBe(false);

    await vi.advanceTimersByTimeAsync(2);
    await waiting;
    expect(released).toBe(true);
  });

  test("a late settle after a timeout does not double-resolve", async () => {
    vi.useFakeTimers();
    armAuthBootstrap();
    const waiting = whenAuthSettled({ timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(20);
    await waiting;
    expect(() => settleAuthBootstrap()).not.toThrow();
  });
});
