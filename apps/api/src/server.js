import { createServer } from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase } from "./db/connect.js";
import { attachSocketServer } from "./services/socketServer.js";
import { startMobileNotificationScheduler } from "./services/mobileNotifications.js";

async function start() {
  await connectToDatabase();

  const server = createServer(app);
  attachSocketServer(server);

  startMobileNotificationScheduler();

  server.listen(env.PORT, () => {
    console.log(`PondBridge API listening on http://localhost:${env.PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
