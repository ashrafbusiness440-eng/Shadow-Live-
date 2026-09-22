import 'dart:convert';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';

class DiamondWalletService {
  DiamondWalletService._();

  static final FirebaseFirestore _db = FirebaseFirestore.instance;
  static final FirebaseAuth _auth = FirebaseAuth.instance;

  static String get _uid {
    final user = _auth.currentUser;
    if (user == null) throw StateError('يجب تسجيل الدخول أولاً.');
    return user.uid;
  }

  static Stream<DocumentSnapshot<Map<String, dynamic>>> watchWallet() =>
      _db.collection('users').doc(_uid).snapshots();

  static Future<Map<String, dynamic>?> findUserByPublicId(String publicId) async {
    final id = publicId.trim();
    if (id.isEmpty) return null;
    final q = await _db.collection('users').where('publicId', isEqualTo: id).limit(1).get();
    if (q.docs.isEmpty) return null;
    final doc = q.docs.first;
    if (doc.id == _uid) throw StateError('لا يمكنك إرسال العملات إلى حسابك نفسه.');
    return {'uid': doc.id, ...doc.data()};
  }

  static Future<void> setInitialPassword(String password) async {
    if (password.length < 6) throw ArgumentError('كلمة السر يجب أن تكون 6 خانات على الأقل.');
    final ref = _db.collection('users').doc(_uid);
    await _db.runTransaction((tx) async {
      final snap = await tx.get(ref);
      final data = snap.data() ?? <String, dynamic>{};
      if (data['diamondPasswordSet'] == true) return;
      final secured = _hashNewPassword(password);
      tx.set(ref, {
        ...secured,
        'diamondPasswordSet': true,
        'diamondPasswordUpdatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
    });
  }

  static Future<void> exchangeDiamondsForCoins({required int diamondCost, required int coins}) async {
    if (diamondCost <= 0 || coins <= 0) throw ArgumentError('باقة غير صالحة.');
    final ref = _db.collection('users').doc(_uid);
    await _db.runTransaction((tx) async {
      final snap = await tx.get(ref);
      if (!snap.exists) throw StateError('ملف المستخدم غير موجود.');
      final data = snap.data()!;
      final diamonds = _asInt(data['diamonds']);
      final currentCoins = _asInt(data['coins'] ?? data['balance']);
      if (diamonds < diamondCost) throw StateError('رصيد الألماس غير كافٍ.');
      tx.update(ref, {
        'diamonds': diamonds - diamondCost,
        'coins': currentCoins + coins,
        'walletUpdatedAt': FieldValue.serverTimestamp(),
      });
    });
  }

  static Future<void> transferCoins({
    required String recipientUid,
    required int amount,
    required String password,
  }) async {
    if (amount < 100) throw ArgumentError('الحد الأدنى للإرسال هو 100 عملة.');
    if (recipientUid == _uid) throw ArgumentError('لا يمكنك الإرسال إلى حسابك نفسه.');
    final senderRef = _db.collection('users').doc(_uid);
    final receiverRef = _db.collection('users').doc(recipientUid);
    final transferRef = _db.collection('wallet_transfers').doc();

    await _db.runTransaction((tx) async {
      final senderSnap = await tx.get(senderRef);
      final receiverSnap = await tx.get(receiverRef);
      if (!senderSnap.exists || !receiverSnap.exists) throw StateError('تعذر العثور على الحساب.');
      final sender = senderSnap.data()!;
      if (sender['diamondPasswordSet'] != true || !_verifyPassword(password, sender)) {
        throw StateError('كلمة سر الألماس غير صحيحة.');
      }
      final senderCoins = _asInt(sender['coins'] ?? sender['balance']);
      final receiver = receiverSnap.data()!;
      final receiverCoins = _asInt(receiver['coins'] ?? receiver['balance']);
      if (senderCoins < amount) throw StateError('رصيد العملات غير كافٍ.');

      tx.update(senderRef, {'coins': senderCoins - amount, 'walletUpdatedAt': FieldValue.serverTimestamp()});
      tx.update(receiverRef, {'coins': receiverCoins + amount, 'walletUpdatedAt': FieldValue.serverTimestamp()});
      tx.set(transferRef, {
        'senderUid': _uid,
        'recipientUid': recipientUid,
        'amount': amount,
        'type': 'coin_gift',
        'createdAt': FieldValue.serverTimestamp(),
      });
    });
  }

  static Map<String, dynamic> _hashNewPassword(String password) {
    final random = Random.secure();
    final salt = List<int>.generate(24, (_) => random.nextInt(256));
    final saltText = base64UrlEncode(salt);
    final hash = sha256.convert(utf8.encode('$saltText:$password')).toString();
    return {'diamondPasswordHash': hash, 'diamondPasswordSalt': saltText};
  }

  static bool _verifyPassword(String password, Map<String, dynamic> data) {
    final salt = data['diamondPasswordSalt']?.toString() ?? '';
    final expected = data['diamondPasswordHash']?.toString() ?? '';
    if (salt.isEmpty || expected.isEmpty) return false;
    return sha256.convert(utf8.encode('$salt:$password')).toString() == expected;
  }

  static int _asInt(dynamic value) {
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '') ?? 0;
  }
}
