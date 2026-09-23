import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('e2e-screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});

const diagnostics = [];
page.on('pageerror', (error) => {
  diagnostics.push(`PAGEERROR: ${error.stack || error.message || String(error)}`);
});
page.on('console', (message) => {
  if (message.type() === 'error') {
    diagnostics.push(`CONSOLE ERROR: ${message.text()}`);
  }
});

await page.goto('http://127.0.0.1:8088', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(12000);

const tabs = [
  { name: 'home', x: 357 },
  { name: 'rooms', x: 292 },
  { name: 'voice', x: 227 },
  { name: 'games', x: 162 },
  { name: 'messages', x: 97 },
  { name: 'profile', x: 32 },
];

for (const tab of tabs) {
  await page.mouse.click(tab.x, 804);
  await page.waitForTimeout(4500);
  await page.screenshot({
    path: `e2e-screenshots/${tab.name}.png`,
    fullPage: true,
  });
}

fs.writeFileSync(
  'e2e-screenshots/browser-errors.log',
  diagnostics.length ? diagnostics.join('\n\n') : 'NO_BROWSER_ERRORS\n',
);

console.log(`Captured ${tabs.length} Shadow Live tab screenshots.`);
console.log(`Browser diagnostic entries: ${diagnostics.length}`);

await browser.close();
