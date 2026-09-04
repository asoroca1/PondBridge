/**
 * Node's HTTP defaults are generous in the wrong places: a client can hold a
 * socket open sending headers a byte at a time for 60 s, and a request body
 * for 300 s. Nothing here set them, so a handful of slow or abandoned sockets
 * could occupy the process indefinitely while healthy traffic queued behind
 * them.
 *
 * Two of these are order-dependent and get them wrong quietly:
 *
 * - `keepAliveTimeout` must be LONGER than the load balancer's idle timeout.
 *   If Node closes an idle socket the balancer still believes is good, the
 *   balancer sends a request into the closing socket and the user gets a 502
 *   that no application log explains.
 * - `headersTimeout` must in turn exceed `keepAliveTimeout`, or a connection
 *   reused right at the keep-alive boundary is torn down mid-headers.
 *
 * Every value is env-overridable so this can be tuned to whatever fronts the
 * service without a code change.
 */

export const DEFAULT_SERVER_TIMEOUTS = {
  // Comfortably above the 60s idle timeout typical of managed load balancers.
  keepAliveTimeoutMs: 65_000,
  headersTimeoutMs: 70_000,
  // Bounded, but still generous enough for a large upload on a slow phone.
  requestTimeoutMs: 120_000
};

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolveServerTimeouts(source = {}) {
  const keepAliveTimeoutMs = positiveInt(
    source.API_KEEPALIVE_TIMEOUT_MS,
    DEFAULT_SERVER_TIMEOUTS.keepAliveTimeoutMs
  );
  const requestTimeoutMs = positiveInt(
    source.API_REQUEST_TIMEOUT_MS,
    DEFAULT_SERVER_TIMEOUTS.requestTimeoutMs
  );
  let headersTimeoutMs = positiveInt(
    source.API_HEADERS_TIMEOUT_MS,
    DEFAULT_SERVER_TIMEOUTS.headersTimeoutMs
  );

  // Repair rather than reject: a misconfigured headers timeout should not stop
  // the service from booting, but it must not be allowed to sit below
  // keep-alive either, because that failure shows up as unexplained 502s.
  if (headersTimeoutMs <= keepAliveTimeoutMs) {
    headersTimeoutMs = keepAliveTimeoutMs + 5_000;
  }

  return { keepAliveTimeoutMs, headersTimeoutMs, requestTimeoutMs };
}

export function applyServerTimeouts(server, source = {}) {
  const timeouts = resolveServerTimeouts(source);
  server.keepAliveTimeout = timeouts.keepAliveTimeoutMs;
  server.headersTimeout = timeouts.headersTimeoutMs;
  server.requestTimeout = timeouts.requestTimeoutMs;
  return timeouts;
}
