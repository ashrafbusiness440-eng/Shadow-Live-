import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('room-e2e-screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});

const diagnostics = [];
let gameOverlayReady = false;
let gameOverlayMarker = '';
page.on('pageerror', (error) => diagnostics.push(`PAGEERROR: ${error.stack || error.message || String(error)}`));
page.on('console', (message) => {
  const text = message.text();
  if (text.includes('E2E_GAME_OVERLAY_READY:greedy_cat')) {
    gameOverlayReady = true;
    gameOverlayMarker = text;
  }
  if (message.type() === 'error') diagnostics.push(`CONSOLE ERROR: ${text}`);
});

await page.goto('http://127.0.0.1:8089', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(10000);

if (!gameOverlayReady) {
  throw new Error('GREEDY_CAT_OVERLAY_NOT_RENDERED_INSIDE_VOICE_ROOM');
}

await page.screenshot({
  path: 'room-e2e-screenshots/voice-room-greedy-cat-full.png',
  fullPage: true,
});

await page.screenshot({
  path: 'room-e2e-screenshots/voice-room-greedy-cat-overlay.png',
  clip: { x: 0, y: 250, width: 390, height: 594 },
});

fs.writeFileSync(
  'room-e2e-screenshots/browser-errors.log',
  diagnostics.length ? diagnostics.join('\n\n') : 'NO_BROWSER_ERRORS\n',
);

console.log(`Greedy Cat marker: ${gameOverlayMarker}`);
console.log(`Voice-room diagnostic entries: ${diagnostics.length}`);
await browser.close();
