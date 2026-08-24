import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIZARD_FILE = path.join(SRC_ROOT, "pages", "DirectorCreateAccountPage.jsx");
const source = fs.readFileSync(WIZARD_FILE, "utf8");

function stepOrder() {
  const block = source.match(/const STEP_ORDER = \[([\s\S]*?)\];/);
  return block[1]
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function handlerBody(name) {
  const start = source.indexOf(`function ${name}(event) {`);
  if (start < 0) return "";
  let depth = 0;
  for (let cursor = source.indexOf("{", start); cursor < source.length; cursor += 1) {
    if (source[cursor] === "{") depth += 1;
    if (source[cursor] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  return "";
}

// The submit handler advances to whichever step its final setStep names.
function targetStepOf(name) {
  const matches = [...handlerBody(name).matchAll(/setStep\((STEP_[A-Z_]+)\)/g)];
  return matches.length ? matches[matches.length - 1][1] : "";
}

// `{step === STEP_X ? (` opens the section rendered for that step; the first
// form inside it is the one whose submit button moves the director forward.
function submitHandlerRenderedOn(stepConst) {
  const start = source.indexOf(`{step === ${stepConst} ? (`);
  if (start < 0) return "";
  const form = source.slice(start).match(/<form[^>]*onSubmit=\{(\w+)\}/);
  return form ? form[1] : "";
}

describe("director onboarding wizard steps", () => {
  const order = stepOrder();
  const forwardSteps = order.slice(0, -1);

  it.each(forwardSteps)("the form on %s advances exactly one step", (stepConst) => {
    const handler = submitHandlerRenderedOn(stepConst);
    expect(handler).not.toBe("");
    expect(targetStepOf(handler)).toBe(order[order.indexOf(stepConst) + 1]);
  });

  // The mailing address is only rendered on the camp specifics step for a
  // returning director. Validating it from an earlier step used to bounce the
  // director straight past features to camp specifics, so every continue
  // handler must scope its account check to the step it is heading for.
  it.each(forwardSteps)("the form on %s validates against its own target step", (stepConst) => {
    const handler = submitHandlerRenderedOn(stepConst);
    const body = handlerBody(handler);
    const target = order[order.indexOf(stepConst) + 1];
    expect(body).toContain(`accountErrorsForStep(${target})`);
    expect(body).not.toMatch(/validateAccountStep\(\)/);
    expect(body).toContain(`nextStep: ${target}`);
  });
});
