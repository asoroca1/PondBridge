import { z } from "zod";
import { cellKey, coerceCell, importFieldByPath, isKnownImportField } from "./importFieldMap.js";

/**
 * Tidies up the answers the deterministic parsers cannot read.
 *
 * The parsers handle most of a questionnaire exactly: "Brooklyn, NY" through the
 * same canonicalizer signup uses, "1998" straight through. What they give up on is
 * the free text people actually write — "summers of 98 through 04", "PM at a
 * fintech startup since covid". Those cells, and only those, come here.
 *
 * Two rules make this safe to run unattended:
 *
 * 1. The model normalizes, it never fills. Its job is to restructure what the cell
 *    already says. A cell with no year in it comes back null, not a plausible year.
 * 2. Whatever it returns is put back through the same deterministic parser the
 *    cell failed. The model cannot write a value that a hand-typed answer could
 *    not also produce, so it has no way to bypass validation.
 */

export { cellKey };

/** The one signal that a cell needs help: mapped, not blank, and the parser refused it. */
export function needsCleanup(path, rawValue) {
  if (!isKnownImportField(path)) return false;
  if (!String(rawValue ?? "").trim()) return false;
  return coerceCell(path, rawValue) === null;
}


/**
 * Every distinct (field, value) pair the parsers could not read.
 *
 * Deduplicated, and that is most of the saving: "n/a", "-", "still deciding" and
 * the like repeat across hundreds of responses, and a camp's whole questionnaire
 * usually reduces to a few dozen genuinely distinct problem values.
 */
export function collectUnparseableCells(rows = [], mapping = {}) {
  const unique = new Map();

  for (const row of rows) {
    for (const [column, target] of Object.entries(mapping || {})) {
      const paths = (Array.isArray(target) ? target : [target])
        .map((path) => String(path || "").trim())
        .filter(Boolean);
      const raw = String(row?.[column] ?? "").trim();
      if (!raw) continue;

      for (const path of paths) {
        if (!needsCleanup(path, raw)) continue;
        const key = cellKey(path, raw);
        if (unique.has(key)) {
          unique.get(key).occurrences += 1;
          continue;
        }
        unique.set(key, { key, path, column, raw, occurrences: 1 });
      }
    }
  }

  return [...unique.values()];
}

export const CleanupSchema = z.object({
  values: z.array(
    z.object({
      id: z.number(),
      value: z.string().nullable(),
      reason: z.string()
    })
  )
});

export function buildCleanupInstructions() {
  return [
    "You tidy up single answers from a summer camp's alumni questionnaire so they can be stored.",
    "",
    "Each item gives you a field, what that field holds, and one raw answer a person typed.",
    "Return the same information rewritten in the form the field expects.",
    "",
    "Rules:",
    "- Rewrite only. Never add information the answer does not contain. If someone wrote",
    "  \"a few summers in the nineties\", there is no specific year in that, so return null.",
    "- Return null for anything that is not really an answer: \"n/a\", \"-\", \"ask me\", \"?\".",
    "- Years are four digits. A camp has been running since long before 2000, so \"98\" is 1998.",
    "- A city goes back as \"City, ST\" for the United States, or \"City, Country\" elsewhere.",
    "- A job title is the title alone, with the employer left out of it.",
    "- Several values in one answer are separated with a semicolon.",
    "- reason is a few words saying what you changed, for a director reading a preview."
  ].join("\n");
}

export function buildCleanupRequest(cells = []) {
  return {
    items: cells.map((cell, index) => ({
      id: index,
      field: cell.path,
      holds: importFieldByPath(cell.path)?.label || cell.path,
      answer: cell.raw
    }))
  };
}

/**
 * Turns the model's answers into values the importer can use.
 *
 * Everything it returns goes back through `coerceCell` — the same parser that
 * rejected the raw cell. A rewrite that still does not parse is dropped, so the
 * worst case is the cell stays empty, exactly as it would have without this step.
 */
export function applyCleanupResults(cells = [], results = []) {
  const byId = new Map(
    (Array.isArray(results) ? results : [])
      .filter((entry) => entry && Number.isInteger(entry.id))
      .map((entry) => [entry.id, entry])
  );

  const cleaned = new Map();
  const preview = [];

  cells.forEach((cell, index) => {
    const result = byId.get(index);
    const suggested = result?.value === null || result?.value === undefined
      ? ""
      : String(result.value).trim();
    if (!suggested) return;

    const coerced = coerceCell(cell.path, suggested);
    if (coerced === null) return;

    cleaned.set(cell.key, coerced);
    preview.push({
      field: cell.path,
      column: cell.column,
      before: cell.raw,
      after: coerced,
      occurrences: cell.occurrences,
      reason: String(result.reason || "").trim()
    });
  });

  return { cleaned, preview };
}
