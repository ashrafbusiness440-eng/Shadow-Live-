import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const baseUrl = process.env.PHASE3_BASE_URL ?? 'http://127.0.0.1:4173';
const phoneNumber = '+971501234567';
const phoneDigits = '501234567';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, locale: 'ar-AE' });
const page = await context.newPage();
const pageErrors = [];
const adminApp = initializeApp({ projectId: 'shadow-live' }, 'phase3-e2e');
const adminDb = getFirestore(adminApp);
const adminAuth = getAuth(adminApp);

page.on('console', msg => console.log('[browser]', msg.type(), msg.text()));
page.on('pageerror', err => {
  const detail = err.stack || (err.name + ': ' + err.message);
  pageErrors.push(detail);
  console.log('[pageerror]', detail);
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
  const listed = await adminAuth.listUsers(100);
  const authUser = listed.users.find(u => u.phoneNumber === phoneNumber);
  if (!authUser) throw new Error('Authenticated phone user not found in Auth Emulator');
  const snap = await adminDb.collection('users').doc(authUser.uid).get();
  if (!snap.exists) throw new Error('Matching user document not found for authenticated UID');
  return { id: authUser.uid, data: snap.data() };
}

async function getPublicProfile(uid) {
  const snap = await adminDb.collection('public_profiles').doc(uid).get();
  if (!snap.exists) throw new Error('Public profile missing for ' + uid);
  return snap.data();
}

function stringField(doc, key) {
  const value = doc?.[key];
  return typeof value === 'string' ? value : null;
}

function boolField(doc, key) {
  const value = doc?.[key];
  return typeof value === 'boolean' ? value : null;
}

async function waitForUserField(key, predicate, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const doc = await getUserDocument();
    const value = doc.data?.[key];
    if (predicate(value, doc.data)) return { ...doc, value };
    await page.waitForTimeout(300);
  }
  throw new Error('Timed out waiting for user field ' + key);
}

async function assertUnauthStorageDenied(uid) {
  const name = encodeURIComponent('profile_images/' + uid + '-unauth.jpg');
  const response = await fetch(
    'http://127.0.0.1:9199/v0/b/shadow-live.firebasestorage.app/o?uploadType=media&name=' + name,
    {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    },
  );
  if (response.ok) throw new Error('Storage rules allowed unauthenticated profile image upload');
  console.log('PHASE3_STORAGE_UNAUTH_DENIED_OK', response.status);
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
  const initialContinue = page.getByRole('button', { name: 'متابعة' });
  if (await initialContinue.getAttribute('aria-disabled') !== 'true') {
    throw new Error('Profile Setup continue button should be disabled before required fields are filled');
  }
  console.log('PHASE3_PROFILE_REQUIRED_FIELDS_GUARD_OK');
  await profileInputs.nth(0).fill('اختبار شادو');

  await page.getByRole('button', { name: 'اختر تاريخ الميلاد' }).click();
  await page.getByRole('button', { name: 'اختيار' }).click();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: 'اختر الدولة (مطلوب)' }).click();
  await page.waitForTimeout(300);
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Re-dispatch the display-name change after the dropdown closes so Flutter
  // recomputes the Profile Setup readiness state deterministically in web semantics.
  await profileInputs.nth(0).fill('اختبار شادو');
  await page.waitForTimeout(300);

  const continueButton = page.getByRole('button', { name: 'متابعة' });
  await continueButton.waitFor({ state: 'visible', timeout: 5000 });
  for (let attempt = 0; attempt < 20 && await continueButton.getAttribute('aria-disabled') === 'true'; attempt++) {
    await page.waitForTimeout(150);
  }
  if (await continueButton.getAttribute('aria-disabled') === 'true') {
    await dump('profile-setup-country-selection-failed');
    throw new Error('Profile Setup continue button stayed disabled after selecting UAE');
  }
  await continueButton.click({ force: true });
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
  const uid = userDoc.id;
  const setupStep = stringField(userDoc.data, 'setupStep');
  const setupComplete = boolField(userDoc.data, 'setupComplete');
  if (setupStep !== 'complete' || setupComplete !== true) {
    throw new Error(`Unexpected setup state after Ready: step=${setupStep} complete=${setupComplete}`);
  }
  const publicProfile = await getPublicProfile(uid);
  if (stringField(publicProfile, 'uid') !== uid) throw new Error('public_profiles did not sync the user UID');
  console.log('PHASE3_FIRESTORE_SETUP_COMPLETE_OK', uid);

  await page.getByRole('button', { name: 'الملف الشخصي' }).dispatchEvent('click');
  await page.waitForTimeout(900);
  await enableAccessibility();
  await dump('profile');
  await screenshot('profile');

  const settingsButton = page.getByRole('button', { name: 'الإعدادات' });
  await settingsButton.waitFor({ timeout: 8000 });
  await settingsButton.dispatchEvent('click');
  await page.getByText('إدارة معلومات الحساب والإعدادات', { exact: true }).waitFor({ timeout: 8000 });
  await screenshot('settings');

  await page.getByRole('button', { name: 'تسجيل الخروج' }).first().dispatchEvent('click');
  await page.getByText('هل أنت متأكد أنك تريد تسجيل الخروج من حسابك؟', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'تسجيل الخروج' }).last().click();
  await page.getByText('تسجيل الدخول / إنشاء حساب', { exact: true }).waitFor({ timeout: 15000 });
  await screenshot('logged-out');
  console.log('PHASE3_LOGOUT_TO_AUTH_CHOICE_OK');

  const afterLogout = await getUserDocument();
  if (boolField(afterLogout.data, 'isOnline') !== false) throw new Error('User remained online after logout');
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
  if (boolField(afterRelogin.data, 'setupComplete') !== true || stringField(afterRelogin.data, 'setupStep') !== 'complete') {
    throw new Error('Completed setup state was not preserved after re-login');
  }
  if (boolField(afterRelogin.data, 'isOnline') !== true) throw new Error('User was not marked online after re-login');
  console.log('PHASE3_LOGOUT_LOGIN_MAIN_OK');
  console.log('PHASE3_CORE_E2E_OK');

  // Edit profile validation + public_profiles sync.
  await page.getByRole('button', { name: 'الملف الشخصي' }).dispatchEvent('click');
  await page.waitForTimeout(700);
  await enableAccessibility();
  const editButton = page.getByRole('button', { name: 'تعديل الملف الشخصي' });
  await editButton.waitFor({ timeout: 8000 });
  await editButton.dispatchEvent('click');
  await page.getByText('تعديل الملف الشخصي', { exact: true }).waitFor({ timeout: 8000 });
  await enableAccessibility();
  const editInputs = page.getByRole('textbox');
  if (await editInputs.count() < 2) throw new Error('Edit Profile text fields were not exposed');
  const beforeInvalidEdit = await getUserDocument();
  await editInputs.nth(0).click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('12');
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'حفظ التعديلات' }).dispatchEvent('click');
  await page.waitForTimeout(700);
  const afterInvalidEdit = await getUserDocument();
  if (stringField(afterInvalidEdit.data, 'displayName') !== stringField(beforeInvalidEdit.data, 'displayName')) {
    throw new Error('Invalid Edit Profile name was persisted');
  }
  console.log('PHASE3_EDIT_PROFILE_VALIDATION_ERROR_OK');

  await editInputs.nth(0).click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('اختبار شادو معدل');
  await editInputs.nth(1).click({ force: true });
  await page.keyboard.press('Control+A');
  await page.keyboard.type('تحديث Phase 3');
  await page.waitForTimeout(350);
  await page.getByRole('button', { name: 'حفظ التعديلات' }).dispatchEvent('click');
  const editedUser = await waitForUserField(
    'displayName',
    value => value === 'اختبار شادو معدل',
    15000,
  );
  let editedPublic = await getPublicProfile(uid);
  for (let attempt = 0; attempt < 30 && stringField(editedPublic, 'displayName') !== 'اختبار شادو معدل'; attempt++) {
    await page.waitForTimeout(250);
    editedPublic = await getPublicProfile(uid);
  }
  if (stringField(editedUser.data, 'displayName') !== 'اختبار شادو معدل') throw new Error('users displayName did not update');
  if (stringField(editedUser.data, 'bio') !== 'تحديث Phase 3') throw new Error('users bio did not update');
  if (stringField(editedPublic, 'displayName') !== 'اختبار شادو معدل') throw new Error('public_profiles displayName did not sync');
  if (stringField(editedPublic, 'bio') !== 'تحديث Phase 3') throw new Error('public_profiles bio did not sync');
  console.log('PHASE3_EDIT_PROFILE_PUBLIC_SYNC_OK');
  await screenshot('edit-profile-synced');

  // Upload a real image through the app UI, exercising authenticated Storage rules.
  await page.getByRole('button', { name: 'تعديل الملف الشخصي' }).dispatchEvent('click');
  await page.getByText('تعديل الملف الشخصي', { exact: true }).waitFor({ timeout: 8000 });
  await enableAccessibility();
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
  await page.getByRole('button', { name: 'اختيار من الهاتف' }).click({ force: true });
  const chooser = await chooserPromise;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAY0lEQVR4nO3PQQ3AIADAQEAZ0pCGtIngcVnSU9DOs+/4s6UDXjWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgNaA1oDWgfaHsAgDKNa98AAAAAElFTkSuQmCC', 'base64');
  await chooser.setFiles({ name: 'phase3-avatar.png', mimeType: 'image/png', buffer: png });
  await page.getByText('ضبط الصورة', { exact: true }).waitFor({ timeout: 10000 });
  // crop_your_image needs a render frame after loading the browser-selected image
  // before CropController.crop() can complete reliably in headless Chromium.
  await page.waitForTimeout(2200);
  const approveCrop = page.getByRole('button', { name: 'اعتماد الصورة' });
  await approveCrop.waitFor({ state: 'visible', timeout: 5000 });
  await approveCrop.dispatchEvent('click');
  const saveAfterCrop = page.getByRole('button', { name: 'حفظ التعديلات' });
  await saveAfterCrop.waitFor({ state: 'visible', timeout: 15000 });
  await saveAfterCrop.dispatchEvent('click');

  const imageUser = await waitForUserField(
    'profileImageUrl',
    value => typeof value === 'string' && value.includes('profile_images'),
    25000,
  );
  const imageUrl = stringField(imageUser.data, 'profileImageUrl');
  const imagePublic = await getPublicProfile(uid);
  if (!imageUrl) throw new Error('Profile image URL was not stored');
  if (stringField(imagePublic, 'profileImageUrl') !== imageUrl) throw new Error('public_profiles image URL did not sync');
  console.log('PHASE3_PROFILE_IMAGE_UPLOAD_OK');
  await assertUnauthStorageDenied(uid);
  await screenshot('profile-image-uploaded');

  // Guest route + restricted-feature guard + return to login.
  const settingsAfterImage = page.getByRole('button', { name: 'الإعدادات' });
  await settingsAfterImage.dispatchEvent('click');
  await page.getByText('إدارة معلومات الحساب والإعدادات', { exact: true }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'تسجيل الخروج' }).first().dispatchEvent('click');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).last().click();
  await page.getByText('تسجيل الدخول / إنشاء حساب', { exact: true }).waitFor({ timeout: 12000 });

  await page.getByRole('button', { name: 'متابعة كضيف' }).click();
  await page.getByRole('button', { name: 'الملف الشخصي' }).waitFor({ timeout: 12000 });
  await page.getByRole('button', { name: 'الرسائل' }).click();
  await page.getByText('هذه الميزة تحتاج حساباً', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: 'إلغاء' }).click();
  console.log('PHASE3_GUEST_RESTRICTED_FEATURE_GUARD_OK');

  await page.getByRole('button', { name: 'الملف الشخصي' }).click();
  await page.getByText('أنت داخل كضيف', { exact: true }).waitFor({ timeout: 8000 });
  await page.getByRole('button', { name: 'العودة لتسجيل الدخول' }).click();
  await page.getByText('تسجيل الدخول / إنشاء حساب', { exact: true }).waitFor({ timeout: 12000 });
  console.log('PHASE3_GUEST_RETURN_TO_LOGIN_OK');
  await screenshot('guest-returned-to-login');

  if (pageErrors.length) throw new Error(`Flutter page error(s): ${pageErrors.join(' | ')}`);
  console.log('PHASE3_FULL_E2E_OK');
} finally {
  await context.close();
  await browser.close();
}
