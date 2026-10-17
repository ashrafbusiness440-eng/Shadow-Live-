/* Opt-in-only Shadow Live Web/PWA FCM bridge.
   The web SDK and background worker load only for users who enabled alerts.
   A scoped registration is essential for GitHub Pages' /Shadow-Live-/live/.
   This never registers a service worker over Shadow Control or the full app. */
(() => {
  "use strict";
  const callPattern = /^[a-f0-9]{32}$/;
  const firebaseConfig = {
    apiKey: "AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8",
    appId: "1:463485983128:web:88c4953fa80d566c7a73ed",
    messagingSenderId: "463485983128",
    projectId: "shadow-live",
    authDomain: "shadow-live.firebaseapp.com",
  };
  let sdkPromise;
  let sdk;
  let pendingCallId = null;
  let subscribed = false;

  const supported = () => Boolean(
    globalThis.isSecureContext &&
    "Notification" in globalThis &&
    "serviceWorker" in navigator &&
    "PushManager" in globalThis,
  );

  const readPointer = (data) => {
    const callId = String(data?.callId || "");
    return data?.type === "private_call_incoming" &&
      callPattern.test(callId) ? callId : null;
  };

  const script = (src) => new Promise((resolve, reject) => {
    const element = document.createElement("script");
    element.src = src;
    element.async = false;
    element.onload = resolve;
    element.onerror = () => reject(new Error("push_sdk_unavailable"));
    document.head.appendChild(element);
  });

  const init = () => {
    if (!supported()) return Promise.reject(new Error("push_unsupported"));
    if (sdkPromise) return sdkPromise;
    sdkPromise = (async () => {
      if (!globalThis.firebase?.messaging) {
        if (!globalThis.firebase?.initializeApp) {
          await script("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
        }
        await script("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
      }
      const name = "shadow-live-private-call-pwa";
      let app;
      try { app = firebase.app(name); }
      catch (_) { app = firebase.initializeApp(firebaseConfig, name); }
      const messaging = firebase.messaging(app);
      const scope = new URL("firebase-cloud-messaging-push-scope/", document.baseURI);
      const worker = new URL("firebase-messaging-sw.js", document.baseURI);
      if (scope.origin !== location.origin || worker.origin !== location.origin ||
          !worker.pathname.startsWith("/Shadow-Live-/live/")) {
        throw new Error("wrong_live_push_scope");
      }
      const registration = await navigator.serviceWorker.register(worker.href, {
        scope: scope.pathname,
      });
      // Do not use navigator.serviceWorker.ready: the push worker has a
      // deliberately narrow scope and does not control the Flutter page.
      if (!registration.active) {
        await new Promise((resolve, reject) => {
          const activeWorker = registration.installing || registration.waiting;
          if (!activeWorker) return reject(new Error("push_worker_not_ready"));
          const timeout = setTimeout(() => reject(new Error("push_worker_timeout")), 8000);
          const onState = () => {
            if (activeWorker.state === "activated") {
              clearTimeout(timeout);
              activeWorker.removeEventListener("statechange", onState);
              resolve();
            }
          };
          activeWorker.addEventListener("statechange", onState);
          onState();
        });
      }
      return { messaging, registration };
    })();
    return sdkPromise.catch((error) => {
      sdkPromise = null;
      throw error;
    });
  };

  const getToken = async (vapidKey) => {
    if (!supported() || !/^[A-Za-z0-9_-]{40,180}$/.test(String(vapidKey))) {
      throw new Error("push_vapid_not_configured");
    }
    // Called directly from the explicit user toggle. This is the only code
    // path that can ask the browser for notification permission.
    const permission = Notification.permission === "granted"
      ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") throw new Error("push_permission_denied");
    const { messaging, registration } = await init();
    return messaging.getToken({
      vapidKey, serviceWorkerRegistration: registration,
    });
  };

  const deleteToken = async () => {
    if (!sdkPromise) return;
    const { messaging } = await init();
    await messaging.deleteToken();
  };

  // One app lifetime listener; foreground pushes and a focused window go
  // through the exact same backend-authoritative call verification in Dart.
  const subscribe = async (callback) => {
    if (subscribed) return;
    const { messaging } = await init();
    subscribed = true;
    messaging.onMessage((message) => {
      const id = readPointer(message?.data);
      if (id) callback(JSON.stringify({ type: "private_call_incoming", callId: id }));
    });
    navigator.serviceWorker.addEventListener("message", (event) => {
      const id = readPointer(event.data);
      if (id) callback(JSON.stringify({ type: "private_call_incoming", callId: id }));
    });
  };

  const consumeInitialCallId = () => {
    const url = new URL(location.href);
    const id = url.searchParams.get("private_call_id");
    if (id !== null) {
      url.searchParams.delete("private_call_id");
      history.replaceState(history.state, "", url.href);
    }
    if (id && callPattern.test(id)) return id;
    const pending = pendingCallId;
    pendingCallId = null;
    return pending;
  };

  // Never trigger a browser permission prompt from start, background sync,
  // splash screen, or any other implicit flow.
  const permission = () =>
    supported() ? Notification.permission : "denied";

  globalThis.shadowPrivateCallWebPush = {
    supported, permission, getToken, deleteToken, subscribe,
    consumeInitialCallId,
  };
})();
