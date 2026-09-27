import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class UserStorageUploadResult {
  const UserStorageUploadResult({
    required this.objectId,
    required this.scope,
    required this.targetId,
    required this.mimeType,
    required this.sizeBytes,
    this.replacedObjectId,
    this.publicUrl,
  });

  final String objectId;
  final String scope;
  final String targetId;
  final String mimeType;
  final int sizeBytes;
  final String? replacedObjectId;
  final String? publicUrl;

  factory UserStorageUploadResult.fromJson(Map<String, dynamic> json) {
    final replaced = (json['replacedObjectId'] ?? '').toString().trim();
    final publicUrl = (json['publicUrl'] ?? '').toString().trim();
    return UserStorageUploadResult(
      objectId: (json['objectId'] ?? '').toString(),
      scope: (json['scope'] ?? '').toString(),
      targetId: (json['targetId'] ?? '').toString(),
      mimeType: (json['mimeType'] ?? '').toString(),
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      replacedObjectId: replaced.isEmpty ? null : replaced,
      publicUrl: publicUrl.isEmpty ? null : publicUrl,
    );
  }
}

class UserStorageObject {
  const UserStorageObject({
    required this.bytes,
    required this.mimeType,
  });

  final Uint8List bytes;
  final String mimeType;
}

class UserStorageService {
  UserStorageService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Future<String> _token() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Uri get _storageUri => Uri.parse('$_baseUrl/user-storage');

  Future<Map<String, dynamic>> _postAction(
    String token,
    Map<String, dynamic> payload,
  ) async {
    final response = await _client.post(
      _storageUri,
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 20));

    final body = _decodeJson(response.bodyBytes);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'storage_request_failed').toString());
    }
    return body;
  }

  Future<UserStorageUploadResult> upload({
    required String scope,
    required Uint8List bytes,
    required String mimeType,
    String? targetId,
    String? replaceObjectId,
  }) async {
    if (bytes.isEmpty) throw StateError('empty_file');

    final token = await _token();
    final prepare = await _postAction(token, {
      'action': 'prepareUpload',
      'scope': scope,
      'mimeType': mimeType,
      'byteLength': bytes.length,
      if (targetId != null && targetId.trim().isNotEmpty)
        'targetId': targetId.trim(),
      if (replaceObjectId != null && replaceObjectId.trim().isNotEmpty)
        'replaceObjectId': replaceObjectId.trim(),
    });

    final objectId = (prepare['objectId'] ?? '').toString().trim();
    final uploadUrl = (prepare['uploadUrl'] ?? '').toString().trim();
    if (objectId.isEmpty || uploadUrl.isEmpty) {
      throw StateError('storage_prepare_invalid');
    }

    final requiredHeaders = <String, String>{};
    final rawHeaders = prepare['requiredHeaders'];
    if (rawHeaders is Map) {
      for (final entry in rawHeaders.entries) {
        requiredHeaders[entry.key.toString()] = entry.value.toString();
      }
    }
    requiredHeaders.putIfAbsent('content-type', () => mimeType);

    final uploadResponse = await _client.put(
      Uri.parse(uploadUrl),
      headers: requiredHeaders,
      body: bytes,
    ).timeout(const Duration(seconds: 45));
    if (uploadResponse.statusCode < 200 || uploadResponse.statusCode >= 300) {
      throw StateError('storage_direct_upload_failed');
    }

    final confirm = await _postAction(token, {
      'action': 'confirmUpload',
      'objectId': objectId,
    });
    return UserStorageUploadResult.fromJson(confirm);
  }

  Future<UserStorageObject> read(String objectId) async {
    final cleanId = objectId.trim();
    if (cleanId.isEmpty) throw StateError('invalid_object_id');

    final token = await _token();
    final prepared = await _postAction(token, {
      'action': 'prepareRead',
      'objectId': cleanId,
    });
    final readUrl = (prepared['readUrl'] ?? '').toString().trim();
    if (readUrl.isEmpty) throw StateError('storage_read_url_missing');

    final response = await _client
        .get(Uri.parse(readUrl))
        .timeout(const Duration(seconds: 30));
    if (response.statusCode != 200) {
      throw StateError('storage_direct_read_failed');
    }

    return UserStorageObject(
      bytes: Uint8List.fromList(response.bodyBytes),
      mimeType: (response.headers['content-type'] ??
              (prepared['mimeType'] ?? 'application/octet-stream').toString())
          .split(';')
          .first
          .trim(),
    );
  }

  Future<void> delete(String objectId) async {
    final cleanId = objectId.trim();
    if (cleanId.isEmpty) throw StateError('invalid_object_id');

    final token = await _token();
    final request = http.Request(
      'DELETE',
      _storageUri.replace(queryParameters: {'objectId': cleanId}),
    );
    request.headers['authorization'] = 'Bearer $token';
    final streamed = await _client
        .send(request)
        .timeout(const Duration(seconds: 20));
    final response = await http.Response.fromStream(streamed);
    final body = _decodeJson(response.bodyBytes);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'storage_delete_failed').toString());
    }
  }

  Future<bool> isReady() async {
    try {
      final response = await _client
          .get(Uri.parse('$_baseUrl/storage-health'))
          .timeout(const Duration(seconds: 10));
      if (response.statusCode != 200) return false;
      final body = _decodeJson(response.bodyBytes);
      return body['ok'] == true && body['provider'] == 'cloudflare-r2';
    } catch (_) {
      return false;
    }
  }

  Map<String, dynamic> _decodeJson(List<int> bytes) {
    try {
      final decoded = jsonDecode(utf8.decode(bytes));
      return decoded is Map
          ? Map<String, dynamic>.from(decoded)
          : <String, dynamic>{};
    } catch (_) {
      return <String, dynamic>{};
    }
  }

  void close() => _client.close();
}
