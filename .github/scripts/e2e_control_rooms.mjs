import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('control-e2e-screenshots', { recursive: true });

// CI runners already ship Google Chrome; avoid remote Chromium downloads.
// Local development keeps the Playwright-managed browser as before.
const browser = await chromium.launch({
  headless: true,
  channel: process.env.GITHUB_ACTIONS === 'true' ? 'chrome' : undefined,
});
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

await page.screenshot({
  path: 'control-e2e-screenshots/economy-control.png',
  fullPage: true,
});

const flutterViewCount = await page.locator('flutter-view').count();
if (flutterViewCount < 1) {
  throw new Error('CONTROL_FLUTTER_VIEW_MISSING');
}

fs.writeFileSync(
  'control-e2e-screenshots/browser-errors.log',
  diagnostics.length ? diagnostics.join('\n\n') : 'NO_BROWSER_ERRORS\n',
);

console.log(`Shadow Control economy diagnostic entries: ${diagnostics.length}`);
await browser.close();
