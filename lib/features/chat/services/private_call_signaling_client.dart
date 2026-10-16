import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

/// The existing Worker is the only authority for call eligibility, ringing,
/// busy state and termination. Never mutate private_calls from Flutter.
class PrivateCallSignalingException implements Exception {
  const PrivateCallSignalingException(this.code);
  final String code;

  @override
  String toString() => 'PrivateCallSignalingException($code)';
}

class PrivateCallState {
  const PrivateCallState({
    required this.callId,
    required this.status,
    this.code,
    this.callerUid,
    this.calleeUid,
    this.conversationId,
    this.ringDeadlineMs = 0,
    this.durationSeconds = 0,
  });

  final String callId;
  final String status;
  final String? code;
  final String? callerUid;
  final String? calleeUid;
  final String? conversationId;
  final int ringDeadlineMs;
  final int durationSeconds;

  bool get terminal => const {
    'missed', 'rejected', 'cancelled', 'completed', 'interrupted',
  }.contains(status);

  factory PrivateCallState.fromJson(Map<String, dynamic> json) {
    final callId = (json['callId'] ?? '').toString();
    final status = (json['status'] ?? '').toString();
    if (!RegExp(r'^[a-f0-9]{32}$').hasMatch(callId) ||
        !const {
          'ringing', 'active', 'missed', 'rejected',
          'cancelled', 'completed', 'interrupted',
        }.contains(status)) {
      throw const PrivateCallSignalingException('invalid_call_response');
    }
    return PrivateCallState(
      callId: callId,
      status: status,
      code: json['code']?.toString(),
      callerUid: json['callerUid']?.toString(),
      calleeUid: json['calleeUid']?.toString(),
      conversationId: json['conversationId']?.toString(),
      ringDeadlineMs: (json['ringDeadlineMs'] as num?)?.toInt() ?? 0,
      durationSeconds: (json['durationSeconds'] as num?)?.toInt() ?? 0,
    );
  }
}

class PrivateCallSignalingClient {
  PrivateCallSignalingClient({
    http.Client? client,
    Future<String?> Function()? idTokenProvider,
    String? Function()? currentUid,
    bool Function()? isAnonymous,
    String? baseUrl,
  }) : _client = client ?? http.Client(),
       _idTokenProvider = idTokenProvider ??
           (() async => FirebaseAuth.instance.currentUser?.getIdToken()),
       _currentUid =
           currentUid ?? (() => FirebaseAuth.instance.currentUser?.uid),
       _isAnonymous =
           isAnonymous ?? (() => FirebaseAuth.instance.currentUser?.isAnonymous ?? true),
       _baseUrl = baseUrl ?? const String.fromEnvironment(
         'SHADOW_CLOUDFLARE_API_BASE_URL',
         defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
       );

  final http.Client _client;
  final Future<String?> Function() _idTokenProvider;
  final String? Function() _currentUid;
  final bool Function() _isAnonymous;
  final String _baseUrl;

  static final RegExp _callIdPattern = RegExp(r'^[a-f0-9]{32}$');
  static final RegExp _operationPattern = RegExp(r'^[A-Za-z0-9_-]{12,100}$');

  Future<PrivateCallState> _send({
    required String actorUid,
    required String action,
    required Map<String, dynamic> body,
  }) async {
    if (actorUid.isEmpty || _currentUid() != actorUid || _isAnonymous()) {
      throw const PrivateCallSignalingException('registered_account_required');
    }
    final token = await _idTokenProvider();
    if (_currentUid() != actorUid) {
      throw const PrivateCallSignalingException('account_changed');
    }
    if (token == null || token.isEmpty) {
      throw const PrivateCallSignalingException('auth_required');
    }
    late final http.Response response;
    try {
      response = await _client.post(
        Uri.parse('$_baseUrl/private-call-signaling'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({'action': action, ...body}),
      ).timeout(const Duration(seconds: 15));
    } on TimeoutException {
      throw const PrivateCallSignalingException('call_network_timeout');
    } on http.ClientException {
      throw const PrivateCallSignalingException('call_network_unavailable');
    }
    // The reply from the previous user must never affect a newly signed-in
    // account, even if the HTTP request completed in the meantime.
    if (_currentUid() != actorUid) {
      throw const PrivateCallSignalingException('account_changed');
    }
    Map<String, dynamic> decoded;
    try {
      final raw = jsonDecode(response.body);
      if (raw is! Map<String, dynamic>) {
        throw const FormatException('invalid_call_response');
      }
      decoded = raw;
    } on FormatException {
      throw const PrivateCallSignalingException('invalid_call_response');
    }
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw PrivateCallSignalingException(
        (decoded['code'] ?? 'private_call_unavailable').toString(),
      );
    }
    // A lost start reply returns the same authoritative operation/call ID,
    // but its current state may now be active or terminal. Read it once,
    // never fabricate a ringing status or send a second start operation.
    if (action == 'start' && decoded['code'] == 'duplicate') {
      final callId = (decoded['callId'] ?? '').toString();
      if (!_callIdPattern.hasMatch(callId)) {
        throw const PrivateCallSignalingException('invalid_call_response');
      }
      return _send(
        actorUid: actorUid,
        action: 'get',
        body: {'callId': callId},
      );
    }
    return PrivateCallState.fromJson(decoded);
  }

  Future<PrivateCallState> start({
    required String actorUid,
    required String otherUid,
    required String conversationId,
    required String idempotencyKey,
  }) {
    if (otherUid.isEmpty || otherUid == actorUid ||
        conversationId.isEmpty || !_operationPattern.hasMatch(idempotencyKey)) {
      throw const PrivateCallSignalingException('invalid_call_request');
    }
    // Caller owns the operation key. Retry with the very same key until the
    // Worker resolves it; generating a fresh key duplicates ringing attempts.
    return _send(
      actorUid: actorUid,
      action: 'start',
      body: {
        'otherUid': otherUid,
        'conversationId': conversationId,
        'idempotencyKey': idempotencyKey,
      },
    );
  }

  Future<PrivateCallState> respond({
    required String actorUid,
    required String callId,
    required bool accept,
  }) => _forCall(actorUid, callId, 'respond', {
    'decision': accept ? 'accept' : 'reject',
  });

  Future<PrivateCallState> finish({
    required String actorUid, required String callId,
  }) => _forCall(actorUid, callId, 'finish');

  Future<PrivateCallState> get({
    required String actorUid, required String callId,
  }) => _forCall(actorUid, callId, 'get');

  /// Explicit active-session renewal only, never background polling.
  Future<PrivateCallState> renew({
    required String actorUid, required String callId,
  }) => _forCall(actorUid, callId, 'renew');

  Future<PrivateCallState> _forCall(
    String actorUid, String callId, String action,
    [Map<String, dynamic> extra = const {}],
  ) {
    if (!_callIdPattern.hasMatch(callId)) {
      throw const PrivateCallSignalingException('invalid_call_id');
    }
    return _send(
      actorUid: actorUid,
      action: action,
      body: {'callId': callId, ...extra},
    );
  }

  void dispose() => _client.close();
}
