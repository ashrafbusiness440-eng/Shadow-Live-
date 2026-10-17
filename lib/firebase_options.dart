import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        return ios;
      default:
        throw UnsupportedError('Firebase is not configured for this platform.');
    }
  }

  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8',
    appId: '1:463485983128:web:88c4953fa80d566c7a73ed',
    messagingSenderId: '463485983128',
    projectId: 'shadow-live',
    authDomain: 'shadow-live.firebaseapp.com',
    storageBucket: 'shadow-live.firebasestorage.app',
  );

  // The Firebase web App ID is NOT a native Android Firebase registration.
  // Until Firebase Console registers package com.shadowlive.app and provides
  // its Android App ID, the call-push client must stay unavailable.
  //
  // Supply the real Android app ID at native build time, e.g.
  // --dart-define=SHADOW_FIREBASE_ANDROID_APP_ID=1:...:android:...
  // Never fabricate an Android identifier from the web App ID.
  static const FirebaseOptions android = FirebaseOptions(
    apiKey: String.fromEnvironment(
      'SHADOW_FIREBASE_ANDROID_API_KEY',
      defaultValue: 'AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8',
    ),
    appId: String.fromEnvironment(
      'SHADOW_FIREBASE_ANDROID_APP_ID',
      defaultValue: '1:463485983128:web:88c4953fa80d566c7a73ed',
    ),
    messagingSenderId: '463485983128',
    projectId: 'shadow-live',
    storageBucket: 'shadow-live.firebasestorage.app',
  );

  static bool get androidMessagingConfigured =>
      // App ID must belong to this Firebase project, not just end in
      // `:android:`; package association is verified when registering it.
      RegExp(r'^1:463485983128:android:[0-9a-fA-F]+
    apiKey: 'AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8',
    appId: '1:463485983128:web:88c4953fa80d566c7a73ed',
    messagingSenderId: '463485983128',
    projectId: 'shadow-live',
    storageBucket: 'shadow-live.firebasestorage.app',
    iosBundleId: 'com.mycompany.shadowlive',
  );
}
)
          .hasMatch(android.appId) &&
      android.apiKey.isNotEmpty;

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8',
    appId: '1:463485983128:web:88c4953fa80d566c7a73ed',
    messagingSenderId: '463485983128',
    projectId: 'shadow-live',
    storageBucket: 'shadow-live.firebasestorage.app',
    iosBundleId: 'com.mycompany.shadowlive',
  );
}
