import { chromium } from 'playwright';
import fs from 'node:fs';

fs.mkdirSync('room-e2e-screenshots', { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});

// Snapshot the ACTUAL room-stage widget, not just the Greedy Cat game.
// Entirely synthetic E2E fixtures; no real users, gifts or backend actions.
// This is a bounded four-case visual check (8/10/20/22 microphones).
const previews = [
  { name: '8-empty-inactive', seats: 8, supporters: 'empty', stars: 'off' },
  { name: '10-ranked-active', seats: 10, supporters: 'filled', stars: 'on' },
  { name: '20-ranked-active', seats: 20, supporters: 'filled', stars: 'on' },
  { name: '22-empty-active', seats: 22, supporters: 'empty', stars: 'on' },
  { name: '20-vip-entry-toast', seats: 20, supporters: 'filled', stars: 'on', effects: true },
];
const stage = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const visualDiagnostics = [];
stage.on('pageerror', error =>
  visualDiagnostics.push(String(error.stack || error.message || error)),
);
for (const preview of previews) {
  const params = new URLSearchParams({
    room_stage_preview: '1',
    seats: String(preview.seats),
    supporters: preview.supporters,
    stars: preview.stars,
    room_stage_fx: preview.effects ? '1' : '0',
  });
  const stageReady = stage.waitForEvent('console', {
    predicate: msg => msg.text().includes(
      'ROOM_E2E_STAGE_READY:' + preview.seats + ':' + preview.supporters + ':',
    ),
    timeout: 30000,
  });
  await stage.goto('http://127.0.0.1:8089/?' + params.toString(), {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await stageReady;
  await stage.waitForTimeout(preview.effects ? 650 : 900);
  await stage.screenshot({
    path: 'room-e2e-screenshots/stage-' + preview.name + '.png',
    fullPage: true,
  });
  console.log('ROOM_STAGE_VISUAL_CAPTURED:' + preview.name);
}
await stage.close();
if (visualDiagnostics.length) {
  throw new Error('ROOM_STAGE_BROWSER_ERRORS: ' + visualDiagnostics.slice(0, 3).join(' | '));
}
fs.writeFileSync(
  'room-e2e-screenshots/stage-browser-errors.log',
  visualDiagnostics.length
    ? visualDiagnostics.join('\\n\\n')
    : 'NO_STAGE_BROWSER_ERRORS\\n',
);

const diagnostics = [];
let gameOverlayReady = false;
let gameOverlayMarker = '';
let gameOverlayReadyAt = null;
const navigationStartedAt = Date.now();

page.on('pageerror', (error) => diagnostics.push(`PAGEERROR: ${error.stack || error.message || String(error)}`));
page.on('console', (message) => {
  const text = message.text();
  if (text.includes('E2E_GAME_OVERLAY_READY:greedy_cat')) {
    gameOverlayReady = true;
    gameOverlayMarker = text;
    gameOverlayReadyAt ??= Date.now();
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

const navigationToGameOverlayReadyMs =
  Math.max(0, (gameOverlayReadyAt ?? Date.now()) - navigationStartedAt);

fs.writeFileSync(
  'room-e2e-screenshots/performance-baseline.json',
  JSON.stringify({
    schemaVersion: 1,
    metric: 'navigationToGameOverlayReadyMs',
    valueMs: navigationToGameOverlayReadyMs,
    environment: 'CI_E2E_ROOM_TEST',
    productionSlo: false,
  }, null, 2) + '\n',
);

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
console.log(`PERF navigationToGameOverlayReadyMs=${navigationToGameOverlayReadyMs}`);
console.log(`Voice-room diagnostic entries: ${diagnostics.length}`);
await browser.close();
