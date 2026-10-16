import 'dart:convert';
import 'dart:typed_data';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'private_voice_recorder.dart';

class PrivateVoiceUploadError implements Exception {
  const PrivateVoiceUploadError(this.code);
  final String code;
  @override
  String toString() => code;
}

/// No direct Firestore writes; only the existing authenticated Worker/R2 route.
class PrivateVoiceMediaClient {
  PrivateVoiceMediaClient({http.Client? client}) : _client = client ?? http.Client();
  final http.Client _client;
  // Preserve the same uploaded object and operation key across network retries.
  // If the send was committed but its reply was lost, retrying must never
  // create a second message or another billable upload.
  String? _pendingKey;
  String? _pendingObjectId;
  Uri? _pendingUploadUrl;
  Map<String, String>? _pendingHeaders;
  int _pendingExpiryMs = 0;
  bool _pendingConfirmed = false;
  static const String _base = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );
  Future<Map<String, dynamic>> _post(
    String userUid, Map<String, dynamic> request,
  ) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.uid != userUid || user.isAnonymous) {
      throw const PrivateVoiceUploadError('auth_required');
    }
    final token = await user.getIdToken();
    if (FirebaseAuth.instance.currentUser?.uid != userUid) {
      throw const PrivateVoiceUploadError('account_changed');
    }
    final response = await _client.post(
      Uri.parse('$_base/private-voice-media'),
      headers: {'Authorization': 'Bearer $token', 'content-type': 'application/json'},
      body: jsonEncode(request),
    ).timeout(const Duration(seconds: 15));
    final body = jsonDecode(response.body);
    if (body is! Map || response.statusCode < 200 || response.statusCode >= 300 || body['ok'] != true) {
      throw PrivateVoiceUploadError(body is Map ? (body['code'] ?? 'voice_request_failed').toString() : 'voice_request_failed');
    }
    return Map<String, dynamic>.from(body);
  }
  Future<String> uploadAndSend({
    required String senderUid,
    required String otherUid,
    required String conversationId,
    required PrivateVoiceDraft draft,
    required String idempotencyKey,
  }) async {
    if (draft.bytes.isEmpty || draft.bytes.length > privateVoiceMaxBytes ||
        draft.durationSeconds < 1 || draft.durationSeconds > privateVoiceMaxSeconds ||
        !RegExp(r'^[A-Za-z0-9_-]{12,220}$').hasMatch(idempotencyKey)) {
      throw const PrivateVoiceUploadError('invalid_voice_request');
    }
    if (FirebaseAuth.instance.currentUser?.uid != senderUid) {
      throw const PrivateVoiceUploadError('account_changed');
    }
    if (_pendingKey != idempotencyKey) {
      _pendingKey = idempotencyKey;
      _pendingObjectId = null;
      _pendingUploadUrl = null;
      _pendingHeaders = null;
      _pendingExpiryMs = 0;
      _pendingConfirmed = false;
    }
    // An expired *unconfirmed* upload may be prepared again. Once confirmed,
    // the same object must be reused for every send retry.
    if (!_pendingConfirmed &&
        _pendingObjectId != null &&
        DateTime.now().millisecondsSinceEpoch + 5000 >= _pendingExpiryMs) {
      _pendingObjectId = null;
      _pendingUploadUrl = null;
      _pendingHeaders = null;
    }
    if (_pendingObjectId == null) {
      final prepare = await _post(senderUid, {
        'action': 'prepareUpload', 'otherUid': otherUid,
        'conversationId': conversationId, 'mimeType': 'audio/wav',
        'byteLength': draft.bytes.length,
        'durationSeconds': draft.durationSeconds,
      });
      final objectId = (prepare['objectId'] ?? '').toString();
      final uri = Uri.tryParse((prepare['uploadUrl'] ?? '').toString());
      final expires = (prepare['expiresAtMs'] as num?)?.toInt() ?? 0;
      if (objectId.isEmpty || uri == null || uri.scheme != 'https' ||
          expires <= DateTime.now().millisecondsSinceEpoch + 5000) {
        throw const PrivateVoiceUploadError('invalid_upload_ticket');
      }
      _pendingObjectId = objectId;
      _pendingUploadUrl = uri;
      _pendingExpiryMs = expires;
      _pendingHeaders = Map<String, String>.from(
        (prepare['requiredHeaders'] as Map?)?.map(
          (k, v) => MapEntry('$k', '$v'),
        ) ?? {},
      );
    }
    final objectId = _pendingObjectId!;
    if (!_pendingConfirmed) {
      if (FirebaseAuth.instance.currentUser?.uid != senderUid) {
        throw const PrivateVoiceUploadError('account_changed');
      }
      final upload = await _client.put(
        _pendingUploadUrl!, headers: _pendingHeaders!, body: draft.bytes,
      ).timeout(const Duration(seconds: 30));
      if (upload.statusCode < 200 || upload.statusCode >= 300) {
        throw const PrivateVoiceUploadError('voice_upload_failed');
      }
      await _post(senderUid, {'action': 'confirmUpload', 'objectId': objectId});
      _pendingConfirmed = true;
    }
    if (FirebaseAuth.instance.currentUser?.uid != senderUid) {
      throw const PrivateVoiceUploadError('account_changed');
    }
    final sent = await _post(senderUid, {
      'action': 'send', 'conversationId': conversationId,
      'otherUid': otherUid, 'objectId': objectId,
      'idempotencyKey': idempotencyKey,
    });
    final messageId = (sent['messageId'] ?? '').toString();
    if (messageId.isEmpty) {
      throw const PrivateVoiceUploadError('missing_voice_message_id');
    }
    _pendingKey = null;
    _pendingObjectId = null;
    _pendingUploadUrl = null;
    _pendingHeaders = null;
    _pendingConfirmed = false;
    _pendingExpiryMs = 0;
    return messageId;
  }

  Future<Uint8List> read({
    required String userUid, required String objectId,
  }) async {
    final result = await _post(userUid, {
      'action':'prepareRead','objectId':objectId,
    });
    final uri = Uri.tryParse((result['readUrl'] ?? '').toString());
    if (uri == null || uri.scheme != 'https') {
      throw const PrivateVoiceUploadError('invalid_voice_read_url');
    }
    final response = await _client.get(uri).timeout(const Duration(seconds: 20));
    if (FirebaseAuth.instance.currentUser?.uid != userUid ||
        response.statusCode < 200 || response.statusCode >= 300 ||
        response.bodyBytes.length > privateVoiceMaxBytes) {
      throw const PrivateVoiceUploadError('voice_read_failed');
    }
    return response.bodyBytes;
  }
  void dispose() => _client.close();
}
