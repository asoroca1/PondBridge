/**
 * Idle logout used to clear and recreate two timers on every mousemove,
 * mousedown, keydown, scroll and touch. A moving cursor alone produced
 * hundreds of timer teardowns a second, all to express one fact: the user is
 * still here.
 *
 * The fact is a timestamp, so it is stored as one. Recording activity is a
 * single assignment with no allocation and no timer work, and a single
 * periodic check decides whether the warning or the logout is due. Timer churn
 * goes from "per input event" to "one interval, forever".
 *
 * The trade is granularity: the warning and logout fire within one check
 * interval of their exact moment. Against a session timeout measured in tens
 * of minutes that is not a distinction anyone can perceive.
 */

export const ACTIVITY_CHECK_INTERVAL_MS = 15_000;

export function createIdleWatcher({
  timeoutMs = 0,
  warningMs = 0,
  onWarn = null,
  onTimeout = null,
  now = () => Date.now()
} = {}) {
  let lastActivityAt = now();
  let warned = false;
  let timedOut = false;

  function noteActivity() {
    lastActivityAt = now();
    warned = false;
    timedOut = false;
  }

  function idleFor() {
    return now() - lastActivityAt;
  }

  /**
   * Returns what it decided, so a caller (and a test) can see the transition
   * rather than infer it from side effects.
   */
  function check() {
    if (timeoutMs <= 0) return "disabled";
    const elapsed = idleFor();

    // Timeout is tested first: a tab that was suspended and resumed can jump
    // straight past the warning window, and in that case the session is over —
    // warning about it after the fact would be noise.
    if (elapsed >= timeoutMs) {
      if (timedOut) return "already_timed_out";
      timedOut = true;
      onTimeout?.();
      return "timed_out";
    }

    if (warningMs > 0 && elapsed >= warningMs) {
      if (warned) return "already_warned";
      warned = true;
      onWarn?.();
      return "warned";
    }

    return "active";
  }

  return { noteActivity, check, idleFor, getLastActivityAt: () => lastActivityAt };
}
