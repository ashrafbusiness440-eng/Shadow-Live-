import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

import '../firebase_options.dart';

FirebaseApp? _controlFirebaseApp;
FirebaseAuth? _controlFirebaseAuth;
FirebaseFirestore? _controlFirestore;

Future<void> initializeControlFirebase() async {
  FirebaseApp? app;
  for (final candidate in Firebase.apps) {
    if (candidate.name == 'shadow-control') {
      app = candidate;
      break;
    }
  }

  app ??= await Firebase.initializeApp(
    name: 'shadow-control',
    options: DefaultFirebaseOptions.currentPlatform,
  );

  _controlFirebaseApp = app;
  _controlFirebaseAuth = FirebaseAuth.instanceFor(app: app);
  _controlFirestore = FirebaseFirestore.instanceFor(app: app);
}

FirebaseApp get controlFirebaseApp {
  final app = _controlFirebaseApp;
  if (app == null) {
    throw StateError('Shadow Control Firebase is not initialized.');
  }
  return app;
}

FirebaseAuth get controlAuth {
  final auth = _controlFirebaseAuth;
  if (auth == null) {
    throw StateError('Shadow Control Firebase Auth is not initialized.');
  }
  return auth;
}

FirebaseFirestore get controlFirestore {
  final db = _controlFirestore;
  if (db == null) {
    throw StateError('Shadow Control Firestore is not initialized.');
  }
  return db;
}
