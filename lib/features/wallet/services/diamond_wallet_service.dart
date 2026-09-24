import 'dart:convert';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class DiamondWalletService {
  DiamondWalletService._();

  static final FirebaseFirestore _db = FirebaseFirestore.instance;
  static final FirebaseAuth _auth = FirebaseAuth.instance;
  static final http.Client _client = http.Client();
  static const String _baseUrl = String.fromEnvironment(
    'SHADOW_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  static String get _uid {
    final user = _auth.currentUser;
    if (user == null) throw StateError('يجب تسجيل الدخول أولاً.');
    return user.uid;
  }

  static Stream<DocumentSnapshot<Map<String, dynamic>>> watchWallet() =>
      _db.collection('users').doc(_uid).snapshots();

  static Future<Map<String, dynamic>> _post(
    String action, [
    Map<String, dynamic> extra = const <String, dynamic>{},
  ]) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('يجب تسجيل الدخول أولاً.');
    }

    final response = await _client.post(
      Uri.parse('$_baseUrl/wallet-actions'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({'action': action, ...extra}),
    );

    Map<String, dynamic> decoded = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map<String, dynamic>) decoded = value;
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      final code = (decoded['code'] ?? 'wallet_failed').toString();
      throw StateError(_messageFor(code));
    }
    return decoded;
  }

  static Future<Map<String, dynamic>> loadState() => _post('state');

  static Future<Map<String, dynamic>?> findUserByPublicId(
    String publicId,
  ) async {
    final id = publicId.trim();
    if (id.isEmpty) return null;
    final query = await _db
        .collection('public_profiles')
        .where('publicId', isEqualTo: id)
        .limit(1)
        .get();
    if (query.docs.isEmpty) return null;
    final doc = query.docs.first;
    if (doc.id == _uid) {
      throw StateError('لا يمكنك الإرسال إلى حسابك نفسه.');
    }
    return {'uid': doc.id, ...doc.data()};
  }

  static Future<void> setInitialPassword(String password) async {
    if (password.length < 6) {
      throw ArgumentError('كلمة السر يجب أن تكون 6 خانات على الأقل.');
    }
    await _post('setPassword', {'password': password});
  }

  static Future<int> exchangeDiamondsForCoins({
    required int diamonds,
    required String password,
  }) async {
    if (diamonds <= 0) throw ArgumentError('عدد الألماس غير صالح.');
    final result = await _post('exchangeDiamonds', {
      'diamonds': diamonds,
      'password': password,
      'idempotencyKey': _operationKey('exchange'),
    });
    return (result['coinsReceived'] as num?)?.toInt() ?? 0;
  }

  static Future<int> giftDiamonds({
    required String recipientUid,
    required int diamonds,
    required String password,
  }) async {
    if (diamonds <= 0) throw ArgumentError('عدد الألماس غير صالح.');
    final result = await _post('giftDiamonds', {
      'recipientUid': recipientUid,
      'diamonds': diamonds,
      'password': password,
      'idempotencyKey': _operationKey('gift'),
    });
    return (result['coinsReceived'] as num?)?.toInt() ?? 0;
  }

  static String _operationKey(String prefix) {
    final random = Random.secure();
    // Dart Web bitwise operators are 32-bit, so `1 << 32` becomes 0.
    // Keep the bound safely below 2^31 and combine chunks for entropy.
    final a = random.nextInt(0x7fffffff).toRadixString(16).padLeft(8, '0');
    final b = random.nextInt(0x7fffffff).toRadixString(16).padLeft(8, '0');
    return prefix +
        '_' +
        DateTime.now().microsecondsSinceEpoch.toString() +
        '_' +
        a +
        b;
  }

  static String _messageFor(String code) {
    switch (code) {
      case 'account_required':
        return 'يجب استخدام حساب مسجل لإجراء عمليات المحفظة.';
      case 'wallet_password_invalid':
        return 'كلمة سر الألماس غير صحيحة.';
      case 'password_already_set':
        return 'تم إنشاء كلمة سر الألماس مسبقاً.';
      case 'insufficient_diamonds':
        return 'رصيد الألماس غير كافٍ.';
      case 'emergency_locked':
        return 'عمليات المحفظة متوقفة مؤقتاً.';
      case 'user_not_found':
      case 'invalid_recipient':
        return 'تعذر العثور على الحساب المستلم.';
      case 'invalid_amount':
        return 'المبلغ غير صالح.';
      default:
        return 'تعذر تنفيذ عملية المحفظة حالياً.';
    }
  }
}
