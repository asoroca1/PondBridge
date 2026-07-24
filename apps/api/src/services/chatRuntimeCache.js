import { createTtlCache } from "../utils/ttlCache.js";

export const conversationListResponseCache = createTtlCache({ ttlMs: 8_000, maxEntries: 1200 });
export const conversationDetailResponseCache = createTtlCache({ ttlMs: 8_000, maxEntries: 1800 });
export const conversationMessagesResponseCache = createTtlCache({ ttlMs: 6_000, maxEntries: 2200 });

export function clearConversationCaches() {
  conversationListResponseCache.clear();
  conversationDetailResponseCache.clear();
  conversationMessagesResponseCache.clear();
}
