import {
  DEFAULT_SERVER_TIMEOUTS,
  applyServerTimeouts,
  resolveServerTimeouts
} from "../src/services/serverTimeouts.js";

/**
 * The ordering rule between these two timeouts is the whole point. When
 * headersTimeout sits at or below keepAliveTimeout, a connection reused right
 * at the keep-alive boundary is torn down mid-headers and the user sees a 502
 * that no application log explains — so the code repairs that arrangement
 * rather than trusting whoever set the environment variables.
 */

describe("server timeouts", () => {
  it("uses bounded defaults instead of Node's 300s request timeout", () => {
    const t = resolveServerTimeouts({});
    expect(t).toEqual({
      keepAliveTimeoutMs: DEFAULT_SERVER_TIMEOUTS.keepAliveTimeoutMs,
      headersTimeoutMs: DEFAULT_SERVER_TIMEOUTS.headersTimeoutMs,
      requestTimeoutMs: DEFAULT_SERVER_TIMEOUTS.requestTimeoutMs
    });
    expect(t.requestTimeoutMs).toBeLessThan(300_000);
  });

  it("keeps keep-alive above the load balancer idle window by default", () => {
    expect(resolveServerTimeouts({}).keepAliveTimeoutMs).toBeGreaterThan(60_000);
  });

  it("honours explicit overrides", () => {
    expect(
      resolveServerTimeouts({
        API_KEEPALIVE_TIMEOUT_MS: "30000",
        API_HEADERS_TIMEOUT_MS: "40000",
        API_REQUEST_TIMEOUT_MS: "50000"
      })
    ).toEqual({ keepAliveTimeoutMs: 30_000, headersTimeoutMs: 40_000, requestTimeoutMs: 50_000 });
  });

  it("lifts a headers timeout that would sit at or below keep-alive", () => {
    for (const headers of ["1000", "65000"]) {
      const t = resolveServerTimeouts({
        API_KEEPALIVE_TIMEOUT_MS: "65000",
        API_HEADERS_TIMEOUT_MS: headers
      });
      expect(t.headersTimeoutMs).toBeGreaterThan(t.keepAliveTimeoutMs);
    }
  });

  it("falls back to defaults for junk or non-positive values", () => {
    const t = resolveServerTimeouts({
      API_KEEPALIVE_TIMEOUT_MS: "not-a-number",
      API_REQUEST_TIMEOUT_MS: "0"
    });
    expect(t.keepAliveTimeoutMs).toBe(DEFAULT_SERVER_TIMEOUTS.keepAliveTimeoutMs);
    expect(t.requestTimeoutMs).toBe(DEFAULT_SERVER_TIMEOUTS.requestTimeoutMs);
  });

  it("writes the values onto the server it is given", () => {
    const server = {};
    const applied = applyServerTimeouts(server, {});
    expect(server.keepAliveTimeout).toBe(applied.keepAliveTimeoutMs);
    expect(server.headersTimeout).toBe(applied.headersTimeoutMs);
    expect(server.requestTimeout).toBe(applied.requestTimeoutMs);
  });
});
