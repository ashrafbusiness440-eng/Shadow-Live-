import { chromium } from "playwright";
import { sign } from "node:crypto";
import fs from "node:fs";

const targetBase = "https://ashrafbusiness440-eng.github.io/Shadow-Live-/control/";
const apiKey = "AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8";
const firebaseConfig = {
  apiKey,
  appId: "1:463485983128:web:88c4953fa80d566c7a73ed",
  messagingSenderId: "463485983128",
  projectId: "shadow-live",
  authDomain: "shadow-live.firebaseapp.com",
  storageBucket: "shadow-live.firebasestorage.app",
};

let serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "{}");
if (typeof serviceAccount === "string") serviceAccount = JSON.parse(serviceAccount);
const projectId = serviceAccount.project_id;
const clientEmail = serviceAccount.client_email;
const privateKey = String(serviceAccount.private_key || "").replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey) throw Error("invalid service account");

function b64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function jwt(payload, header = { alg: "RS256", typ: "JWT" }) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(payload));
  const unsigned = h + "." + p;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
  return unsigned + "." + b64url(signature);
}

async function googleAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt({
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const exchange = async (grantType) => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: grantType, assertion }),
    });
    const body = await response.json().catch(() => ({}));
    return { response, body };
  };
  let attempt = await exchange("urn:ietf:params:oauth-bearer");
  if (!attempt.response.ok || !attempt.body.access_token) {
    attempt = await exchange("urn:ietf:params:oauth:grant-type:jwt-bearer");
  }
  if (!attempt.response.ok || !attempt.body.access_token) throw Error("oauth failed");
  return attempt.body.access_token;
}

async function ownerUid() {
  const token = await googleAccessToken();
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "users" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "role" },
              op: "EQUAL",
              value: { stringValue: "owner" },
            },
          },
          limit: 1,
        },
      }),
    },
  );
  const body = await response.json().catch(() => []);
  if (!response.ok) throw Error("owner query failed " + response.status);
  const name = body.find((row) => row?.document?.name)?.document?.name || "";
  const uid = name.split("/").pop();
  if (!uid) throw Error("owner uid not found");
  return uid;
}

function customToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  return jwt({
    iss: clientEmail,
    sub: clientEmail,
    aud: "https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iat: now,
    exp: now + 3600,
    uid,
  });
}

async function enableSemantics(page) {
  await page.waitForSelector("flt-glass-pane", { state: "attached", timeout: 60000 });
  await page.waitForTimeout(800);
  const placeholder = page.locator("flt-semantics-placeholder");
  if (await placeholder.count()) {
    await page.evaluate(() => {
      const el = document.querySelector("flt-semantics-placeholder");
      if (!el) return;
      try { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })); } catch (_) {}
      try { el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true })); } catch (_) {}
      try { el.click(); } catch (_) {}
    }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.keyboard.press("Tab").catch(() => {});
  await page.waitForTimeout(300);
}

async function semanticsSnapshot(page) {
  return await page.locator("flt-semantics").evaluateAll((nodes) =>
    nodes.slice(0, 500).map((n) => ({
      label: n.getAttribute("aria-label") || "",
      role: n.getAttribute("role") || "",
      text: (n.textContent || "").trim(),
    }))
  );
}

async function findSemantics(page, needle, exact = false) {
  const all = page.locator("flt-semantics");
  const count = await all.count();
  const q = needle.trim();
  for (let i = 0; i < count; i++) {
    const el = all.nth(i);
    const label = (await el.getAttribute("aria-label").catch(() => "")) || "";
    const text = ((await el.textContent().catch(() => "")) || "").trim();
    const hay = (label + " " + text).trim();
    if ((exact && (label.trim() === q || text === q)) || (!exact && hay.includes(q))) {
      return el;
    }
  }
  return null;
}

async function clickSemantics(page, label) {
  const el = await findSemantics(page, label, true) || await findSemantics(page, label, false);
  if (!el) throw Error("semantic target not found: " + label);
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ force: true });
  await page.waitForTimeout(900);
}

async function focusSearch(page) {
  const el = await findSemantics(page, "البحث في الأصول", false);
  if (!el) throw Error("asset search box not found");
  await el.scrollIntoViewIfNeeded().catch(() => {});
  await el.click({ force: true });
  await page.waitForTimeout(250);
}

async function searchAsset(page, query, screenshotName) {
  await focusSearch(page);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.type(query, { delay: 8 });
  await page.waitForTimeout(2400);
  const target = await findSemantics(page, query, false);
  const found = !!target;
  if (target) {
    await target.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: `visual-qa/${screenshotName}`, fullPage: false });
  return found;
}

fs.mkdirSync("visual-qa", { recursive: true });
const uid = await ownerUid();
const token = customToken(uid);

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  deviceScaleFactor: 2,
  locale: "ar-AE",
  colorScheme: "dark",
});
const page = await context.newPage();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (error) => pageErrors.push(String(error)));
page.on("requestfailed", (request) => {
  const f = request.failure();
  failedRequests.push({ url: request.url(), error: f?.errorText || "failed" });
});

await page.goto(targetBase, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2000);

await page.addScriptTag({ url: "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js" });
await page.addScriptTag({ url: "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth-compat.js" });
await page.evaluate(async ({ config, token }) => {
  const app = window.firebase.apps.find((candidate) => candidate.name === "shadow-control")
    || window.firebase.initializeApp(config, "shadow-control");
  const auth = window.firebase.auth(app);
  await auth.setPersistence(window.firebase.auth.Auth.Persistence.SESSION);
  await auth.signInWithCustomToken(token);
}, { config: firebaseConfig, token });

await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(4500);
fs.mkdirSync("visual-qa", { recursive: true });
await page.screenshot({ path: "visual-qa/00-before-semantics.png" }).catch(() => {});
await enableSemantics(page);

const afterLogin = await semanticsSnapshot(page);
fs.writeFileSync("visual-qa/01-semantics-after-login.json", JSON.stringify(afterLogin, null, 2));
await page.screenshot({ path: "visual-qa/01-after-login.png" });

try {
  await clickSemantics(page, "المزيد");
} catch (_) {
  // Flutter Web can render bottom-navigation labels without exposing semantics.
  // On the fixed 412px mobile viewport, "المزيد" is the second destination from the left.
  await page.mouse.click(88, 878);
  await page.waitForTimeout(1200);
}
await page.screenshot({ path: "visual-qa/02-more.png" });
fs.writeFileSync(
  "visual-qa/02-dom.html",
  await page.evaluate(() => document.body.innerHTML),
);
await clickSemantics(page, "استوديو الأصول");
await page.waitForTimeout(3000);
await enableSemantics(page);
await page.screenshot({ path: "visual-qa/03-studio-initial.png" });

const studioSemantics = await semanticsSnapshot(page);
fs.writeFileSync("visual-qa/03-studio-semantics.json", JSON.stringify(studioSemantics, null, 2));

const found26 = await searchAsset(
  page,
  "levels.wealth.lv26_30.profileFrame",
  "04-search-lv26_30.png",
);
const found31 = await searchAsset(
  page,
  "levels.wealth.lv31_35.profileFrame",
  "05-search-lv31_35.png",
);

await focusSearch(page);
await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
await page.keyboard.type("profileFrame", { delay: 8 });
await page.waitForTimeout(2400);
await page.screenshot({ path: "visual-qa/06-search-all-profile-frames.png" });

const finalSemantics = await semanticsSnapshot(page);
fs.writeFileSync("visual-qa/06-final-semantics.json", JSON.stringify(finalSemantics, null, 2));

const labels = finalSemantics.map((x) => (x.label + " " + x.text).trim());
const visibleWealthFrames = labels.filter((x) => x.includes("levels.wealth.lv") && x.includes("profileFrame"));

const result = {
  ownerSignedIn: afterLogin.some((x) => (x.label + " " + x.text).includes("Shadow Control")),
  studioOpened: studioSemantics.some((x) => (x.label + " " + x.text).includes("سجل الأصول")),
  found26,
  found31,
  visibleWealthFrames,
  consoleErrors: [...new Set(consoleErrors)].slice(0, 40),
  pageErrors: [...new Set(pageErrors)].slice(0, 40),
  failedRequests: failedRequests.slice(0, 60),
};
fs.writeFileSync("visual-qa/result.json", JSON.stringify(result, null, 2));
console.log("VISUAL_QA_RESULT", JSON.stringify(result));

await browser.close();

if (!result.ownerSignedIn || !result.studioOpened || !found26 || !found31) {
  process.exitCode = 1;
}
