import { createServer } from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase } from "./db/connect.js";
import { attachSocketServer } from "./services/socketServer.js";
import {
  startMobileNotificationScheduler,
  stopMobileNotificationScheduler
} from "./services/mobileNotifications.js";

const SHUTDOWN_TIMEOUT_MS = 25_000;

function closeHttpServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeIdleConnections?.();
  });
}

async function start() {
  await connectToDatabase();

  const server = createServer(app);
  const socketServer = attachSocketServer(server);
  let shutdownPromise = null;

  const shutdown = (signal) => {
    if (shutdownPromise) return shutdownPromise;

    shutdownPromise = (async () => {
      console.log(`${signal} received; draining PondBridge API connections.`);
      const forceExitTimer = setTimeout(() => {
        console.error("Graceful shutdown timed out; forcing API exit.");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref?.();

      try {
        socketServer.emit("server:shutdown", {
          reconnect: true
        });
        socketServer.disconnectSockets(true);
        await Promise.all([
          stopMobileNotificationScheduler(),
          closeHttpServer(server)
        ]);
        clearTimeout(forceExitTimer);
        console.log("PondBridge API shutdown complete.");
      } catch (error) {
        clearTimeout(forceExitTimer);
        console.error("PondBridge API shutdown failed", error);
        process.exitCode = 1;
      }
    })();

    return shutdownPromise;
  };

  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });

  startMobileNotificationScheduler();

  server.listen(env.PORT, () => {
    console.log(`PondBridge API listening on http://localhost:${env.PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
