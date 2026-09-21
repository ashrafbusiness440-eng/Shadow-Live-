import { chromium } from 'playwright';

const baseUrl = process.env.PHASE3_BASE_URL ?? 'http://127.0.0.1:4173';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'ar-AE' });
const page = await context.newPage();
const pageErrors = [];

page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
page.on('pageerror', err => {
  pageErrors.push(err.message);
  console.log('[pageerror]', err.message);
});

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
  if (pageErrors.length) {
    throw new Error(`Flutter page error: ${pageErrors.join(' | ')}`);
  }
  await enableAccessibility();
  await dump('onboarding');
  const flutterViewCount = await page.locator('flutter-view').count();
  const canvasCount = await page.locator('canvas').count();
  const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
  console.log('PROBE DOM:', { flutterViewCount, canvasCount, bodyTextLength: bodyText.length });
  if (flutterViewCount === 0 && canvasCount === 0) {
    throw new Error('Flutter root/canvas not found in browser DOM');
  }
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

  const phoneButton = page.getByRole('button', { name: 'متابعة برقم الهاتف' });
  await phoneButton.click();
  await page.waitForTimeout(700);
  await enableAccessibility();
  await dump('phone');
  await page.screenshot({ path: 'phase3-probe-phone.png', fullPage: true });

  // Flutter web keeps the editable surface separate from the semantics button
  // tree. Click the visible phone field and type a fictional UAE test number.
  await page.mouse.click(282, 505);
  await page.keyboard.type('501234567');
  await page.getByRole('button', { name: 'إرسال عبر SMS' }).click();

  await page.waitForTimeout(900);
  await enableAccessibility();
  await dump('otp');
  await page.screenshot({ path: 'phase3-probe-otp.png', fullPage: true });

  let smsCode = null;
  for (let attempt = 0; attempt < 20 && !smsCode; attempt++) {
    const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/shadow-live/verificationCodes');
    if (response.ok) {
      const body = await response.json();
      const codes = body.verificationCodes ?? [];
      const latest = codes.find(x => x.phoneNumber === '+971501234567') ?? codes.at(-1);
      smsCode = latest?.sessionCode ?? latest?.code ?? latest?.verificationCode ?? null;
    }
    if (!smsCode) await page.waitForTimeout(250);
  }
  if (!smsCode) throw new Error('Auth Emulator did not expose an SMS verification code');
  console.log('OTP_EMULATOR_CODE_RETRIEVED');

  // LoginScreen automatically focuses the first OTP field. Its onChanged
  // handler advances focus after every digit, so typing the six digits follows
  // the same path as a real user.
  await page.mouse.click(44, 578);
  for (const digit of String(smsCode)) {
    await page.keyboard.press(digit);
    await page.waitForTimeout(180);
  }
  await page.waitForTimeout(2600);
  await enableAccessibility();
  await dump('profile-setup');
  await page.screenshot({ path: 'phase3-probe-profile-setup.png', fullPage: true });

  const profileSetupVisible = await page.getByText('إنشاء الملف الشخصي', { exact: true }).count();
  if (!profileSetupVisible) throw new Error('OTP completed but Profile Setup was not reached');
  console.log('PHASE3_PHONE_OTP_TO_PROFILE_SETUP_OK');
} finally {
  await context.close();
  await browser.close();
}
