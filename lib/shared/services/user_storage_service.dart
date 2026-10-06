import 'dart:convert';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;
import 'package:flutter/foundation.dart' show compute;
import 'package:image/image.dart' as img;


const int userImageGlobalMaxBytes = 3 * 1024 * 1024;
const int userImageMaxLongestSide = 2048;

const Map<String, int> _userImageScopeMaxBytes = <String, int>{
  'profile_image': 2 * 1024 * 1024,
  'profile_cover': userImageGlobalMaxBytes,
  'room_cover': userImageGlobalMaxBytes,
  'agency_logo': 2 * 1024 * 1024,
  'agency_background': userImageGlobalMaxBytes,
  'agency_room_image': userImageGlobalMaxBytes,
  'chat_image': userImageGlobalMaxBytes,
  'diary_image': userImageGlobalMaxBytes,
};

class PreparedUserImage {
  const PreparedUserImage({
    required this.bytes,
    required this.mimeType,
    required this.originalBytes,
    required this.wasProcessed,
  });

  final Uint8List bytes;
  final String mimeType;
  final int originalBytes;
  final bool wasProcessed;
}

Future<PreparedUserImage> prepareUserImageForUpload({
  required String scope,
  required Uint8List bytes,
  required String mimeType,
}) async {
  final limit = _userImageScopeMaxBytes[scope.trim()];
  if (limit == null) {
    return PreparedUserImage(
      bytes: bytes,
      mimeType: mimeType,
      originalBytes: bytes.length,
      wasProcessed: false,
    );
  }
  if (bytes.isEmpty) throw StateError('empty_file');

  final normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedMime == 'image/gif') {
    if (scope.trim() != 'profile_image') {
      throw StateError('gif_profile_only');
    }
    if (bytes.length > limit) {
      throw StateError('image_too_large_after_compression');
    }
    return PreparedUserImage(
      bytes: bytes,
      mimeType: 'image/gif',
      originalBytes: bytes.length,
      wasProcessed: false,
    );
  }

  final result = await compute(_prepareUserImageJob, <String, Object>{
    'bytes': bytes,
    'mimeType': mimeType.trim().toLowerCase(),
    'maxBytes': limit,
    'maxLongestSide': userImageMaxLongestSide,
  });

  return PreparedUserImage(
    bytes: result['bytes']! as Uint8List,
    mimeType: result['mimeType']! as String,
    originalBytes: bytes.length,
    wasProcessed: result['wasProcessed'] == true,
  );
}

Map<String, Object> _prepareUserImageJob(Map<String, Object> input) {
  final bytes = input['bytes']! as Uint8List;
  final mimeType = input['mimeType']! as String;
  final maxBytes = input['maxBytes']! as int;
  final maxLongestSide = input['maxLongestSide']! as int;

  final decoded = img.decodeImage(bytes);
  if (decoded == null) throw StateError('image_decode_failed');
  final baked = img.bakeOrientation(decoded);

  final originalLongest =
      baked.width > baked.height ? baked.width : baked.height;
  if (bytes.length <= maxBytes && originalLongest <= maxLongestSide) {
    return <String, Object>{
      'bytes': bytes,
      'mimeType': mimeType,
      'wasProcessed': false,
    };
  }

  img.Image resizeToLongest(img.Image source, int longest) {
    if (source.width >= source.height) {
      return img.copyResize(
        source,
        width: longest,
        interpolation: img.Interpolation.cubic,
      );
    }
    return img.copyResize(
      source,
      height: longest,
      interpolation: img.Interpolation.cubic,
    );
  }

  var working = baked;
  if (originalLongest > maxLongestSide) {
    working = resizeToLongest(working, maxLongestSide);
  }

  Uint8List? smallest;
  const qualitySteps = <int>[86, 80, 74, 68, 62, 56];
  const dimensionSteps = <int>[2048, 1800, 1600, 1440, 1280, 1120, 960];

  for (final dimension in dimensionSteps) {
    final currentLongest =
        working.width > working.height ? working.width : working.height;
    if (currentLongest > dimension) {
      working = resizeToLongest(working, dimension);
    }
    for (final quality in qualitySteps) {
      final encoded = img.encodeWebP(
        working,
        lossless: false,
        quality: quality,
        method: 4,
        alphaQuality: 85,
      );
      if (smallest == null || encoded.length < smallest.length) {
        smallest = encoded;
      }
      if (encoded.length <= maxBytes) {
        return <String, Object>{
          'bytes': encoded,
          'mimeType': 'image/webp',
          'wasProcessed': true,
        };
      }
    }
  }

  if (smallest != null && smallest.length <= maxBytes) {
    return <String, Object>{
      'bytes': smallest,
      'mimeType': 'image/webp',
      'wasProcessed': true,
    };
  }
  throw StateError('image_too_large_after_compression');
}

String detectSupportedImageMime(Uint8List bytes) {
  if (bytes.length >= 3 &&
      bytes[0] == 0xFF &&
      bytes[1] == 0xD8 &&
      bytes[2] == 0xFF) {
    return 'image/jpeg';
  }
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4E &&
      bytes[3] == 0x47 &&
      bytes[4] == 0x0D &&
      bytes[5] == 0x0A &&
      bytes[6] == 0x1A &&
      bytes[7] == 0x0A) {
    return 'image/png';
  }
  if (bytes.length >= 6 &&
      bytes[0] == 0x47 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x38 &&
      (bytes[4] == 0x37 || bytes[4] == 0x39) &&
      bytes[5] == 0x61) {
    return 'image/gif';
  }
  if (bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50) {
    return 'image/webp';
  }
  throw StateError('unsupported_image_format');
}

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

    final preparedImage = await prepareUserImageForUpload(
      scope: scope,
      bytes: bytes,
      mimeType: mimeType,
    );
    final uploadBytes = preparedImage.bytes;
    final uploadMimeType = preparedImage.mimeType;

    final token = await _token();
    final prepare = await _postAction(token, {
      'action': 'prepareUpload',
      'scope': scope,
      'mimeType': uploadMimeType,
      'byteLength': uploadBytes.length,
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
    requiredHeaders.putIfAbsent('content-type', () => uploadMimeType);

    final uploadResponse = await _client.put(
      Uri.parse(uploadUrl),
      headers: requiredHeaders,
      body: uploadBytes,
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
