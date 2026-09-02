import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { isAllowedCorsOrigin } from "../config/cors.js";
import { resolveClerkIdentityFromRequest } from "./clerkIdentity.js";
import {
  MessageModel,
  ConversationModel,
  ForumModel,
  TenantModel,
  UserModel
} from "../db/models/index.js";
import {
  findSingleTenantMembershipForIdentity,
  findTenantUserFromMembershipIdentity,
  findTenantUserForIdentity,
  ensureGlobalSuperAdmin
} from "./identityUsers.js";
import {
  evaluateFeatureRollout,
  MULTI_CAMP_IDENTITY_FLAG
} from "./featureRollouts.js";
import {
  assertConversationDirectContactAllowed
} from "./memberSafety.js";
import {
  assertConversationTierContactAllowedByTenantId,
  getHiddenUserIdsByTenantId
} from "./memberTiers.js";
import { isValidObjectId } from "../utils/objectId.js";
import { sanitizeText } from "../utils/sanitize.js";
import {
  advanceReadBy,
  clampReadAt,
  normalizeMessageKind,
  notifyConversationParticipants
} from "./messaging.js";
import { clearConversationCaches } from "./chatRuntimeCache.js";

const isDev = env.NODE_ENV !== "production";

// ---------------------------------------------------------------------------
// Exported io instance (set after attachSocketServer is called)
// ---------------------------------------------------------------------------

/** @type {import("socket.io").Server | null} */
export let io = null;

// ---------------------------------------------------------------------------
// Auth helpers (mirrors requireAuth.js logic for socket handshake)
// ---------------------------------------------------------------------------

function authUsesLegacy() {
  return ["legacy", "hybrid"].includes(env.AUTH_PROVIDER);
}

function authUsesClerk() {
  return ["clerk", "hybrid"].includes(env.AUTH_PROVIDER);
}

/**
 * Authenticate a socket connection from its handshake auth token.
 * Returns { user } on success or throws on failure.
 */
async function authenticateSocket(socket) {
  const token = socket.handshake.auth?.token || "";
  if (!token) throw new Error("Missing auth token");

  // --- Legacy / JWT ---
  if (authUsesLegacy()) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET);
      const tenantSlug = String(socket.handshake.auth?.tenantSlug || "").trim().toLowerCase();
      const selectedTenant = tenantSlug ? await TenantModel.findOne({ slug: tenantSlug }) : null;
      const identityRollout = selectedTenant
        ? await evaluateFeatureRollout(MULTI_CAMP_IDENTITY_FLAG, selectedTenant)
        : { enabled: false };
      const appUser = selectedTenant && identityRollout.enabled
        ? await findTenantUserFromMembershipIdentity(selectedTenant._id, {
            email: String(payload.email || ""),
            userId: String(payload.sub || "")
          })
        : await UserModel.findById(String(payload.sub || ""));
      if (!appUser) throw new Error("Membership not found");
      const roles = Array.isArray(appUser.roles) ? appUser.roles : [];
      if (appUser.status !== "active" && !roles.includes("super_admin")) {
        throw new Error("Membership is inactive");
      }
      const claimedTenantId = String(payload.tenantId || "").trim();
      const membershipTenantId = String(appUser.tenantId || "").trim();
      if (
        !identityRollout.enabled &&
        claimedTenantId &&
        membershipTenantId &&
        claimedTenantId !== membershipTenantId &&
        !roles.includes("super_admin")
      ) {
        throw new Error("Tenant scope mismatch");
      }
      return {
        user: {
          id: String(appUser._id),
          _id: String(appUser._id),
          tenantId: appUser.tenantId ? String(appUser.tenantId) : null,
          roles,
          email: appUser.email || payload.email || ""
        }
      };
    } catch {
      // Fall through to Clerk in hybrid mode.
    }
  }

  // --- Clerk ---
  if (authUsesClerk()) {
    // Build a minimal request-like object for the Clerk identity resolver.
    const fakeReq = {
      headers: {
        authorization: `Bearer ${token}`,
        cookie: ""
      }
    };
    const identity = await resolveClerkIdentityFromRequest(fakeReq);
    if (identity) {
      // Resolve against the tenant selected by the client first. This keeps
      // multi-camp Clerk identities scoped to the camp currently being viewed.
      const tenantSlug = String(socket.handshake.auth?.tenantSlug || "").trim().toLowerCase();
      const selectedTenant = tenantSlug ? await TenantModel.findOne({ slug: tenantSlug }) : null;
      const identityRollout = selectedTenant
        ? await evaluateFeatureRollout(MULTI_CAMP_IDENTITY_FLAG, selectedTenant)
        : { enabled: false };
      let appUser = selectedTenant
        ? identityRollout.enabled
          ? await findTenantUserFromMembershipIdentity(selectedTenant._id, identity)
          : await findTenantUserForIdentity(selectedTenant._id, identity)
        : await findSingleTenantMembershipForIdentity(identity);
      if (!appUser) {
        appUser = await ensureGlobalSuperAdmin(identity);
      }
      if (!appUser && selectedTenant && identityRollout.enabled) {
        throw new Error("Membership-backed tenant access required");
      }
      if (appUser) {
        const roles = Array.isArray(appUser.roles) ? appUser.roles : [];
        if (appUser.status !== "active" && !roles.includes("super_admin")) {
          throw new Error("Membership is inactive");
        }
        return {
          user: {
            id: String(appUser._id),
            _id: String(appUser._id),
            tenantId: appUser.tenantId ? String(appUser.tenantId) : null,
            roles,
            email: appUser.email || identity.email || ""
          }
        };
      }
      // If we resolved an identity but no app user, allow connection with
      // the Clerk userId so the client doesn't get hard-blocked.
      return {
        user: {
          id: identity.clerkUserId,
          _id: identity.clerkUserId,
          tenantId: null,
          roles: [],
          email: identity.email || ""
        }
      };
    }
  }

  throw new Error("Invalid or expired token");
}

// ---------------------------------------------------------------------------
// Realtime room authorization
// ---------------------------------------------------------------------------

export function parseRealtimeRoom(room = "") {
  const match = String(room || "").trim().match(/^(conversation|forum):([a-f0-9]{24})$/i);
  if (!match || !isValidObjectId(match[2])) return null;
  return { type: match[1].toLowerCase(), id: match[2].toLowerCase(), room: `${match[1].toLowerCase()}:${match[2].toLowerCase()}` };
}

export async function authorizeRealtimeRoom({
  user = {},
  room = "",
  conversationModel = ConversationModel,
  forumModel = ForumModel
} = {}) {
  const parsed = parseRealtimeRoom(room);
  const tenantId = String(user?.tenantId || "").trim();
  const userId = String(user?.id || user?._id || "").trim();
  if (!parsed || !tenantId || !userId) {
    return { ok: false, status: 403, error: "Room access denied" };
  }

  if (parsed.type === "conversation") {
    const conversation = await conversationModel.findOne(tenantId, {
      _id: parsed.id,
      participantIds: { $contains: [userId] }
    });
    if (!conversation) return { ok: false, status: 403, error: "Room access denied" };
    await assertConversationDirectContactAllowed(tenantId, conversation, userId);
    await assertConversationTierContactAllowedByTenantId(tenantId, conversation, userId, { user });
    return { ok: true, ...parsed, tenantId, resource: conversation };
  }

  // Forum content is visible tenant-wide through the REST API, so realtime
  // access follows that same policy — including the tier rule, or a member
  // could subscribe to a room whose forum the REST API hides from them.
  const forum = await forumModel.findOne(tenantId, { _id: parsed.id });
  if (!forum) return { ok: false, status: 403, error: "Room access denied" };

  const hiddenUserIds = await getHiddenUserIdsByTenantId(tenantId, userId, { user });
  if (hiddenUserIds.includes(String(forum.creatorId || forum.createdBy || ""))) {
    return { ok: false, status: 403, error: "Room access denied" };
  }
  return { ok: true, ...parsed, tenantId, resource: forum };
}

export function emitRealtime(room, eventName, payload) {
  const parsed = parseRealtimeRoom(room);
  if (!io || !parsed || !String(eventName || "").trim()) return false;
  io.to(parsed.room).emit(eventName, payload);
  return true;
}

export function closeRealtimeRoom(room) {
  const parsed = parseRealtimeRoom(room);
  if (!io || !parsed) return false;
  for (const socket of io.sockets.sockets.values()) {
    socket.data?.activeRealtimeRooms?.delete(parsed.room);
  }
  io.in(parsed.room).socketsLeave(parsed.room);
  return true;
}

export function evictUserFromRealtimeRoom(userId = "", room = "") {
  const targetUserId = String(userId || "").trim();
  const parsed = parseRealtimeRoom(room);
  if (!io || !targetUserId || !parsed) return false;
  for (const socket of io.sockets.sockets.values()) {
    if (String(socket?.data?.user?.id || "") === targetUserId) {
      socket.data?.activeRealtimeRooms?.delete(parsed.room);
      socket.leave(parsed.room);
    }
  }
  return true;
}

export function listRealtimeRoomUserIds(room = "") {
  const parsed = parseRealtimeRoom(room);
  if (!io || !parsed) return [];
  const userIds = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.data?.activeRealtimeRooms?.has(parsed.room)) continue;
    const userId = String(socket?.data?.user?.id || "").trim();
    if (userId) userIds.add(userId);
  }
  return [...userIds];
}

export async function joinUserSocketsToRealtimeRoom(userIds = [], room = "") {
  const parsed = parseRealtimeRoom(room);
  const targets = new Set((Array.isArray(userIds) ? userIds : [userIds]).map(String));
  if (!io || !parsed || !targets.size) return false;
  await Promise.all(
    [...io.sockets.sockets.values()]
      .filter((socket) => targets.has(String(socket?.data?.user?.id || "")))
      .map((socket) => socket.join(parsed.room))
  );
  return true;
}

async function subscribeSocketToExistingConversations(socket, user) {
  const tenantId = String(user?.tenantId || "").trim();
  const userId = String(user?.id || "").trim();
  if (!tenantId || !userId) return;

  const [conversations, hiddenUserIds] = await Promise.all([
    ConversationModel.findByParticipant(tenantId, userId, { limit: 500 }),
    getHiddenUserIdsByTenantId(tenantId, userId, { user })
  ]);
  const hidden = new Set(hiddenUserIds.map(String));
  const rooms = conversations
    .filter((conversation) => {
      if (String(conversation?.type || "") !== "dm") return true;
      return !(conversation?.participantIds || []).some((participantId) => hidden.has(String(participantId)));
    })
    .map((conversation) => parseRealtimeRoom(`conversation:${String(conversation?._id || "")}`)?.room)
    .filter(Boolean);
  await Promise.all(rooms.map((room) => socket.join(room)));
}

export function createSocketRateLimiter({ limit = 60, windowMs = 60_000 } = {}) {
  const safeLimit = Math.max(1, Number(limit) || 60);
  const safeWindowMs = Math.max(1000, Number(windowMs) || 60_000);
  let attempts = [];
  return (now = Date.now()) => {
    const timestamp = Number(now) || Date.now();
    attempts = attempts.filter((entry) => timestamp - entry < safeWindowMs);
    if (attempts.length >= safeLimit) return false;
    attempts.push(timestamp);
    return true;
  };
}

function messageToClient(message = {}) {
  return {
    _id: String(message._id),
    id: String(message._id),
    conversationId: String(message.conversationId || ""),
    senderId: String(message.senderId || ""),
    kind: normalizeMessageKind(message.kind),
    text: String(message.text || ""),
    media: message.media || null,
    clientMessageId: String(message.clientMessageId || ""),
    createdAt: message.createdAt
      ? new Date(message.createdAt).toISOString()
      : new Date().toISOString()
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function attachSocketServer(httpServer) {
  io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
      origin: (origin, cb) => {
        if (isAllowedCorsOrigin(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: true,
      methods: ["GET", "POST"]
    },
    // Sensible transport defaults matching the client config
    transports: ["websocket", "polling"],
    allowUpgrades: true,
    maxHttpBufferSize: 100 * 1024
  });

  // ------------------------------------------------------------------
  // Authentication middleware
  // ------------------------------------------------------------------
  io.use(async (socket, next) => {
    try {
      const { user } = await authenticateSocket(socket);
      socket.data.user = user;
      next();
    } catch (err) {
      if (isDev) console.log("[socket.io] auth rejected:", err.message);
      next(new Error("Authentication failed"));
    }
  });

  // ------------------------------------------------------------------
  // Connection handler
  // ------------------------------------------------------------------
  io.on("connection", (socket) => {
    const user = socket.data.user;
    socket.data.activeRealtimeRooms = new Set();
    const allowRoomJoin = createSocketRateLimiter({ limit: 120, windowMs: 5 * 60_000 });
    const allowMessage = createSocketRateLimiter({ limit: 60, windowMs: 60_000 });
    const allowPresenceEvent = createSocketRateLimiter({ limit: 180, windowMs: 60_000 });
    if (isDev) {
      console.log(`[socket.io] connected: userId=${user.id} socketId=${socket.id}`);
    }

    // ---- join ----
    socket.on("join", async (room, ack) => {
      const callback = typeof ack === "function" ? ack : () => {};
      if (!allowRoomJoin()) {
        return callback({ ok: false, status: 429, error: "Too many room requests" });
      }
      try {
        const access = await authorizeRealtimeRoom({ user, room });
        if (!access.ok) return callback(access);
        await socket.join(access.room);
        socket.data.activeRealtimeRooms.add(access.room);
        if (isDev) console.log(`[socket.io] ${user.id} joined ${access.room}`);
        return callback({ ok: true, room: access.room });
      } catch (error) {
        if (error?.code === "MEMBER_BLOCKED") {
          return callback({ ok: false, status: 403, error: "Room access denied" });
        }
        console.error("[socket.io] room authorization error:", error);
        return callback({ ok: false, status: 500, error: "Unable to join room" });
      }
    });

    // ---- leave ----
    socket.on("leave", (room) => {
      const parsed = parseRealtimeRoom(room);
      if (!parsed) return;
      socket.data.activeRealtimeRooms.delete(parsed.room);
      if (parsed.type === "forum") socket.leave(parsed.room);
      if (isDev) console.log(`[socket.io] ${user.id} left ${parsed.room}`);
    });

    // ---- message:send ----
    socket.on("message:send", async (data, ack) => {
      const callback = typeof ack === "function" ? ack : () => {};
      try {
        const conversationId = String(data?.conversationId || "").trim();
        if (!isValidObjectId(conversationId)) {
          return callback({ ok: false, error: "conversationId is required", status: 400 });
        }
        if (!allowMessage()) {
          return callback({ ok: false, error: "Too many messages. Please slow down.", status: 429 });
        }

        const tenantId = user.tenantId || null;
        const convo = tenantId
          ? await ConversationModel.findOne(tenantId, {
              _id: conversationId,
              participantIds: { $contains: [user.id] }
            })
          : await ConversationModel.findById(conversationId);

        if (!convo) {
          return callback({ ok: false, error: "Conversation not found or access denied", status: 403 });
        }

        // Check participant membership when we had to skip tenant filter.
        if (!tenantId) {
          const ids = (convo.participantIds || []).map(String);
          if (!ids.includes(String(user.id))) {
            return callback({ ok: false, error: "Not a conversation member", status: 403 });
          }
        }

        await assertConversationDirectContactAllowed(convo.tenantId, convo, user.id);
        await assertConversationTierContactAllowedByTenantId(convo.tenantId, convo, user.id, { user });

        const kind = normalizeMessageKind(data?.kind);
        const text = sanitizeText(String(data?.text || "").trim());
        const media = data?.media || null;
        const clientMessageId = String(data?.clientMessageId || "").trim().slice(0, 120);

        if (kind === "text" && !text) {
          return callback({ ok: false, error: "Text required", status: 400 });
        }
        if ((kind === "image" || kind === "file") && !media?.url) {
          return callback({ ok: false, error: "media.url is required", status: 400 });
        }
        if (kind !== "text") {
          return callback({
            ok: false,
            error: "Attachments must use the authenticated upload flow",
            status: 400
          });
        }

        // Deduplicate by clientMessageId
        if (clientMessageId) {
          const existing = await MessageModel.findOne(convo.tenantId, {
            conversationId,
            senderId: user.id,
            clientMessageId
          });
          if (existing) {
            const msg = messageToClient(existing);
            return callback({ ok: true, message: msg });
          }
        }

        const created = await MessageModel.create({
          tenantId: convo.tenantId,
          conversationId,
          senderId: user.id,
          kind,
          text: kind === "text" ? text.slice(0, 4000) : "",
          media: kind !== "text" ? media : null,
          clientMessageId: clientMessageId || undefined,
          createdAt: new Date()
        });

        const lastMessageAt = created.createdAt || new Date();
        await ConversationModel.update(convo._id, {
          lastMessageAt,
          readBy: advanceReadBy(convo.readBy, user.id, lastMessageAt),
          lastMessage: {
            senderId: user.id,
            kind,
            text:
              kind === "text"
                ? created.text
                : kind === "image"
                  ? "Photo"
                  : "File attachment",
            media: kind !== "text" ? created.media : null,
            createdAt: lastMessageAt
          }
        });
        clearConversationCaches();

        const msg = messageToClient(created);
        const room = `conversation:${conversationId}`;

        // Broadcast to the room (including sender so all tabs sync).
        io.to(room).emit("message:new", msg);

        void notifyConversationParticipants({
          conversation: convo,
          message: created,
          senderId: user.id,
          excludeUserIds: listRealtimeRoomUserIds(room)
        }).catch((error) => {
          console.error("[socket.io] message notification error:", error);
        });

        callback({ ok: true, message: msg });
      } catch (err) {
        if (err?.code === "MEMBER_BLOCKED") {
          return callback({
            ok: false,
            error: err.message,
            code: err.code,
            status: Number(err.statusCode || 403)
          });
        }
        console.error("[socket.io] message:send error:", err);
        callback({ ok: false, error: "Internal server error", status: 500 });
      }
    });

    // ---- typing:start ----
    socket.on("typing:start", (room) => {
      if (!allowPresenceEvent()) return;
      const parsed = parseRealtimeRoom(room);
      if (!parsed || parsed.type !== "conversation" || !socket.data.activeRealtimeRooms.has(parsed.room)) return;
      socket.to(parsed.room).emit("typing", {
        room: parsed.room,
        userId: user.id,
        on: true
      });
    });

    // ---- typing:stop ----
    socket.on("typing:stop", (room) => {
      if (!allowPresenceEvent()) return;
      const parsed = parseRealtimeRoom(room);
      if (!parsed || parsed.type !== "conversation" || !socket.data.activeRealtimeRooms.has(parsed.room)) return;
      socket.to(parsed.room).emit("typing", {
        room: parsed.room,
        userId: user.id,
        on: false
      });
    });

    // ---- read:upto ----
    socket.on("read:upto", (data) => {
      if (!allowPresenceEvent()) return;
      const room = String(data?.room || "").trim();
      const iso = String(data?.iso || "").trim();
      const parsed = parseRealtimeRoom(room);
      if (!parsed || parsed.type !== "conversation" || !socket.data.activeRealtimeRooms.has(parsed.room) || !iso) return;
      const requestedReadAt = new Date(iso);
      if (!Number.isFinite(requestedReadAt.getTime())) return;
      const safeReadAt = clampReadAt(requestedReadAt, new Date()).toISOString();

      // Broadcast to the room so other participants update read receipts.
      socket.to(parsed.room).emit("read:upto", {
        room: parsed.room,
        userId: user.id,
        iso: safeReadAt
      });
    });

    socket.on("disconnecting", () => {
      for (const room of socket.data.activeRealtimeRooms) {
        const parsed = parseRealtimeRoom(room);
        if (!parsed || parsed.type !== "conversation") continue;
        socket.to(parsed.room).emit("typing", {
          room: parsed.room,
          userId: user.id,
          on: false
        });
      }
    });

    // ---- disconnect ----
    socket.on("disconnect", (reason) => {
      if (isDev) {
        console.log(`[socket.io] disconnected: userId=${user.id} reason=${reason}`);
      }
    });

    // ---- error ----
    socket.on("error", (err) => {
      console.error(`[socket.io] socket error: userId=${user.id}`, err);
    });

    void subscribeSocketToExistingConversations(socket, user).catch((error) => {
      console.error("[socket.io] conversation subscription error:", error);
    });
  });

  return io;
}
