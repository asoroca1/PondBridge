/** Synthetic staging route survey. Run with PLAYWRIGHT_MODULE pointing to Playwright. */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const origin = process.env.AUDIT_WEB_ORIGIN || 'http://127.0.0.1:5184';
const api = process.env.AUDIT_API_ORIGIN || 'http://127.0.0.1:4010';
if (![origin, api].every(value => ['127.0.0.1', 'localhost'].includes(new URL(value).hostname))) throw new Error('Only isolated loopback staging is supported');
const health = await (await fetch(`${api}/health`)).json();
if (health.integrations?.email?.mode !== 'mock') throw new Error('Expected staging mock email mode');
const output = path.resolve(process.env.AUDIT_OUTPUT || 'docs/audit-2026-09-06/evidence');
await mkdir(output, { recursive: true });
const groups = {
 public: ['/', '/t/cedar', '/t/cedar/login', '/t/cedar/forgot-password', '/t/cedar/create-account', '/t/cedar/legal', '/t/pine-control', '/t/fresh-camp', '/t/not-a-real-camp', '/super/login','/email-preferences','/404'],
 member: ['home','my-profile','edit-profile','search','photo-stream','chat-rooms','newsletter','location-map','family-trees','family-trees/new','events','giving','giving/new','notifications','admin/dashboard'],
 director: ['admin/dashboard','admin/people/all','admin/people/member','admin/people/request','admin/people/invited','admin/people/add','admin/events/calendar','admin/events/upcoming','admin/events/drafts','admin/events/past','admin/giving/pending','admin/giving/active','admin/email/compose','admin/email/inbox','admin/email/sent','admin/email/drafts','admin/email/templates','admin/email/scheduled','admin/email/groups','admin/email/blocked','admin/billing','admin/settings/network','admin/settings/features','admin/settings/branding','admin/settings/access','admin/settings/admins','admin/settings/support','admin/settings/notifications','admin/settings/danger'],
 super: ['/super','/super/dashboard','/super/status','/super/tenants','/super/tenants/create','/super/tenants/tenant_local_cedar','/super/email','/super/email/transactional','/super/billing','/super/billing/tenants','/super/billing/failed','/super/finance','/super/finance/costs','/super/costs','/super/settings']
};
const mode = process.argv[2] || 'member';
if (!groups[mode]) throw new Error(`Unknown role ${mode}`);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [], failures = [];
page.on('pageerror', error => consoleErrors.push(error.message));
page.on('response', response => { if (response.status() >= 400) failures.push({ status: response.status(), url: response.url().replace(/\?.*/, '') }); });
async function settle() {
 await page.waitForLoadState('networkidle', { timeout: 7000 }).catch(() => {});
 await page.locator('body').waitFor();
}
if (mode !== 'public') {
 await page.goto(`${origin}${mode === 'super' ? '/super/login' : '/t/cedar/login'}`);
 await settle();
 await page.getByLabel(/email/i).first().fill(mode === 'super' ? 'superadmin@pondbridge.example.test' : mode === 'director' ? 'director@cedar.example.test' : 'alex.rivera@cedar.example.test');
 await page.getByLabel(/^password/i).fill(mode === 'super' ? 'SuperAdmin123!' : 'Pondbridge123!');
 await page.getByRole('button', {name: /^(login|sign in)$/i}).last().click();
 await page.waitForURL(url => !url.pathname.endsWith('/login'), { timeout: 30000 });
 await settle();
 const later = page.getByRole('button', { name: 'Maybe Later', exact: true });
 if (await later.isVisible()) await later.click();
}
const results = [];
try {
 for (const route of groups[mode]) {
  const target = route.startsWith('/') ? route : `/t/cedar/${route}`;
  const errorStart = consoleErrors.length, failureStart = failures.length;
  await page.goto(`${origin}${target}`);
  await settle();
  const name = `${mode}-${target.replace(/^\//, '').replaceAll('/', '-') || 'root'}`;
  const data = await page.evaluate(() => ({
   url: location.pathname,
   title: document.title,
   headings: [...document.querySelectorAll('h1,h2,h3')].map(x => x.textContent.trim()),
   text: document.body.innerText.slice(0, 20000),
   links: [...document.querySelectorAll('a[href]')].map(x => ({text: x.textContent.trim(), href: x.getAttribute('href')})),
   buttons: [...document.querySelectorAll('button')].map(x => ({text: (x.getAttribute('aria-label') || x.textContent).trim(), disabled: x.disabled})),
   overflow: document.documentElement.scrollWidth > innerWidth + 1,
   unlabeledInputs: [...document.querySelectorAll('input:not([type=hidden]),textarea,select')].filter(x => !x.labels?.length && !x.getAttribute('aria-label') && !x.getAttribute('aria-labelledby') && !['submit','button'].includes(x.type)).map(x=>({type:x.type, placeholder:x.placeholder, name:x.name})),
  }));
  await page.screenshot({path: path.join(output, `${name}.png`), fullPage: true});
  await page.setViewportSize({width:375,height:812});
  await page.waitForTimeout(400); // Let responsive drawer/accordion transitions settle.
  const mobile = await page.evaluate(() => ({overflow:document.documentElement.scrollWidth > innerWidth + 1, width:document.documentElement.scrollWidth}));
  await page.screenshot({path:path.join(output, `${name}-mobile.png`)});
  await page.setViewportSize({width:768,height:1024});
  await page.waitForTimeout(400);
  const tablet = await page.evaluate(() => ({overflow:document.documentElement.scrollWidth > innerWidth + 1, width:document.documentElement.scrollWidth}));
  await page.setViewportSize({width:1440,height:1000});
  const result = {requested:target,...data,mobile,tablet,pageErrors:consoleErrors.slice(errorStart),httpErrors:failures.slice(failureStart),screenshot:`${name}.png`};
  results.push(result);
  console.log(JSON.stringify({route:target,actual:data.url,headings:data.headings,overflow:[data.overflow,mobile.overflow,tablet.overflow],errors:result.httpErrors}));
  await writeFile(path.join(output, `${mode}-routes.json`), JSON.stringify(results,null,2));
 }
} finally { await browser.close(); }
