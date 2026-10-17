# Shadow Live browser/PWA incoming call push

This implementation is scoped exclusively to the published
`/Shadow-Live-/live/` page on GitHub Pages. It reuses the single Worker FCM
sender from PR #438, Firestore token ownership from PR #439 and the existing
server-authoritative call dialog. The separate Shadow Control PWA has no
Firebase call worker or call push script.

## Required one-time Firebase configuration

1. In Firebase project **shadow-live**, open **Project settings → Cloud
   Messaging → Web Push certificates** and generate/import a VAPID key pair.
   Copy the **public VAPID key**, not a service-account private key.
2. Add the public key as a **GitHub Actions repository variable**
   `SHADOW_FIREBASE_WEB_VAPID_KEY`. The Pages Live build passes it through
   a Dart build define. Unset means **the toggle is disabled**.
3. The Flutter app registers the site-scoped
   `web/firebase-messaging-sw.js` ONLY for a user who opted in, at
   `/Shadow-Live-/live/firebase-cloud-messaging-push-scope/`, via the
   local `web/private_call_web_push.js` bridge. The registration is passed
   **explicitly** into Firebase Web `getToken`. That avoids FlutterFire's
   default origin-root service-worker URL, which GitHub Pages project
   hosting cannot serve. Scripts load lazily and never intercept the
   Flutter app route or Shadow Control PWA.
4. The Worker sends generic FCM notifications; Firebase's messaging worker
   displays them. This worker does **not** call `showNotification` again.
   Clicking a verified call pointer focuses a Live tab or opens Live with a
   `private_call_id` query parameter. Flutter validates identity and ring
   state through the Worker before showing acceptance controls. A click
   never auto-answers or joins a room.
5. Browser notification permission is only requested after the user's
   explicit preference toggle. Unchecking first revokes the server-stored
   `privateCallPushOptIn`, then cleans up the local token. The Worker
   independently verifies the current account's opt-in before any send.

## Do not enable before acceptance

Keep `PRIVATE_CALL_MEDIA_READY`, `PRIVATE_CALL_PUSH_READY` and Shadow
Control's `privateCallsEnabled` **OFF** until tests pass on two separate
accounts/devices. Verify web installed PWA foreground/background/cold start,
push click from multiple tabs, Android app coexistence, permission denial and
regrant, logout/account switching, 30s expired call, busy/cancel/reject,
single sound engine and no ringtone duplication. Test Chrome Android and
other supported browsers on actual devices. Browser permission, install and
HTTPS support vary; CI browser wiring tests cannot prove remote FCM delivery.

Sources: https://firebase.google.com/docs/cloud-messaging/flutter/get-started
and https://firebase.google.com/docs/cloud-messaging/web/receive-messages
