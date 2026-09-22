import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

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

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8',
    appId: '1:463485983128:web:88c4953fa80d566c7a73ed',
    messagingSenderId: '463485983128',
    projectId: 'shadow-live',
    storageBucket: 'shadow-live.firebasestorage.app',
  );

  static const FirebaseOptions ios = FirebaseOptions(
    apiKey: 'AIzaSyAjDi9RdObZXHF16ecWt4J4zj2_1rdDmf8',
    appId: '1:463485983128:web:88c4953fa80d566c7a73ed',
    messagingSenderId: '463485983128',
    projectId: 'shadow-live',
    storageBucket: 'shadow-live.firebasestorage.app',
    iosBundleId: 'com.mycompany.shadowlive',
  );
}
