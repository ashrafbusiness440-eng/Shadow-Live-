import { chromium } from 'playwright';

const baseUrl = process.env.PHASE3_BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'ar-AE' });
const page = await context.newPage();

page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
page.on('pageerror', err => console.log('[pageerror]', err.message));

async function enableAccessibility() {
  const placeholder = page.locator('flt-semantics-placeholder[aria-label="Enable accessibility"]');
  if (await placeholder.count()) {
    await placeholder.first().evaluate(el => el.click());
    await page.waitForTimeout(400);
  }
}

async function dump(tag) {
  const rows = await page.locator('flt-semantics').evaluateAll(nodes =>
    nodes.slice(0, 120).map(n => ({
      label: n.getAttribute('aria-label'),
      role: n.getAttribute('role'),
      value: n.getAttribute('aria-valuetext'),
      text: (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    })).filter(x => x.label || x.text || x.role)
  );
  console.log(`SEMANTICS ${tag}: ${JSON.stringify(rows, null, 2)}`);
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4200);
  await enableAccessibility();
  await dump('onboarding');
  await page.screenshot({ path: 'phase3-probe-onboarding.png', fullPage: true });

  let skip = page.locator('flt-semantics[aria-label="تخطي"]').first();
  if (!(await skip.count())) skip = page.getByText('تخطي', { exact: true }).first();
  if (await skip.count()) {
    await skip.click({ force: true });
    await page.waitForTimeout(800);
  } else {
    console.log('PROBE: skip control not found');
  }

  await enableAccessibility();
  await dump('auth-choice');
  await page.screenshot({ path: 'phase3-probe-auth-choice.png', fullPage: true });
} finally {
  await context.close();
  await browser.close();
}
