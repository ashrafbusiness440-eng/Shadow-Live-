import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('room-e2e-screenshots', { recursive: true });

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

await page.goto('http://127.0.0.1:8089', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(10000);

await page.screenshot({
  path: 'room-e2e-screenshots/voice-room.png',
  fullPage: true,
});

fs.writeFileSync(
  'room-e2e-screenshots/browser-errors.log',
  diagnostics.length ? diagnostics.join('\n\n') : 'NO_BROWSER_ERRORS\n',
);

console.log(`Voice-room diagnostic entries: ${diagnostics.length}`);
await browser.close();
