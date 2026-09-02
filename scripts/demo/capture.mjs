import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "http://127.0.0.1:5174/t/cedar";
const OUT = "/private/tmp/claude-501/-Users-asoroca-Desktop-PondBridge-System/c326fa79-be38-4c8d-81c7-25ce8a9c811e/scratchpad/shots";
mkdirSync(OUT, { recursive: true });

const MEMBER = { email: "jordan.whitfield@cedar.example.test", password: "Pondbridge123!" };
const DIRECTOR = { email: "marc.ellison@cedar.example.test", password: "Pondbridge123!" };

const MEMBER_SHOTS = [
  ["02-home", "/home", 2500],
  ["03-advanced-search", "/search?industries=Technology&sort=name", 4000],
  ["04-search-results", "/search-results?q=Hollander", 3500],
  ["06-photo-stream", "/photo-stream", 3500],
  ["07-chat-forums", "/chat-rooms", 3000],
  ["08-cedar-chest", "/cedar-chest", 3000],
  ["09-family-trees", "/family-trees", 2500],
  ["10-family-tree-view", "/family-trees/familytree_demo_2", 3500],
  ["11-public-profile", "/profile/bb0000000000000000000003", 3000],
  ["12-events", "/events", 3000],
  ["13-my-profile", "/my-profile", 3000],
];

const ADMIN_SHOTS = [
  ["14-admin-dashboard", "/admin/dashboard", 3500],
  ["15-admin-people", "/admin/people/all", 3500],
  ["16-admin-events", "/admin/events", 3000],
  ["17-admin-email", "/admin/email/compose", 3000],
  ["18-admin-branding", "/admin/settings/branding", 3000],
  ["19-admin-features", "/admin/settings/features", 3000],
];

async function shoot(page, name, path, waitMs) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(waitMs);
  // Nudge lazy content, then return to the top for a clean frame.
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(600);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}  (${page.url()})`);
}

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);
  console.log(`logged in as ${email} -> ${page.url()}`);
}

const browser = await chromium.launch();

// Logged-out landing page.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await shoot(page, "01-landing", "/", 3000);
  await ctx.close();
}

// Member experience.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, MEMBER);
  for (const [name, path, wait] of MEMBER_SHOTS) {
    try {
      await shoot(page, name, path, wait);
    } catch (error) {
      console.error(`FAILED ${name}: ${error.message}`);
    }
  }

  // The map is worth a click: an unselected map only shows pins, while the
  // real value on a pitch slide is the "who lives in this city" panel.
  try {
    await page.goto(`${BASE}/location-map`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(9000);
    const clicked = await page.evaluate(() => {
      const canvas = document.querySelector(".maplibregl-canvas");
      if (!canvas) return false;
      const box = canvas.getBoundingClientRect();
      return { x: box.x, y: box.y, w: box.width, h: box.height };
    });
    if (clicked) {
      // The New York cluster sits just right of centre in the default view.
      await page.mouse.click(clicked.x + clicked.w * 0.545, clicked.y + clicked.h * 0.60);
      await page.waitForTimeout(3500);
    }
    await page.screenshot({ path: `${OUT}/05-alumni-map.png` });
    console.log("captured 05-alumni-map (with city selected)");
  } catch (error) {
    console.error(`FAILED 05-alumni-map: ${error.message}`);
  }

  await ctx.close();
}

// Director / admin experience.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page, DIRECTOR);
  for (const [name, path, wait] of ADMIN_SHOTS) {
    try {
      await shoot(page, name, path, wait);
    } catch (error) {
      console.error(`FAILED ${name}: ${error.message}`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log("done");
