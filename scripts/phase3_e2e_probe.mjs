import { chromium } from 'playwright';

const baseUrl = process.env.PHASE3_BASE_URL ?? 'http://127.0.0.1:4173';
const phoneNumber = '+971501234567';
const phoneDigits = '501234567';
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
    nodes.slice(0, 160).map(n => ({
      label: n.getAttribute('aria-label'),
      role: n.getAttribute('role'),
      value: n.getAttribute('aria-valuetext'),
      text: (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 140),
    })).filter(x => x.label || x.text || x.role)
  );
  console.log(`SEMANTICS ${tag}: ${JSON.stringify(rows, null, 2)}`);
}

async function screenshot(tag) {
  await page.screenshot({ path: `phase3-${tag}.png`, fullPage: true });
}

async function verificationCodes() {
  const response = await fetch('http://127.0.0.1:9099/emulator/v1/projects/shadow-live/verificationCodes');
  if (!response.ok) return [];
  const body = await response.json();
  return body.verificationCodes ?? [];
}

async function waitForSmsCode(previousCode = null) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const codes = await verificationCodes();
    const matches = codes.filter(x => x.phoneNumber === phoneNumber);
    const latest = matches.at(-1) ?? codes.at(-1);
    const code = latest?.sessionCode ?? latest?.code ?? latest?.verificationCode ?? null;
    if (code && code !== previousCode) return String(code);
    await page.waitForTimeout(250);
  }
  throw new Error('Auth Emulator did not expose a fresh SMS verification code');
}

async function enterOtp(code) {
  await enableAccessibility();
  const otpInputs = page.getByRole('textbox');
  const count = await otpInputs.count();
  console.log('OTP_TEXTBOX_COUNT', count);
  if (count < 6) throw new Error(`Expected 6 OTP textboxes, found ${count}`);
  for (let i = 0; i < 6; i++) {
    await otpInputs.nth(i).fill(String(code)[i]);
    await page.waitForTimeout(180);
  }
}

async function openPhoneAndRequestOtp() {
  await page.getByRole('button', { name: 'متابعة برقم الهاتف' }).click();
  await page.waitForTimeout(700);
  await enableAccessibility();
  await page.mouse.click(282, 505);
  await page.keyboard.press('Control+A');
  await page.keyboard.type(phoneDigits);
  await page.getByRole('button', { name: 'إرسال عبر SMS' }).click();
  await page.waitForTimeout(900);
  await enableAccessibility();
  await page.getByText('رمز التحقق', { exact: true }).waitFor({ timeout: 10000 });
}

async function getUserDocument() {
  const res = await fetch('http://127.0.0.1:8080/v1/projects/shadow-live/databases/(default)/documents/users');
  if (!res.ok) throw new Error(`Failed to read users from Firestore emulator: ${res.status}`);
  const body = await res.json();
  const docs = body.documents ?? [];
  if (!docs.length) throw new Error('No user document found in Firestore emulator');
  return docs[0];
}

async function getPublicProfile(uid) {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/shadow-live/databases/(default)/documents/public_profiles/${uid}`);
  if (!res.ok) throw new Error(`Public profile missing for ${uid}: ${res.status}`);
  return res.json();
}

function stringField(doc, key) {
  return doc?.fields?.[key]?.stringValue ?? null;
}

function boolField(doc, key) {
  return doc?.fields?.[key]?.booleanValue ?? null;
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(4200);
  if (pageErrors.length) throw new Error(`Flutter page error: ${pageErrors.join(' | ')}`);

  await enableAccessibility();
  const flutterViewCount = await page.locator('flutter-view').count();
  const canvasCount = await page.locator('canvas').count();
  if (flutterViewCount === 0 && canvasCount === 0) throw new Error('Flutter root/canvas not found in browser DOM');
  await dump('onboarding');
  await screenshot('onboarding');

  let skip = page.locator('flt-semantics[aria-label="تخطي"]').first();
  if (!(await skip.count())) skip = page.getByText('تخطي', { exact: true }).first();
  if (!(await skip.count())) throw new Error('Onboarding skip control not found');
  await skip.click({ force: true });
  await page.waitForTimeout(700);

  await enableAccessibility();
  await page.getByText('تسجيل الدخول / إنشاء حساب', { exact: true }).waitFor({ timeout: 10000 });
  await dump('auth-choice');
  await screenshot('auth-choice');

  await openPhoneAndRequestOtp();
  await dump('otp-first');
  await screenshot('otp-first');
  const firstSmsCode = await waitForSmsCode();
  console.log('OTP_EMULATOR_CODE_RETRIEVED_FIRST');
  await enterOtp(firstSmsCode);

  await page.getByText('إنشاء الملف الشخصي', { exact: true }).waitFor({ timeout: 15000 });
  await enableAccessibility();
  await dump('profile-setup');
  await screenshot('profile-setup');
  console.log('PHASE3_PHONE_OTP_TO_PROFILE_SETUP_OK');

  const profileInputs = page.getByRole('textbox');
  const profileInputCount = await profileInputs.count();
  console.log('PROFILE_TEXTBOX_COUNT', profileInputCount);
  if (profileInputCount < 2) throw new Error(`Expected profile text fields, found ${profileInputCount}`);
  await profileInputs.nth(0).fill('اختبار شادو');

  await page.getByRole('button', { name: 'اختر تاريخ الميلاد' }).click();
  await page.getByRole('button', { name: 'اختيار' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'اختر الدولة (مطلوب)' }).click();
  const uae = page.getByText('🇦🇪 الإمارات العربية المتحدة', { exact: true }).last();
  await uae.waitFor({ timeout: 5000 });
  await uae.click();
  await page.waitForTimeout(400);

  await page.getByRole('button', { name: 'متابعة' }).click();
  await page.getByText('تم إنشاء حسابك بنجاح! 🎉', { exact: true }).waitFor({ timeout: 15000 });
  await enableAccessibility();
  await dump('success');
  await screenshot('success');
  console.log('PHASE3_PROFILE_TO_SUCCESS_OK');

  await page.getByRole('button', { name: 'التالي' }).click();
  await page.getByText('ربط الحسابات (اختياري)', { exact: true }).waitFor({ timeout: 12000 });
  await screenshot('linking');
  console.log('PHASE3_SUCCESS_TO_LINKING_OK');

  await page.getByRole('button', { name: 'لاحقاً' }).click();
  await page.getByText('أنت الآن جاهز!', { exact: true }).waitFor({ timeout: 12000 });
  await screenshot('ready');
  console.log('PHASE3_LINKING_TO_READY_OK');

  await page.getByRole('button', { name: 'ابدأ الاستكشاف' }).click();
  await page.getByText('الملف الشخصي', { exact: true }).last().waitFor({ timeout: 15000 });
  await enableAccessibility();
  await dump('main');
  await screenshot('main');
  console.log('PHASE3_READY_TO_MAIN_OK');

  const userDoc = await getUserDocument();
  const uid = userDoc.name.split('/').at(-1);
  const setupStep = stringField(userDoc, 'setupStep');
  const setupComplete = boolField(userDoc, 'setupComplete');
  if (setupStep !== 'complete' || setupComplete !== true) {
    throw new Error(`Unexpected setup state after Ready: step=${setupStep} complete=${setupComplete}`);
  }
  const publicProfile = await getPublicProfile(uid);
  if (stringField(publicProfile, 'uid') !== uid) throw new Error('public_profiles did not sync the user UID');
  console.log('PHASE3_FIRESTORE_SETUP_COMPLETE_OK', uid);

  await page.getByText('الملف الشخصي', { exact: true }).last().click();
  await page.waitForTimeout(900);
  await enableAccessibility();
  await dump('profile');
  await screenshot('profile');

  const settingsButton = page.getByRole('button', { name: 'الإعدادات' });
  await settingsButton.waitFor({ timeout: 8000 });
  await settingsButton.click();
  await page.getByText('إدارة معلومات الحساب والإعدادات', { exact: true }).waitFor({ timeout: 8000 });
  await screenshot('settings');

  await page.getByRole('button', { name: 'تسجيل الخروج' }).first().click();
  await page.getByText('هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'تسجيل الخروج' }).last().click();
  await page.getByText('تسجيل الدخول / إنشاء حساب', { exact: true }).waitFor({ timeout: 15000 });
  await screenshot('logged-out');
  console.log('PHASE3_LOGOUT_TO_AUTH_CHOICE_OK');

  const afterLogout = await getUserDocument();
  if (boolField(afterLogout, 'isOnline') !== false) throw new Error('User remained online after logout');
  const publicAfterLogout = await getPublicProfile(uid);
  if (boolField(publicAfterLogout, 'isOnline') !== false) throw new Error('Public profile remained online after logout');
  console.log('PHASE3_OFFLINE_SYNC_OK');

  await openPhoneAndRequestOtp();
  await screenshot('otp-second');
  const secondSmsCode = await waitForSmsCode(firstSmsCode);
  console.log('OTP_EMULATOR_CODE_RETRIEVED_SECOND');
  await enterOtp(secondSmsCode);

  await page.getByText('الملف الشخصي', { exact: true }).last().waitFor({ timeout: 15000 });
  if (await page.getByText('إنشاء الملف الشخصي', { exact: true }).count()) {
    throw new Error('Completed account was incorrectly routed back to Profile Setup');
  }
  await screenshot('main-after-relogin');
  const afterRelogin = await getUserDocument();
  if (boolField(afterRelogin, 'setupComplete') !== true || stringField(afterRelogin, 'setupStep') !== 'complete') {
    throw new Error('Completed setup state was not preserved after re-login');
  }
  if (boolField(afterRelogin, 'isOnline') !== true) throw new Error('User was not marked online after re-login');
  console.log('PHASE3_LOGOUT_LOGIN_MAIN_OK');
  console.log('PHASE3_FULL_E2E_OK');

  if (pageErrors.length) throw new Error(`Flutter page error(s): ${pageErrors.join(' | ')}`);
} finally {
  await context.close();
  await browser.close();
}
