import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class ChatSafetyService {
  static const _baseUrl =
      'https://shadow-live-git-feature-shadow-control-foundation-shadow-c916.vercel.app/api';

  String get _uid => FirebaseAuth.instance.currentUser!.uid;

  DocumentReference<Map<String, dynamic>> blockRef(String otherUid) =>
      FirebaseFirestore.instance
          .collection('user_blocks')
          .doc(_uid)
          .collection('items')
          .doc(otherUid);

  Stream<bool> watchBlocked(String otherUid) =>
      blockRef(otherUid).snapshots().map((snapshot) => snapshot.exists);

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
