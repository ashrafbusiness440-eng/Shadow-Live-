/* Shadow Live only. Scoped below /Shadow-Live-/live/, never Shadow Control.
   Firebase displays the notification payload automatically; no duplicate
   showNotification/onBackgroundMessage handler is registered here. */
"use strict";

const callIdPattern = /^[a-f0-9]{32}$/;

// Handle click before Firebase's default handler, but only for a recognized
// call pointer. Invalid/stale payloads fall through to the SDK.
self.addEventListener("notificationclick", (event) => {
  const payload = event.notification?.data?.FCM_MSG;
  const data = payload?.data || event.notification?.data || {};
  const callId = String(data.callId || "");
  if (data.type !== "private_call_incoming" || !callIdPattern.test(callId)) {
    return;
  }
  event.stopImmediatePropagation();
  event.notification.close();
  event.waitUntil((async () => {
    const appUrl = new URL("./", self.location.href);
    appUrl.searchParams.set("private_call_id", callId);
    const windows = await self.clients.matchAll({
      type: "window", includeUncontrolled: true,
    });
    const match = windows.find((client) => {
      try {
        const page = new URL(client.url);
        return page.origin === appUrl.origin &&
          page.pathname.startsWith(appUrl.pathname);
      } catch (_) {
        return false;
      }
    });
    if (match) {
      await match.focus();
      match.postMessage({ type: "private_call_incoming", callId });
    } else {
      await self.clients.openWindow(appUrl.href);
    }
  })());
});

importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8",
  appId: "1:463485983128:web:88c4953fa80d566c7a73ed",
  messagingSenderId: "463485983128",
  projectId: "shadow-live",
  authDomain: "shadow-live.firebaseapp.com",
  storageBucket: "shadow-live.firebasestorage.app",
});

// The call push sender is gated OFF until the project owner configures VAPID
// and validates delivery on a real installed PWA. No logging or auto-answer.
firebase.messaging();
