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
page.on('pageerror', (error) => diagnostics.push(`PAGEERROR: ${error.stack || error.message || String(error)}`));
page.on('console', (message) => {
  const text = message.text();
  if (text.includes('E2E_GAME_OVERLAY_READY:')) gameOverlayReady = true;
  if (message.type() === 'error') diagnostics.push(`CONSOLE ERROR: ${text}`);
});

await page.goto('http://127.0.0.1:8089', {
  waitUntil: 'domcontentloaded',
  timeout: 120000,
});
await page.waitForTimeout(10000);

if (!gameOverlayReady) {
  throw new Error('GAME_OVERLAY_NOT_RENDERED_INSIDE_VOICE_ROOM');
}

await page.screenshot({
  path: 'room-e2e-screenshots/voice-room-game-overlay.png',
  fullPage: true,
});

fs.writeFileSync(
  'room-e2e-screenshots/browser-errors.log',
  diagnostics.length ? diagnostics.join('\n\n') : 'NO_BROWSER_ERRORS\n',
);

console.log(`Voice-room diagnostic entries: ${diagnostics.length}`);
await browser.close();
