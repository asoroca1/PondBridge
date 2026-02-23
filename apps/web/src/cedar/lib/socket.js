// src/lib/socket.js
import { io } from "socket.io-client";
import { API_BASE } from "./api";

const SOCKET_URL = API_BASE.replace(/\/api\/t\/[^/]+$/i, "").replace(/\/+$/, "");

export function createSocket(token) {
  return io(SOCKET_URL, {
    path: "/socket.io",
    auth: { token },
    autoConnect: false,
    // ✅ allow WS first, fallback to polling
    transports: ["websocket", "polling"],
    upgrade: true,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    withCredentials: false,
  });
}
