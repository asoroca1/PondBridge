import { execSync } from "node:child_process";
import path from "node:path";

function isTrackedEnvFile(filePath = "") {
  const normalized = String(filePath || "").trim();
  if (!normalized) return false;
  const base = path.basename(normalized).toLowerCase();
  if (base === ".env") return true;
  if (base.startsWith(".env.") && base !== ".env.example") return true;
  return false;
}

let trackedFiles = [];
try {
  trackedFiles = execSync("git ls-files", {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8"
  })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
} catch (error) {
  console.error("[security:check-env] Unable to enumerate tracked files.", error?.message || error);
  process.exit(1);
}

const forbidden = trackedFiles.filter(isTrackedEnvFile);
if (forbidden.length === 0) {
  console.log("[security:check-env] OK: no tracked .env files detected.");
  process.exit(0);
}

console.error("[security:check-env] Blocked tracked environment files detected:");
for (const file of forbidden) {
  console.error(` - ${file}`);
}
console.error(
  "Remove tracked secret files and keep only template files like .env.example in git."
);
process.exit(1);
