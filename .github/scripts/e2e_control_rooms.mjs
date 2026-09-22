import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('control-e2e-screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});

const diagnostics = [];
page.on('pageerror', (error) => diagnostics.push(`PAGEERROR: ${error.stack || error.message || String(error)}`));
page.on('console', (message) => {
  if (message.type() === 'error') diagnostics.push(`CONSOLE ERROR: ${message.text()}`);
});

await page.goto('http://127.0.0.1:8090', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(7000);

const body = await page.locator('body').innerText();
if (!body.includes('إدارة الغرف')) {
  throw new Error('CONTROL_ROOMS_PAGE_MISSING');
}
if (!body.includes('Room Level + Overrides')) {
  throw new Error('CONTROL_ROOM_POLICY_UI_MISSING');
}

await page.screenshot({
  path: 'control-e2e-screenshots/rooms-control.png',
  fullPage: true,
});

fs.writeFileSync(
  'control-e2e-screenshots/browser-errors.log',
  diagnostics.length ? diagnostics.join('\n\n') : 'NO_BROWSER_ERRORS\n',
);

console.log(`Shadow Control diagnostic entries: ${diagnostics.length}`);
await browser.close();
