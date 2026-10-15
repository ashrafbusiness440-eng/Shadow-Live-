import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// Appeals use only the pre-existing general-reports Worker.
/// A user can reference only a sanction proven to belong to their own UID.
class AccountActionAppealService {
  static const _baseUrl = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      Uri.parse('$_baseUrl/general-reports'),
      headers: <String, String>{
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 15));
    Map<String, dynamic> result = {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) result = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || result['ok'] != true) {
      throw StateError((result['code'] ?? 'appeal_failed').toString());
    }
    return result;
  }

  Future<Map<String, dynamic>> status(String operationId) => _post({
    'action': 'getOwnAccountActionAppeal',
    'operationId': operationId,
  });

  Future<Map<String, dynamic>> submit({
    required String operationId,
    required String explanation,
  }) => _post({
    'action': 'submitAccountActionAppeal',
    'operationId': operationId,
    'explanation': explanation,
  });
}
