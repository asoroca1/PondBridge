/** Run with a locally installed Playwright, or PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const source = await readFile(new URL("../apps/web/src/lib/dialogFocus.js", import.meta.url), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(`<button id="opener">Open</button>
    <div id="outer" role="dialog" tabindex="-1">
      <input type="hidden"><button style="display:none">Hidden</button>
      <div aria-hidden="true"><button>Hidden ancestor</button></div>
      <button tabindex="-1">Not a tab stop</button>
      <fieldset disabled><button>Disabled by fieldset</button></fieldset>
      <button id="first">First</button><button id="last">Last</button>
    </div>`);
  await page.addScriptTag({ content: source.replace("export function activateDialogFocus", "function activateDialogFocus") });
  await page.evaluate(() => {
    document.querySelector("#opener").focus();
    window.closedDialogs = [];
    window.closeOuter = activateDialogFocus(document.querySelector("#outer"), () => closedDialogs.push("outer"));
  });
  await page.waitForFunction(() => document.activeElement.id === "first");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "last", "Reverse Tab skips hidden and disabled controls");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "first", "Tab wraps in the active dialog");
  await page.evaluate(() => document.querySelector("#opener").focus());
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "first", "Tab recovers escaped focus");
  await page.evaluate(() => {
    document.querySelector("#last").focus();
    document.querySelector("#outer").insertAdjacentHTML("beforeend", '<div id="inner" role="dialog" tabindex="-1"><button id="cancel">Cancel</button><button id="confirm">Confirm</button></div>');
    window.closeInner = activateDialogFocus(document.querySelector("#inner"), () => closedDialogs.push("inner"));
  });
  await page.waitForFunction(() => document.activeElement.id === "cancel");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "confirm", "Nested dialog owns focus wrapping");
  await page.keyboard.press("Escape");
  assert.deepEqual(await page.evaluate(() => closedDialogs), ["inner"], "Escape closes only the top dialog");
  await page.evaluate(() => {
    closeInner();
    document.querySelector("#inner").remove();
  });
  assert.equal(await page.evaluate(() => document.activeElement.id), "last", "Closing nested dialog restores its trigger");
  await page.evaluate(() => {
    document.querySelector("#last").addEventListener("keydown", event => event.preventDefault(), { once: true });
  });
  await page.keyboard.press("Escape");
  assert.deepEqual(await page.evaluate(() => closedDialogs), ["inner"], "Consumed Escape leaves the dialog open");
  await page.evaluate(() => closeOuter());
  assert.equal(await page.evaluate(() => document.activeElement.id), "opener", "Closing dialog restores external trigger");

  // React runs nested child effects before parent effects on initial mount.
  await page.evaluate(() => {
    document.querySelector("#outer").insertAdjacentHTML("beforeend", '<div id="child" tabindex="-1"><button id="child-button">Child</button></div>');
    window.closeChild = activateDialogFocus(document.querySelector("#child"), () => closedDialogs.push("child"));
    window.closeParent = activateDialogFocus(document.querySelector("#outer"), () => closedDialogs.push("parent"));
  });
  await page.waitForFunction(() => document.activeElement.id === "child-button");
  await page.keyboard.press("Escape");
  assert.deepEqual(await page.evaluate(() => closedDialogs), ["inner", "child"], "Initially nested child remains topmost");
  await page.evaluate(() => closeParent());
  assert.equal(await page.evaluate(() => document.activeElement.id), "child-button", "Removing an underlying dialog does not steal focus");
  await page.evaluate(() => closeChild());
  console.log("PASS: dialog keyboard regression checks (Chromium)");
} finally {
  await browser.close();
}
