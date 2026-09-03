function normalizeKey(value = "") {
  return String(value || "").trim();
}

export function createTtlCache({ ttlMs = 15_000, maxEntries = 300 } = {}) {
  const store = new Map();

  function evictExpired(now = Date.now()) {
    for (const [key, entry] of store.entries()) {
      if (!entry || now >= Number(entry.expiresAt || 0)) {
        store.delete(key);
      }
    }
  }

  function pruneIfNeeded() {
    if (store.size < maxEntries) return;
    const firstKey = store.keys().next().value;
    if (firstKey) {
      store.delete(firstKey);
    }
  }

  return {
    get(rawKey = "") {
      const key = normalizeKey(rawKey);
      if (!key) return null;
      const now = Date.now();
      const entry = store.get(key);
      if (!entry) return null;
      if (now >= Number(entry.expiresAt || 0)) {
        store.delete(key);
        return null;
      }
      return entry.value ?? null;
    },

    set(rawKey = "", value = null) {
      const key = normalizeKey(rawKey);
      if (!key || value == null) return;
      evictExpired();
      pruneIfNeeded();
      store.set(key, {
        expiresAt: Date.now() + Math.max(1000, Number(ttlMs) || 15_000),
        value
      });
    },

    /**
     * With no argument every entry goes. Pass a predicate over the key to drop
     * only the entries it matches — callers use it to clear one tenant without
     * throwing away every other tenant's warm entries.
     */
    clear(matches = null) {
      if (typeof matches !== "function") {
        store.clear();
        return;
      }
      for (const key of [...store.keys()]) {
        if (matches(key)) store.delete(key);
      }
    }
  };
}
