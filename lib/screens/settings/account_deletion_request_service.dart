import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class AccountDeletionRequestState {
  const AccountDeletionRequestState({
    required this.status,
    this.requestedAt,
    this.eligibleAt,
    this.cancellationAvailable = false,
  });

  final String status;
  final DateTime? requestedAt;
  final DateTime? eligibleAt;
  final bool cancellationAvailable;

  factory AccountDeletionRequestState.fromJson(Map<String, dynamic> json) =>
      AccountDeletionRequestState(
        status: (json['status'] ?? 'none').toString(),
        requestedAt: DateTime.tryParse((json['requestedAt'] ?? '').toString()),
        eligibleAt: DateTime.tryParse((json['eligibleAt'] ?? '').toString()),
        cancellationAvailable: json['cancellationAvailable'] == true,
      );
}

class AccountDeletionRequestException implements Exception {
  const AccountDeletionRequestException(this.code);
  final String code;

  String get userMessage {
    switch (code) {
      case 'recent_auth_required':
        return 'لحماية حسابك، لازم تسجل خروج وترجع تسجل دخول '
            'قبل طلب الحذف أو إلغائه.';
      case 'registered_account_required':
        return 'هذه الخدمة للحسابات المسجلة. حساب الضيف لا يحتفظ '
            'بحساب دائم يمكن طلب حذفه.';
      case 'account_not_available':
        return 'الحساب غير متاح لإرسال هذا الطلب.';
      case 'deletion_not_available':
      case 'deletion_not_cancellable':
        return 'هذا الطلب دخل مرحلة لا يمكن إلغاؤها من التطبيق.';
      case 'unauthorized':
        return 'انتهت صلاحية الجلسة. سجل دخولك من جديد.';
      case 'deletion_request_unavailable':
        return 'تعذر الاتصال بخدمة حذف الحساب. حاول لاحقًا.';
      default:
        return 'تعذر تنفيذ الطلب حاليًا. حاول مجددًا.';
    }
  }
}

class AccountDeletionRequestService {
  const AccountDeletionRequestService();

  static const String _baseUrl = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  Future<AccountDeletionRequestState> send(String action) async {
    if (!['status', 'request', 'cancel'].contains(action)) {
      throw const AccountDeletionRequestException('invalid_action');
    }
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw const AccountDeletionRequestException('registered_account_required');
    }
    final uid = user.uid;
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw const AccountDeletionRequestException('unauthorized');
    }
    final http.Response response;
    try {
      response = await http
          .post(
            Uri.parse('$_baseUrl/account-deletion'),
            headers: <String, String>{
              'Content-Type': 'application/json',
              'Authorization': 'Bearer $token',
            },
            body: jsonEncode(<String, String>{'action': action}),
          )
          .timeout(const Duration(seconds: 15));
    } catch (_) {
      throw const AccountDeletionRequestException(
          'deletion_request_unavailable');
    }
    if (FirebaseAuth.instance.currentUser?.uid != uid) {
      throw const AccountDeletionRequestException('unauthorized');
    }
    Map<String, dynamic> decoded;
    try {
      decoded = (jsonDecode(response.body) as Map).cast<String, dynamic>();
    } catch (_) {
      throw const AccountDeletionRequestException(
          'deletion_request_unavailable');
    }
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw AccountDeletionRequestException(
          (decoded['code'] ?? 'deletion_request_unavailable').toString());
    }
    return AccountDeletionRequestState.fromJson(decoded);
  }
}
