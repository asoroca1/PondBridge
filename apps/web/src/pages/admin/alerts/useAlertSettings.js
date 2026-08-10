import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PREFS } from "./alertOptions.js";

/**
 * Preferences save themselves. The old page had two "Save" buttons that both
 * PATCHed the same object, which made it look like there were two separate
 * settings groups when there was only ever one. Flipping a switch now writes
 * after a short pause and reports it, so there is nothing to remember to press.
 */
export default function useAlertSettings(request) {
  const [settings, setSettings] = useState(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [error, setError] = useState("");

  const timerRef = useRef(0);
  const pendingRef = useRef(null);
  const savedTimerRef = useRef(0);

  useEffect(() => {
    let active = true;
    request("/settings")
      .then((response) => {
        if (!active) return;
        setSettings({ ...DEFAULT_PREFS, ...(response?.notifications || {}) });
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || "Could not load alert settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [request]);

  const flush = useCallback(async () => {
    const body = pendingRef.current;
    if (!body) return;
    pendingRef.current = null;
    setSaveState("saving");
    setError("");
    try {
      const response = await request("/settings/notifications", { method: "PATCH", body });
      if (response?.notifications) {
        setSettings({ ...DEFAULT_PREFS, ...response.notifications });
      }
      setSaveState("saved");
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = window.setTimeout(() => setSaveState("idle"), 2500);
    } catch (requestError) {
      setSaveState("error");
      setError(requestError.message || "Could not save that change.");
    }
  }, [request]);

  const update = useCallback((changes) => {
    setSettings((prev) => {
      const next = { ...prev, ...changes };
      pendingRef.current = next;
      window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(flush, 500);
      return next;
    });
  }, [flush]);

  useEffect(() => () => {
    window.clearTimeout(timerRef.current);
    window.clearTimeout(savedTimerRef.current);
  }, []);

  return { settings, loading, saveState, error, update, setError };
}
