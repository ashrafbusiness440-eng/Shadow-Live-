# Native Android Firebase registration for Shadow Live

This is a **configuration prerequisite**, not a new messaging backend. The current
repository's Android Firebase options use a **web** Firebase App ID
(`1:463485983128:web:...`). The native call notification client therefore
deliberately reports itself unsupported. The call feature remains disabled by
`PRIVATE_CALL_MEDIA_READY`, `PRIVATE_CALL_PUSH_READY`, and
`privateCallsEnabled` until end-to-end acceptance.

## Register the real Android app

1. In the **existing Firebase project** `shadow-live`, register an **Android**
   application with the exact package name `com.shadowlive.app` (as declared
   in `android/app/build.gradle`). Do not create another Firebase project.
2. In Firebase Project settings, copy the **Android Firebase App ID**, of the
   form `1:463485983128:android:<actual_hex_id>`. This value is not the
   Android package name and cannot be generated from the web app ID.
3. Configure the Android build with
   `--dart-define=SHADOW_FIREBASE_ANDROID_APP_ID=<actual-Android-Firebase-App-ID>`.
   If that Android registration uses a distinct Firebase API key, also supply
   `--dart-define=SHADOW_FIREBASE_ANDROID_API_KEY=<its-key>`.
   For GitHub Actions use the repository's protected build configuration,
   not a made-up constant in source.
4. Check the Firebase Console's Android integration requirements for the
   actual application (including Google Services configuration where required).
   No `google-services.json` is currently present in this repository, and
   **no native Android FCM delivery has been verified**.
5. Build and install an Android artifact and check that Settings → Call privacy
   actually enables the permission control **only after** the real Android
   configuration is present. Grant OS permission explicitly, test token
   registration and revocation, logout/account switching, call alerts with
   app foreground/background/terminated, and the existing ZEGO room handoff on
   two real devices.
6. Do not set either Worker readiness flag true, or enable private calls in
   Shadow Control, until the above acceptance and the PWA/notification
   requirements have been approved. Enabling these flags can cause push
   traffic to actual users and is **not** part of this code change.

The existing Firebase app and project identifiers are public configuration
values, not credentials. **Do not commit service-account private keys.**

Useful references: https://firebase.google.com/docs/cloud-messaging/flutter/get-started
and https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages
