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

  // The six OTP boxes are Flutter text fields. Fill them through their
  // semantics-backed textbox nodes so this follows the same onChanged path as
  // a real user without relying on viewport coordinates.
  const otpInputs = page.getByRole('textbox');
  const otpInputCount = await otpInputs.count();
  console.log('OTP_TEXTBOX_COUNT', otpInputCount);
  if (otpInputCount < 6) {
    throw new Error(`Expected 6 OTP textboxes, found ${otpInputCount}`);
  }
  for (let i = 0; i < 6; i++) {
    await otpInputs.nth(i).fill(String(smsCode)[i]);
    await page.waitForTimeout(180);
  }
  // LoginScreen auto-submits as soon as the sixth digit is entered.
  // Do not click "تحقق" again because the route can already be transitioning.
  let profileReached = false;
  try {
    await page.getByText('إنشاء الملف الشخصي', { exact: true }).waitFor({ timeout: 15000 });
    profileReached = true;
  } catch (_) {
    const authRes = await fetch('http://127.0.0.1:9099/emulator/v1/projects/shadow-live/accounts');
    const authBody = authRes.ok ? await authRes.json() : { status: authRes.status };
    console.log('AUTH_EMULATOR_STATE', JSON.stringify(authBody));
    const fsRes = await fetch('http://127.0.0.1:8080/v1/projects/shadow-live/databases/(default)/documents/users');
    const fsBody = fsRes.ok ? await fsRes.json() : { status: fsRes.status };
    console.log('FIRESTORE_USERS_STATE', JSON.stringify(fsBody));
  }
  await enableAccessibility();
  await dump('profile-setup');
  await page.screenshot({ path: 'phase3-probe-profile-setup.png', fullPage: true });

  if (!profileReached) throw new Error('OTP completed but Profile Setup was not reached within 15s');
  console.log('PHASE3_PHONE_OTP_TO_PROFILE_SETUP_OK');

  // Complete the required Phase 3 setup journey through Main.
  const profileInputs = page.getByRole('textbox');
  const profileInputCount = await profileInputs.count();
  console.log('PROFILE_TEXTBOX_COUNT', profileInputCount);
  if (profileInputCount < 2) {
    throw new Error(`Expected profile name/bio textboxes, found ${profileInputCount}`);
  }
  await profileInputs.nth(0).fill('اختبار شادو');

  await page.getByRole('button', { name: 'اختر تاريخ الميلاد' }).click({ force: true });
  await page.getByRole('button', { name: 'اختيار' }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'اختيار' }).click({ force: true });

  await page.getByRole('button', { name: 'اختر الدولة (مطلوب)' }).click({ force: true });
  const uaeOption = page.getByText('🇦🇪 الإمارات العربية المتحدة', { exact: true }).last();
  await uaeOption.waitFor({ timeout: 5000 });
  await uaeOption.click({ force: true });

  await page.getByRole('button', { name: 'متابعة' }).click({ force: true });
  await page.getByText('تم إنشاء حسابك بنجاح! 🎉', { exact: true }).waitFor({ timeout: 20000 });
  await enableAccessibility();
  await dump('account-success');
  await page.screenshot({ path: 'phase3-probe-account-success.png', fullPage: true });
  console.log('PHASE3_PROFILE_TO_SUCCESS_OK');

  const nextButton = page.getByRole('button', { name: 'التالي' });
  await nextButton.waitFor({ timeout: 15000 });
  await nextButton.click({ force: true });
  await page.getByText('ربط الحسابات (اختياري)', { exact: true }).waitFor({ timeout: 15000 });
  await enableAccessibility();
  await dump('account-linking');
  await page.screenshot({ path: 'phase3-probe-account-linking.png', fullPage: true });

  await page.getByRole('button', { name: 'لاحقاً' }).click({ force: true });
  await page.getByText('أنت الآن جاهز!', { exact: true }).waitFor({ timeout: 15000 });
  await enableAccessibility();
  await dump('account-ready');
  await page.screenshot({ path: 'phase3-probe-account-ready.png', fullPage: true });

  await page.getByRole('button', { name: 'ابدأ الاستكشاف' }).click({ force: true });
  await page.getByText('صوتك يجمعنا', { exact: true }).waitFor({ timeout: 20000 });
  await enableAccessibility();
  await dump('main');
  await page.screenshot({ path: 'phase3-probe-main.png', fullPage: true });
  console.log('PHASE3_SETUP_TO_MAIN_OK');

  // Verify logout and that the same completed account returns directly to Main.
  await page.getByText('الملف الشخصي', { exact: true }).last().click({ force: true });
  await page.getByText('اختبار شادو', { exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'الإعدادات' }).click({ force: true });
  await page.getByText('حسابي', { exact: true }).waitFor({ timeout: 10000 });

  await page.getByRole('button', { name: 'تسجيل الخروج', exact: true }).first().click({ force: true });
  const logoutButtons = page.getByRole('button', { name: 'تسجيل الخروج', exact: true });
  await logoutButtons.last().waitFor({ timeout: 5000 });
  await logoutButtons.last().click({ force: true });
  await page.getByRole('button', { name: 'متابعة برقم الهاتف' }).waitFor({ timeout: 15000 });
  console.log('PHASE3_LOGOUT_OK');

  await page.getByRole('button', { name: 'متابعة برقم الهاتف' }).click({ force: true });
  await page.waitForTimeout(700);
  await page.mouse.click(282, 505);
  await page.keyboard.type('501234567');
  await page.getByRole('button', { name: 'إرسال عبر SMS' }).click();
  await page.waitForTimeout(900);

  let secondSmsCode = null;
  for (let attempt = 0; attempt < 20 && !secondSmsCode; attempt++) {
    const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/shadow-live/verificationCodes');
    if (response.ok) {
      const body = await response.json();
      const matches = (body.verificationCodes ?? []).filter(x => x.phoneNumber === '+971501234567');
      const latest = matches.at(-1);
      secondSmsCode = latest?.sessionCode ?? latest?.code ?? latest?.verificationCode ?? null;
      if (secondSmsCode === smsCode) secondSmsCode = null;
    }
    if (!secondSmsCode) await page.waitForTimeout(250);
  }
  if (!secondSmsCode) throw new Error('Auth Emulator did not expose a fresh SMS code for relogin');

  const secondOtpInputs = page.getByRole('textbox');
  const secondOtpCount = await secondOtpInputs.count();
  if (secondOtpCount < 6) throw new Error(`Expected 6 OTP textboxes on relogin, found ${secondOtpCount}`);
  for (let i = 0; i < 6; i++) {
    await secondOtpInputs.nth(i).fill(String(secondSmsCode)[i]);
    await page.waitForTimeout(180);
  }

  await page.getByText('صوتك يجمعنا', { exact: true }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: 'phase3-probe-relogin-main.png', fullPage: true });
  console.log('PHASE3_LOGOUT_LOGIN_MAIN_OK');
  console.log('PHASE3_FULL_ACCOUNT_JOURNEY_OK');
} finally {
  await context.close();
  await browser.close();
}
