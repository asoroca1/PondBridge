/**
 * Background polling that ignores the tab it lives in.
 *
 * The unread-chat count refetched the whole conversation list every 25
 * seconds, awake or not. A tab left open in the background — which is where
 * most tabs spend their lives — kept a phone's radio and the API busy all day
 * for an answer nobody was looking at. Offline was no different: the fetch
 * still went out, still failed, and still went out again 25 seconds later at
 * exactly the same rate.
 *
 * This is the decision half, kept free of timers and globals so it can be
 * tested directly. Callers own the actual scheduling.
 *
 * Backoff exists so a failing or unreachable API is not asked the same
 * question at full rate for however long it stays down; a success clears it
 * immediately, because one blip should not slow the next hour of polling.
 */

export const DEFAULT_POLL_INTERVAL_MS = 25_000;
export const DEFAULT_MAX_BACKOFF_MS = 5 * 60_000;

export function createPollPlanner({
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  isVisible = () => true,
  isOnline = () => true,
  now = () => Date.now()
} = {}) {
  let failures = 0;
  let lastRunAt = 0;
  let hasRun = false;

  return {
    /** Whether work should happen at all right now. */
    shouldRun() {
      return Boolean(isVisible() && isOnline());
    },

    noteRun(ok = true) {
      lastRunAt = now();
      hasRun = true;
      failures = ok ? 0 : failures + 1;
    },

    /** Delay before the next attempt, widened while the API is failing. */
    delayMs() {
      if (failures <= 0) return intervalMs;
      return Math.min(maxBackoffMs, intervalMs * 2 ** failures);
    },

    /**
     * On waking — the tab became visible, or the network came back — a refresh
     * is due only if the answer on screen could have gone stale. Coming back
     * after two seconds away should not cost a request.
     */
    isStale() {
      if (!hasRun) return true;
      return now() - lastRunAt >= intervalMs;
    },

    failureCount() {
      return failures;
    }
  };
}
