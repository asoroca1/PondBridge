import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  computeUnreadCount,
  getChatReadStorageKey,
  setChatLastRead
} from "./unreadChats.js";

function storageStub() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function jwtFor(subject) {
  const payload = btoa(JSON.stringify({ sub: subject, exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `header.${payload}.signature`;
}

describe("conversation unread state", () => {
  beforeEach(() => {
    globalThis.localStorage = storageStub();
    globalThis.sessionStorage = storageStub();
    globalThis.CustomEvent = class CustomEvent {
      constructor(type, init = {}) {
        this.type = type;
        this.detail = init.detail;
      }
    };
    globalThis.window = {
      location: { pathname: "/t/camp-a/chat-rooms" },
      dispatchEvent() {},
      CustomEvent: globalThis.CustomEvent
    };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.CustomEvent;
    delete globalThis.window;
  });

  it("scopes optimistic read state by camp and signed-in member", () => {
    localStorage.setItem("pondbridgeToken", jwtFor("member-a"));
    expect(getChatReadStorageKey()).toContain(":camp-a:member-a");
  });

  it("uses server read state on a fresh device", () => {
    const count = computeUnreadCount([
      {
        _id: CONVERSATION_ID,
        type: "dm",
        lastMessage: { senderId: "member-b", text: "Already read" },
        lastMessageAt: "2026-07-15T11:00:00.000Z",
        lastReadAt: "2026-07-15T12:00:00.000Z"
      }
    ]);
    expect(count).toBe(0);
  });

  it("never counts an empty new thread and honors newer local optimistic state", () => {
    localStorage.setItem("pondbridgeToken", jwtFor("member-a"));
    setChatLastRead(CONVERSATION_ID, "2026-07-15T12:00:00.000Z");
    expect(
      computeUnreadCount([
        {
          _id: "64a000000000000000000099",
          type: "dm",
          lastMessage: null,
          lastMessageAt: "2026-07-15T13:00:00.000Z",
          lastReadAt: null
        },
        {
          _id: CONVERSATION_ID,
          type: "group",
          lastMessage: { senderId: "member-b", text: "Read locally" },
          lastMessageAt: "2026-07-15T11:30:00.000Z",
          lastReadAt: "2026-07-15T10:00:00.000Z"
        }
      ])
    ).toBe(0);
  });
});

const CONVERSATION_ID = "64a000000000000000000003";
