import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';

class NumericIdService {
  NumericIdService._();

  static final FirebaseFirestore _db = FirebaseFirestore.instance;
  static final Random _random = Random.secure();

  /// Returns the user's permanent 6-digit numeric ID, creating and reserving
  /// one atomically when the account does not have a valid 6-digit ID yet.
  static Future<String> ensureForUser(String uid) async {
    final userRef = _db.collection('users').doc(uid);

    for (var attempt = 0; attempt < 20; attempt++) {
      final candidate = (100000 + _random.nextInt(900000)).toString();
      final reservationRef = _db.collection('numeric_ids').doc(candidate);

      try {
        final result = await _db.runTransaction<String>((transaction) async {
          final userSnapshot = await transaction.get(userRef);
          final existing = userSnapshot.data()?['numericId']?.toString();
          if (existing != null && RegExp(r'^\d{6}$').hasMatch(existing)) {
            return existing;
          }

          final reservationSnapshot = await transaction.get(reservationRef);
          if (reservationSnapshot.exists) {
            throw const _NumericIdCollision();
          }

          transaction.set(reservationRef, {
            'uid': uid,
            'createdAt': FieldValue.serverTimestamp(),
          });
          transaction.set(
            userRef,
            {
              'numericId': candidate,
              'updatedAt': FieldValue.serverTimestamp(),
            },
            SetOptions(merge: true),
          );
          return candidate;
        });
        return result;
      } on _NumericIdCollision {
        continue;
      }
    }

    throw StateError('Could not allocate a unique 6-digit numeric ID.');
  }
}

class _NumericIdCollision implements Exception {
  const _NumericIdCollision();
}
