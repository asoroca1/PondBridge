import { useCallback, useEffect, useRef, useState } from "react";

export function useTypingIndicator({ expiresAfterMs = 3000 } = {}) {
  const [typing, setTyping] = useState(false);
  const expiryTimer = useRef(null);

  const updateTyping = useCallback(
    (active) => {
      window.clearTimeout(expiryTimer.current);
      setTyping(Boolean(active));
      if (active) {
        expiryTimer.current = window.setTimeout(() => setTyping(false), expiresAfterMs);
      }
    },
    [expiresAfterMs]
  );

  useEffect(() => {
    return () => window.clearTimeout(expiryTimer.current);
  }, []);

  return [typing, updateTyping];
}
