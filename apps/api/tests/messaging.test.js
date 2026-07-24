import { jest } from "@jest/globals";
import {
  advanceReadBy,
  buildConversationNotification,
  clampReadAt,
  hasConversationMessage,
  normalizeStoredMessageMedia
} from "../src/services/messaging.js";
import {
  authorizeRealtimeRoom,
  createSocketRateLimiter,
  parseRealtimeRoom
} from "../src/services/socketServer.js";

const TENANT_ID = "64a000000000000000000001";
const USER_ID = "64a000000000000000000002";
const CONVERSATION_ID = "64a000000000000000000003";
const FORUM_ID = "64a000000000000000000004";

describe("messaging safety and delivery helpers", () => {
  test("only accepts canonical conversation and forum room names", () => {
    expect(parseRealtimeRoom(`conversation:${CONVERSATION_ID}`)).toMatchObject({
      type: "conversation",
      id: CONVERSATION_ID
    });
    expect(parseRealtimeRoom(`forum:${FORUM_ID}`)).toMatchObject({ type: "forum", id: FORUM_ID });
    expect(parseRealtimeRoom("conversation:../../other-camp")).toBeNull();
    expect(parseRealtimeRoom(`user:${USER_ID}`)).toBeNull();
  });

  test("rate-limits abusive socket event bursts and recovers after the window", () => {
    const allow = createSocketRateLimiter({ limit: 2, windowMs: 1000 });
    expect(allow(1000)).toBe(true);
    expect(allow(1100)).toBe(true);
    expect(allow(1200)).toBe(false);
    expect(allow(2101)).toBe(true);
  });

  test("authorizes realtime rooms through tenant-scoped model lookups", async () => {
    const conversation = {
      _id: CONVERSATION_ID,
      tenantId: TENANT_ID,
      type: "group",
      participantIds: [USER_ID]
    };
    const conversationModel = {
      findOne: jest.fn().mockResolvedValue(conversation)
    };
    const forumModel = {
      findOne: jest.fn().mockResolvedValue({ _id: FORUM_ID, tenantId: TENANT_ID })
    };

    await expect(
      authorizeRealtimeRoom({
        user: { id: USER_ID, tenantId: TENANT_ID },
        room: `conversation:${CONVERSATION_ID}`,
        conversationModel,
        forumModel
      })
    ).resolves.toMatchObject({ ok: true, type: "conversation", tenantId: TENANT_ID });
    expect(conversationModel.findOne).toHaveBeenCalledWith(TENANT_ID, {
      _id: CONVERSATION_ID,
      participantIds: { $contains: [USER_ID] }
    });

    await expect(
      authorizeRealtimeRoom({
        user: { id: USER_ID, tenantId: "" },
        room: `conversation:${CONVERSATION_ID}`,
        conversationModel,
        forumModel
      })
    ).resolves.toMatchObject({ ok: false, status: 403 });

    conversationModel.findOne.mockResolvedValueOnce(null);
    await expect(
      authorizeRealtimeRoom({
        user: { id: USER_ID, tenantId: TENANT_ID },
        room: `conversation:${CONVERSATION_ID}`,
        conversationModel,
        forumModel
      })
    ).resolves.toMatchObject({ ok: false, status: 403 });
  });

  test("clamps future read receipts and only advances stored read state", () => {
    const now = new Date("2026-07-15T12:00:00.000Z");
    expect(clampReadAt("2099-01-01T00:00:00.000Z", now).toISOString()).toBe(now.toISOString());

    const existing = [{ userId: USER_ID, lastReadAt: "2026-07-15T11:00:00.000Z" }];
    expect(advanceReadBy(existing, USER_ID, "2026-07-15T10:00:00.000Z")[0].lastReadAt).toBe(
      "2026-07-15T11:00:00.000Z"
    );
    expect(
      new Date(advanceReadBy(existing, USER_ID, "2026-07-15T11:30:00.000Z")[0].lastReadAt).toISOString()
    ).toBe("2026-07-15T11:30:00.000Z");
  });

  test("does not mark an empty newly-created conversation unread", () => {
    expect(hasConversationMessage({ lastMessageAt: new Date() })).toBe(false);
    expect(
      hasConversationMessage({ lastMessage: { senderId: USER_ID, text: "Hello", createdAt: new Date() } })
    ).toBe(true);
  });

  test("canonicalizes attachment URLs and rejects cross-scope keys", () => {
    const stored = normalizeStoredMessageMedia(
      {
        key: `camp/chat/${CONVERSATION_ID}/1234-file.pdf`,
        url: "https://tracker.invalid/file",
        mime: "application/pdf",
        name: "schedule.pdf",
        size: 1024
      },
      {
        tenantSlug: "camp",
        scope: "chat",
        entityId: CONVERSATION_ID,
        objectProxyBaseUrl: "https://api.example/api/t/camp/uploads/object",
        kind: "file"
      }
    );
    expect(stored.url).toBe(
      `https://api.example/api/t/camp/uploads/object?key=camp%2Fchat%2F${CONVERSATION_ID}%2F1234-file.pdf`
    );
    expect(() =>
      normalizeStoredMessageMedia(
        {
          key: `other-camp/chat/${CONVERSATION_ID}/file.pdf`,
          mime: "application/pdf",
          size: 10
        },
        {
          tenantSlug: "camp",
          scope: "chat",
          entityId: CONVERSATION_ID,
          objectProxyBaseUrl: "https://api.example/uploads/object",
          kind: "file"
        }
      )
    ).toThrow("does not belong");
  });

  test("builds privacy-conscious mobile notification copy", () => {
    expect(
      buildConversationNotification({
        conversation: { _id: CONVERSATION_ID, type: "dm" },
        senderName: "Alex Rivera",
        message: { senderId: USER_ID, kind: "text", text: "private message contents" }
      })
    ).toMatchObject({
      title: "New message from Alex Rivera",
      body: "Alex Rivera sent you a message.",
      deepLink: `/chat-rooms?tab=personal&conversation=${CONVERSATION_ID}`
    });
  });
});
