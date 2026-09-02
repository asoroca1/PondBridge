import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// iCloud Drive resolves sync conflicts by writing a numbered sibling next to the
// real file ("NativeAppExperience 2.jsx", "build 3.gradle", "gradlew 2"). They are
// never source. Left alone they pollute search results, get bundled into native
// app binaries through folder references, and sit next to real Gradle/Xcode
// config where they are genuinely confusing.

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ALWAYS_SKIP = new Set(["node_modules", ".git", "DerivedData"]);
// Skipped only on a default whole-repo sweep. When a caller names a path
// explicitly it is scanned in full, because build output is exactly where iCloud
// restores conflict copies between `vite build` and `cap copy`.
const SKIP_ON_FULL_SWEEP = new Set(["dist", "build", ".local-staging"]);
const CONFLICT_PATTERN = /^(?<stem>.+) \d+(?<ext>\.[A-Za-z0-9]+)?$/;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const checkOnly = args.includes("--check");
const label = checkOnly ? "verify:no-icloud-dups" : "clean:icloud-dups";
const targets = args.filter((arg) => !arg.startsWith("--"));
const scanRoots = targets.length > 0 ? targets.map((t) => path.resolve(repoRoot, t)) : [repoRoot];
const fullSweep = targets.length === 0;

function collectConflictCopies(directory, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (ALWAYS_SKIP.has(entry.name)) continue;
      if (fullSweep && SKIP_ON_FULL_SWEEP.has(entry.name)) continue;
      collectConflictCopies(fullPath, found);
      continue;
    }
    if (!entry.isFile()) continue;

    const match = CONFLICT_PATTERN.exec(entry.name);
    if (!match) continue;

    // Only treat it as a conflict copy when the real file is still present, or
    // when git knows the original was deliberately deleted. Anything else may be
    // a legitimately named file and is left for a human to judge.
    const original = path.join(directory, `${match.groups.stem}${match.groups.ext || ""}`);
    found.push({ path: fullPath, orphaned: !fs.existsSync(original) });
  }

  return found;
}

const copies = scanRoots.flatMap((root) => collectConflictCopies(root));

if (copies.length === 0) {
  console.log(`[${label}] OK: no iCloud conflict copies found.`);
  process.exit(0);
}

// --check is a release gate rather than a cleanup: fail loudly so a native build
// cannot quietly bundle files iCloud restored after the web build finished.
if (checkOnly) {
  console.error(
    `[${label}] Found ${copies.length} iCloud conflict ${copies.length === 1 ? "copy" : "copies"} ` +
      "in output that is about to be shipped:"
  );
  for (const copy of copies) {
    console.error(` - ${path.relative(repoRoot, copy.path)}`);
  }
  console.error(
    "Run `npm run clean:icloud-dups` and rebuild. If this keeps recurring, move the " +
      "repository out of iCloud Drive — see docs/NATIVE_SHELL.md."
  );
  process.exit(1);
}

const orphaned = copies.filter((copy) => copy.orphaned);
const shadowing = copies.filter((copy) => !copy.orphaned);

console.log(
  `[${label}] Found ${copies.length} conflict ${copies.length === 1 ? "copy" : "copies"} ` +
    `(${shadowing.length} beside an existing file, ${orphaned.length} with no original).`
);

for (const copy of copies) {
  const relative = path.relative(repoRoot, copy.path);
  const suffix = copy.orphaned ? " (no original — verify before trusting removal)" : "";
  if (dryRun) {
    console.log(` would remove ${relative}${suffix}`);
    continue;
  }
  try {
    fs.rmSync(copy.path);
    console.log(` removed ${relative}${suffix}`);
  } catch (error) {
    console.error(` failed ${relative}: ${error?.message || error}`);
  }
}

if (dryRun) {
  console.log(`[${label}] Dry run only. Re-run without --dry-run to delete.`);
} else if (orphaned.length > 0) {
  console.log(
    `[${label}] Removed copies whose original is gone. If one held work you ` +
      "still need, recover it with `git log --diff-filter=D --` for that path."
  );
}
