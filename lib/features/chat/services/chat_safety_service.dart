import 'dart:async';
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
  static const _baseUrl = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );

  // Preserve the server operation ID for a still-unconfirmed report so
  // a manual retry never registers another report or consumes extra quota.
  String? _pendingReportFingerprint;
  String? _pendingReportKey;

  void _clearPendingReport() {
    _pendingReportFingerprint = null;
    _pendingReportKey = null;
  }

  Future<ChatSafetyStatus> status(String targetUserId) async {
    final token = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      Uri.parse(_baseUrl + '/chat-actions'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({'action': 'safetyStatus', 'targetUserId': targetUserId}),
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
      Uri.parse(_baseUrl + '/chat-actions'),
      headers: {
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode({
        'action': 'setBlock',
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
  }) => _submitReport(
    action: 'reportUser',
    targetUserId: targetUserId,
    conversationId: conversationId,
    reason: reason,
    details: details,
  );

  Future<String> reportProfile({
    required String targetUserId,
    required String reason,
    required String details,
  }) => _submitReport(
    action: 'reportProfile',
    targetUserId: targetUserId,
    reason: reason,
    details: details,
  );

  Future<String> _submitReport({
    required String action,
    required String targetUserId,
    String? conversationId,
    required String reason,
    required String details,
  }) async {
    final reporter = FirebaseAuth.instance.currentUser;
    final reporterUid = reporter?.uid;
    if (reporterUid == null || reporterUid.isEmpty) {
      throw StateError('not_signed_in');
    }
    final token = await reporter!.getIdToken();
    if (FirebaseAuth.instance.currentUser?.uid != reporterUid) {
      throw StateError('report_account_changed');
    }
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    // Same reporter, destination, reason and details -> same server receipt.
    // A different account or any edited field starts a fresh operation.
    final fingerprint = jsonEncode([
      reporterUid, action, targetUserId, conversationId ?? '', reason, details,
    ]);
    final key = _pendingReportFingerprint == fingerprint &&
            _pendingReportKey != null
        ? _pendingReportKey!
        : reporterUid + '_' +
            DateTime.now().microsecondsSinceEpoch.toString() + '_report';
    _pendingReportFingerprint = fingerprint;
    _pendingReportKey = key;
    try {
      if (FirebaseAuth.instance.currentUser?.uid != reporterUid) {
        throw StateError('report_account_changed');
      }
      final response = await http.post(
        Uri.parse(_baseUrl + '/chat-actions'),
        headers: {
          'authorization': 'Bearer ' + token,
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': action,
          'targetUserId': targetUserId,
          if (conversationId != null) 'conversationId': conversationId,
          'reason': reason,
          'details': details,
          'idempotencyKey': key,
        }),
      ).timeout(const Duration(seconds: 15));
      if (FirebaseAuth.instance.currentUser?.uid != reporterUid) {
        throw StateError('report_account_changed');
      }
      final body = _body(response.body);
      if (response.statusCode == 200 && body['ok'] == true) {
        final reportId = (body['reportId'] ?? '').toString().trim();
        if (reportId.isEmpty) throw StateError('report_confirmation_pending');
        _clearPendingReport();
        return reportId;
      }
      // A definite 4xx rejection never created this report. HTTP 408,
      // transient server errors and lost responses leave the key reserved.
      if (response.statusCode >= 400 && response.statusCode < 500 &&
          response.statusCode != 408) {
        _clearPendingReport();
        throw StateError((body['code'] ?? 'report_failed').toString());
      }
      throw StateError('report_confirmation_pending');
    } on TimeoutException {
      throw StateError('report_confirmation_pending');
    } on http.ClientException {
      throw StateError('report_confirmation_pending');
    }
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
