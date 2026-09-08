// Operator-only, defaults to dry-run. Input is an approved JSON array of Clerk
// user IDs, never emails or an OTP export. Uses existing environment credentials.
import { readFile, stat } from "node:fs/promises";
import { reconcileVerifiedSignupByClerkId } from "../src/services/verifiedSignupReconciliation.js";

const args = process.argv.slice(2);
const allowed = new Set(["--user-ids-file", "--apply", "--dry-run"]);
let path = "";
for (let index = 0; index < args.length; index += 1) {
  if (!allowed.has(args[index])) throw new Error("Use --user-ids-file PATH and optionally --apply or --dry-run.");
  if (args[index] === "--user-ids-file") path = args[++index] || "";
}
if (!path || (args.includes("--apply") && args.includes("--dry-run"))) throw new Error("Choose one mode and an approved user-ID file.");
if ((await stat(path)).size > 1_000_000) throw new Error("User-ID file is too large.");
const input = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(input) || input.length > 5000 || input.some((id) => !/^user_[A-Za-z0-9]+$/.test(id))) {
  throw new Error("Expected at most 5000 Clerk user IDs.");
}
const apply = args.includes("--apply");
const summary = { mode: apply ? "apply" : "dry-run", checked: 0, outcomes: {}, requestIds: [], failures: [] };
for (const id of new Set(input)) {
  try {
    const result = await reconcileVerifiedSignupByClerkId(id, { source: "operator_repair", apply });
    summary.checked += 1;
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] || 0) + 1;
    if (result.outcome === "created" && result.requestId) summary.requestIds.push(result.requestId);
  } catch (error) {
    summary.failures.push({ userId: id, code: String(error?.code || "RECONCILIATION_FAILED").replace(/[^A-Z0-9_]/gi, "_").slice(0, 100) });
    process.exitCode = 1;
    break; // Do not turn a database/provider outage into a broad retry storm.
  }
}
console.log(JSON.stringify(summary, null, 2));
