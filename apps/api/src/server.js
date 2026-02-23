import app from "./app.js";
import { env } from "./config/env.js";
import { connectToDatabase } from "./db/connect.js";

async function start() {
  await connectToDatabase();
  app.listen(env.PORT, () => {
    console.log(`PondBridge API listening on http://localhost:${env.PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start API", error);
  process.exit(1);
});
