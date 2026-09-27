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
    required this.readPath,
    this.replacedObjectId,
  });

  final String objectId;
  final String scope;
  final String targetId;
  final String mimeType;
  final int sizeBytes;
  final String readPath;
  final String? replacedObjectId;

  factory UserStorageUploadResult.fromJson(Map<String, dynamic> json) {
    return UserStorageUploadResult(
      objectId: (json['objectId'] ?? '').toString(),
      scope: (json['scope'] ?? '').toString(),
      targetId: (json['targetId'] ?? '').toString(),
      mimeType: (json['mimeType'] ?? '').toString(),
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      readPath: (json['readPath'] ?? '').toString(),
      replacedObjectId: (json['replacedObjectId'] ?? '').toString().trim().isEmpty
          ? null
          : (json['replacedObjectId'] ?? '').toString(),
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

  Uri _storageUri(Map<String, String> query) {
    return Uri.parse('$_baseUrl/user-storage').replace(
      queryParameters: query,
    );
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
    final query = <String, String>{'scope': scope};
    if (targetId != null && targetId.trim().isNotEmpty) {
      query['targetId'] = targetId.trim();
    }
    if (replaceObjectId != null && replaceObjectId.trim().isNotEmpty) {
      query['replaceObjectId'] = replaceObjectId.trim();
    }

    final response = await _client.put(
      _storageUri(query),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': mimeType,
      },
      body: bytes,
    ).timeout(const Duration(seconds: 30));

    final body = _decodeJson(response.bodyBytes);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'storage_upload_failed').toString());
    }
    return UserStorageUploadResult.fromJson(body);
  }

  Future<UserStorageObject> read(String objectId) async {
    final cleanId = objectId.trim();
    if (cleanId.isEmpty) throw StateError('invalid_object_id');

    final token = await _token();
    final response = await _client.get(
      _storageUri({'objectId': cleanId}),
      headers: {'authorization': 'Bearer $token'},
    ).timeout(const Duration(seconds: 25));

    if (response.statusCode != 200) {
      final body = _decodeJson(response.bodyBytes);
      throw StateError((body['code'] ?? 'storage_read_failed').toString());
    }

    return UserStorageObject(
      bytes: Uint8List.fromList(response.bodyBytes),
      mimeType: (response.headers['content-type'] ?? 'application/octet-stream')
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
      _storageUri({'objectId': cleanId}),
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
