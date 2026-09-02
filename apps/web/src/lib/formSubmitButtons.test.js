import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function listJsxFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...listJsxFiles(full));
    } else if (entry.name.endsWith(".jsx") && !entry.name.includes(".test.")) {
      found.push(full);
    }
  }
  return found;
}

// The shared `Button` primitive defaults to type="button" so it can be used
// freely inside forms without submitting them. That makes an implicit
// `<Button>Save</Button>` inside a `<form onSubmit={...}>` completely inert:
// the click does nothing and the submit handler never runs. Every button that
// is meant to submit must say so explicitly.
function findInertSubmitButtons(source) {
  const lines = source.split("\n");
  const offenders = [];
  let insideForm = false;

  lines.forEach((line, index) => {
    if (line.includes("<form")) insideForm = true;
    if (line.includes("</form>")) insideForm = false;
    if (!insideForm || !line.includes("<Button")) return;

    let tag = "";
    for (let cursor = index; cursor < Math.min(index + 8, lines.length); cursor += 1) {
      tag += lines[cursor];
      if (lines[cursor].includes(">")) break;
    }

    if (!tag.includes("type=") && !tag.includes("onClick")) {
      offenders.push(`${index + 1}: ${line.trim()}`);
    }
  });

  return offenders;
}

describe("form submit buttons", () => {
  it("never relies on the Button primitive to implicitly submit a form", () => {
    const offenders = [];

    for (const file of listJsxFiles(SRC_ROOT)) {
      const source = fs.readFileSync(file, "utf8");
      if (!source.includes("onSubmit")) continue;
      if (!/from ["']@pondbridge\/ui["']/.test(source)) continue;

      for (const hit of findInertSubmitButtons(source)) {
        offenders.push(`${path.relative(SRC_ROOT, file)}:${hit}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("flags a button that would silently fail to submit", () => {
    const broken = [
      '<form onSubmit={createCamp}>',
      '  <Button disabled={busy}>Create camp</Button>',
      "</form>"
    ].join("\n");

    expect(findInertSubmitButtons(broken)).toHaveLength(1);
    expect(findInertSubmitButtons(broken.replace("<Button", '<Button type="submit"'))).toEqual([]);
  });
});
