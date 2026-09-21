import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class ChatSafetyStatus {
  const ChatSafetyStatus({
    required this.blocked,
    required this.blockedByMe,
    required this.blockedByOther,
  });

  final bool blocked;
  final bool blockedByMe;
  final bool blockedByOther;
}

class ChatSafetyService {
  static const _baseUrl =
      'https://shadow-live-git-feature-shadow-control-foundation-shadow-c916.vercel.app/api';

  String get _uid => FirebaseAuth.instance.currentUser!.uid;

  Future<ChatSafetyStatus> status(String targetUserId) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      Uri.parse(_baseUrl + '/chat-safety-status'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({'targetUserId': targetUserId}),
    );
    final body = _body(response.body);
    if (response.statusCode == 200 && body['ok'] == true) {
      return ChatSafetyStatus(
        blocked: body['blocked'] == true,
        blockedByMe: body['blockedByMe'] == true,
        blockedByOther: body['blockedByOther'] == true,
      );
    }
    throw StateError((body['code'] ?? 'status_failed').toString());
  }

  Future<void> setBlocked({
    required String targetUserId,
    required bool blocked,
  }) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      Uri.parse(_baseUrl + '/set-user-block'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'targetUserId': targetUserId,
        'blocked': blocked,
      }),
    );
    final body = _body(response.body);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'block_failed').toString());
    }
  }

  Future<String> reportUser({
    required String targetUserId,
    required String conversationId,
    required String reason,
    required String details,
  }) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final idempotencyKey =
        _uid + '_' + DateTime.now().microsecondsSinceEpoch.toString() + '_report';
    final response = await http.post(
      Uri.parse(_baseUrl + '/report-user'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'targetUserId': targetUserId,
        'conversationId': conversationId,
        'reason': reason,
        'details': details,
        'idempotencyKey': idempotencyKey,
      }),
    );
    final body = _body(response.body);
    if (response.statusCode == 200 && body['ok'] == true) {
      return (body['reportId'] ?? '').toString();
    }
    throw StateError((body['code'] ?? 'report_failed').toString());
  }

  Map<String, dynamic> _body(String raw) {
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }
}
