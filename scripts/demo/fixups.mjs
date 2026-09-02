import { chromium } from "playwright";

const BASE = "http://127.0.0.1:5174/t/cedar";
const OUT = "/private/tmp/claude-501/-Users-asoroca-Desktop-PondBridge-System/c326fa79-be38-4c8d-81c7-25ce8a9c811e/scratchpad/shots";

const browser = await chromium.launch();

async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', "Pondbridge123!");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  return { ctx, page };
}

// Member: an open conversation reads far better than an empty right pane.
{
  const { ctx, page } = await session("jordan.whitfield@cedar.example.test");
  await page.goto(`${BASE}/chat-rooms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);
  await page.getByText("Priya Raghunathan").first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/07-chat-forums.png` });
  console.log("saved 07-chat-forums (conversation open)");

  try {
    await page.goto(`${BASE}/chat-rooms`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
    await page.getByText("Forums", { exact: true }).first().click({ timeout: 8000 });
    await page.waitForTimeout(2500);
    await page.getByText("Cedar Careers & Referrals").first().click({ timeout: 8000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT}/07b-forums.png` });
    console.log("saved 07b-forums");
  } catch (error) {
    console.error(`forums shot skipped: ${error.message.split("\n")[0]}`);
  }
  await ctx.close();
}

// Director: select a member so the detail rail is populated.
{
  const { ctx, page } = await session("marc.ellison@cedar.example.test");
  await page.goto(`${BASE}/admin/people/all`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4000);
  await page.getByText("Mira Chandrasekar").first().click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/15-admin-people.png` });
  console.log("saved 15-admin-people (member selected)");
  await ctx.close();
}

await browser.close();
