const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const callId = "abcdef0123456789abcdef0123456789";

test("app-owned scoped worker opens only Shadow Live on a valid call click", async () => {
  const handlers = {};
  const opened = [];
  const waits = [];
  const sw = {
    location: {
      href: "https://ashrafbusiness440-eng.github.io/Shadow-Live-/live/firebase-messaging-sw.js",
    },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    clients: {
      matchAll: async () => [],
      openWindow: async url => { opened.push(url); },
    },
  };
  let scripts = 0;
  const context = {
    self: sw, URL, Promise,
    importScripts: () => { scripts++; },
    firebase: { initializeApp: () => {}, messaging: () => ({}) },
  };
  vm.runInNewContext(
    fs.readFileSync("web/firebase-messaging-sw.js", "utf8"),
    context,
  );
  assert.equal(scripts, 2);
  assert.equal(typeof handlers.notificationclick, "function");
  let stopped = false, closed = false;
  handlers.notificationclick({
    notification: {
      data: {
        FCM_MSG: { data: { type: "private_call_incoming", callId } },
      },
      close: () => { closed = true; },
    },
    stopImmediatePropagation: () => { stopped = true; },
    waitUntil: wait => waits.push(wait),
  });
  await Promise.all(waits);
  assert.equal(stopped, true);
  assert.equal(closed, true);
  assert.equal(opened.length, 1);
  assert.equal(new URL(opened[0]).pathname, "/Shadow-Live-/live/");
  assert.equal(new URL(opened[0]).searchParams.get("private_call_id"), callId);

  handlers.notificationclick({
    notification: {
      data: { FCM_MSG: { data: {
        type: "private_call_incoming", callId: "invalid",
      } } },
      close: () => { throw Error("bad payload not handled"); },
    },
    stopImmediatePropagation: () => { throw Error("bad payload not handled"); },
    waitUntil: () => { throw Error("bad payload not handled"); },
  });
  assert.equal(opened.length, 1);
});

test("PWA push bridge makes no SDK, permission or worker calls on startup", () => {
  const src = fs.readFileSync("web/private_call_web_push.js", "utf8");
  let loads = 0, requests = 0;
  const globals = {
    isSecureContext: true,
    Notification: { permission: "default", requestPermission: () => {
      requests++; return Promise.resolve("granted");
    } },
    PushManager: function PushManager() {},
  };
  const sandbox = {
    globalThis: globals,
    navigator: { serviceWorker: { register: () => { loads++; } } },
    document: { head: { appendChild: () => { loads++; } } },
    location: { origin: "https://example.test" },
    URL,
  };
  vm.runInNewContext(src, sandbox);
  assert.equal(globals.shadowPrivateCallWebPush.supported(), true);
  assert.equal(globals.shadowPrivateCallWebPush.permission(), "default");
  assert.equal(loads, 0);
  assert.equal(requests, 0);
  assert.ok(src.includes("serviceWorkerRegistration: registration"));
  assert.ok(src.includes("firebase-cloud-messaging-push-scope/"));
  assert.ok(src.includes("getToken, deleteToken, subscribe"));
});

test("Pages hosts push only in Live, with no broad cache purge", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/deploy-shadow-control-pages.yml", "utf8",
  );
  const live = fs.readFileSync("scripts/app_index.html", "utf8");
  assert.ok(workflow.includes("site/control/firebase-messaging-sw.js"));
  assert.ok(workflow.includes("SHADOW_FIREBASE_WEB_VAPID_KEY"));
  assert.ok(live.includes('src="private_call_web_push.js"'));
  assert.ok(!live.includes("caches.delete("));
  assert.ok(!live.includes(".unregister()"));
});
