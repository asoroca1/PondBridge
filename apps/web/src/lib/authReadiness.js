/**
 * A gate that holds authenticated requests until the auth bootstrap has put the
 * token back.
 *
 * The token lives in memory, so every page load starts without one. Route data
 * requests fire on mount and do not wait, so one of them regularly went out
 * with no Authorization header, earned a 401, and the app read that as a dead
 * session — signing the member out and reloading, which reopened the same
 * window. Whether a given click did that came down to which won the race, which
 * is why it looked random.
 *
 * Retrying a request that lost the race makes the symptom harmless. This
 * removes the race: nothing authenticated leaves until auth has settled.
 *
 * Deliberately module state rather than React state. The callers are ordinary
 * async functions several layers below any component, and threading readiness
 * through 54 files of hooks is how this gets half-done and stays broken.
 */

let armed = false;
let settled = false;
let waiters = [];

/**
 * Waiting forever is worse than a 401. If the bootstrap wedges, requests go out
 * unauthenticated after this and take their chances — which is exactly the old
 * behaviour, so the gate can never be the reason nothing loads.
 */
const DEFAULT_TIMEOUT_MS = 4000;

/** Called before the app renders, because a bootstrap is about to run. */
export function armAuthBootstrap() {
  armed = true;
  settled = false;
}

/** Called by the auth provider once it is ready, successfully or not. */
export function settleAuthBootstrap() {
  if (settled) return;
  settled = true;
  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

export function isAuthBootstrapPending() {
  return armed && !settled;
}

/**
 * Resolves immediately unless a bootstrap is genuinely in flight, so this costs
 * nothing on every request after the first screen.
 */
export function whenAuthSettled({ timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!isAuthBootstrapPending()) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      waiters = waiters.filter((entry) => entry !== finish);
      finish();
    }, timeoutMs);
    waiters.push(finish);
  });
}

/** Test seam. */
export function resetAuthReadiness() {
  armed = false;
  settled = false;
  waiters = [];
}
