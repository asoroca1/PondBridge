import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { isAllowedCorsOrigin } from "../config/cors.js";
import { resolveClerkIdentityFromRequest } from "./clerkIdentity.js";
import { MessageModel, ConversationModel } from "../db/models/index.js";
import {
  findSingleTenantMembershipForIdentity,
  ensureGlobalSuperAdmin
} from "./identityUsers.js";

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
      return {
        user: {
          id: payload.sub,
          _id: payload.sub,
          tenantId: payload.tenantId || null,
          roles: Array.isArray(payload.roles) ? payload.roles : [],
          email: payload.email || ""
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
      // Resolve application user from identity (try single-tenant lookup).
      let appUser = await findSingleTenantMembershipForIdentity(identity);
      if (!appUser) {
        appUser = await ensureGlobalSuperAdmin(identity);
      }
      if (appUser) {
        return {
          user: {
            id: String(appUser._id),
            _id: String(appUser._id),
            tenantId: appUser.tenantId ? String(appUser.tenantId) : null,
            roles: Array.isArray(appUser.roles) ? appUser.roles : [],
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
// Message kind normalizer (matches REST helper)
// ---------------------------------------------------------------------------

function normalizeMessageKind(raw = "") {
  const kind = String(raw || "text").trim().toLowerCase();
  if (kind === "text" || kind === "image" || kind === "file") return kind;
  return "text";
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
    allowUpgrades: true
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
    if (isDev) {
      console.log(`[socket.io] connected: userId=${user.id} socketId=${socket.id}`);
    }

    // ---- join ----
    socket.on("join", (room) => {
      if (typeof room !== "string" || !room) return;
      socket.join(room);
      if (isDev) console.log(`[socket.io] ${user.id} joined ${room}`);
    });

    // ---- leave ----
    socket.on("leave", (room) => {
      if (typeof room !== "string" || !room) return;
      socket.leave(room);
      if (isDev) console.log(`[socket.io] ${user.id} left ${room}`);
    });

    // ---- message:send ----
    socket.on("message:send", async (data, ack) => {
      const callback = typeof ack === "function" ? ack : () => {};
      try {
        const conversationId = String(data?.conversationId || "").trim();
        if (!conversationId) {
          return callback({ ok: false, error: "conversationId is required", status: 400 });
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

        const kind = normalizeMessageKind(data?.kind);
        const text = String(data?.text || "").trim();
        const media = data?.media || null;
        const clientMessageId = String(data?.clientMessageId || "").trim().slice(0, 120);

        if (kind === "text" && !text) {
          return callback({ ok: false, error: "Text required", status: 400 });
        }
        if ((kind === "image" || kind === "file") && !media?.url) {
          return callback({ ok: false, error: "media.url is required", status: 400 });
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

        const msg = messageToClient(created);
        const room = `conversation:${conversationId}`;

        // Broadcast to the room (including sender so all tabs sync).
        io.to(room).emit("message:new", msg);

        callback({ ok: true, message: msg });
      } catch (err) {
        console.error("[socket.io] message:send error:", err);
        callback({ ok: false, error: "Internal server error", status: 500 });
      }
    });

    // ---- typing:start ----
    socket.on("typing:start", (room) => {
      if (typeof room !== "string" || !room) return;
      socket.to(room).emit("typing", {
        room,
        userId: user.id,
        on: true
      });
    });

    // ---- typing:stop ----
    socket.on("typing:stop", (room) => {
      if (typeof room !== "string" || !room) return;
      socket.to(room).emit("typing", {
        room,
        userId: user.id,
        on: false
      });
    });

    // ---- read:upto ----
    socket.on("read:upto", (data) => {
      const room = String(data?.room || "").trim();
      const iso = String(data?.iso || "").trim();
      if (!room || !iso) return;

      // Broadcast to the room so other participants update read receipts.
      socket.to(room).emit("read:upto", {
        room,
        userId: user.id,
        iso
      });
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
  });

  return io;
}
