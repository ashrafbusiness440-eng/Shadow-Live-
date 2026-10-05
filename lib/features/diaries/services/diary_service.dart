import 'dart:convert';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class DiaryImageItem {
  const DiaryImageItem({
    required this.objectId,
    required this.publicUrl,
    required this.mimeType,
    required this.sizeBytes,
  });

  final String objectId;
  final String publicUrl;
  final String mimeType;
  final int sizeBytes;

  factory DiaryImageItem.fromMap(Map<String, dynamic> data) {
    return DiaryImageItem(
      objectId: (data['objectId'] ?? '').toString().trim(),
      publicUrl: (data['publicUrl'] ?? '').toString().trim(),
      mimeType: (data['mimeType'] ?? '').toString().trim(),
      sizeBytes: (data['sizeBytes'] as num?)?.toInt() ?? 0,
    );
  }
}

class DiaryItem {
  const DiaryItem({
    required this.diaryId,
    required this.ownerUid,
    required this.ownerName,
    required this.ownerPublicId,
    required this.ownerProfileImageUrl,
    required this.ownerProfileAvatarAsset,
    required this.text,
    required this.images,
    required this.commentsEnabled,
    required this.likeCount,
    required this.commentCount,
    required this.giftCount,
    required this.giftCoins,
    required this.viewCount,
    required this.createdAtMs,
  });

  final String diaryId;
  final String ownerUid;
  final String ownerName;
  final String ownerPublicId;
  final String ownerProfileImageUrl;
  final String ownerProfileAvatarAsset;
  final String text;
  final List<DiaryImageItem> images;
  final bool commentsEnabled;
  final int likeCount;
  final int commentCount;
  final int giftCount;
  final int giftCoins;
  final int viewCount;
  final int createdAtMs;

  factory DiaryItem.fromMap(Map<String, dynamic> data) {
    final rawImages = data['images'];
    return DiaryItem(
      diaryId: (data['diaryId'] ?? '').toString().trim(),
      ownerUid: (data['ownerUid'] ?? '').toString().trim(),
      ownerName:
          (data['ownerName'] ?? 'مستخدم Shadow Live').toString().trim(),
      ownerPublicId: (data['ownerPublicId'] ?? '').toString().trim(),
      ownerProfileImageUrl:
          (data['ownerProfileImageUrl'] ?? '').toString().trim(),
      ownerProfileAvatarAsset:
          (data['ownerProfileAvatarAsset'] ?? '').toString().trim(),
      text: (data['text'] ?? '').toString(),
      images: rawImages is List
          ? rawImages
              .whereType<Map>()
              .map((item) => DiaryImageItem.fromMap(
                    Map<String, dynamic>.from(item),
                  ))
              .where((item) => item.publicUrl.isNotEmpty)
              .take(2)
              .toList(growable: false)
          : const <DiaryImageItem>[],
      commentsEnabled: data['commentsEnabled'] != false,
      likeCount: (data['likeCount'] as num?)?.toInt() ?? 0,
      commentCount: (data['commentCount'] as num?)?.toInt() ?? 0,
      giftCount: (data['giftCount'] as num?)?.toInt() ?? 0,
      giftCoins: (data['giftCoins'] as num?)?.toInt() ?? 0,
      viewCount: (data['viewCount'] as num?)?.toInt() ?? 0,
      createdAtMs: (data['createdAtMs'] as num?)?.toInt() ?? 0,
    );
  }
}

class DiaryPage {
  const DiaryPage({
    required this.items,
    required this.nextCursor,
    required this.hasMore,
  });

  final List<DiaryItem> items;
  final String? nextCursor;
  final bool hasMore;

  factory DiaryPage.fromMap(Map<String, dynamic> data) {
    final raw = data['items'];
    final cursor = (data['nextCursor'] ?? '').toString().trim();
    return DiaryPage(
      items: raw is List
          ? raw
              .whereType<Map>()
              .map((item) =>
                  DiaryItem.fromMap(Map<String, dynamic>.from(item)))
              .where((item) => item.diaryId.isNotEmpty)
              .toList(growable: false)
          : const <DiaryItem>[],
      nextCursor: cursor.isEmpty ? null : cursor,
      hasMore: data['hasMore'] == true,
    );
  }
}

class DiaryApiException implements Exception {
  const DiaryApiException(this.code);
  final String code;

  @override
  String toString() => code;
}

class DiaryService {
  DiaryService({
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
  static final Random _random = Random.secure();

  bool get isGuest => _auth.currentUser?.isAnonymous == true;

  String _operationKey(String action) {
    final micros = DateTime.now().microsecondsSinceEpoch;
    final entropy = _random.nextInt(0x7fffffff);
    return 'diary_${action}_${micros}_$entropy';
  }

  Future<Map<String, dynamic>> _post(
    String action, [
    Map<String, dynamic> data = const <String, dynamic>{},
  ]) async {
    final user = _auth.currentUser;
    if (user == null) throw const DiaryApiException('auth_required');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw const DiaryApiException('auth_required');
    }

    final response = await _client
        .post(
          Uri.parse('$_baseUrl/diaries'),
          headers: <String, String>{
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(<String, dynamic>{
            'action': action,
            ...data,
          }),
        )
        .timeout(const Duration(seconds: 20));

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw DiaryApiException(
        (body['code'] ?? 'diaries_failed').toString(),
      );
    }
    return body;
  }

  Future<DiaryPage> listLatest({
    String? cursor,
    int limit = 20,
  }) async {
    final body = await _post('listLatest', <String, dynamic>{
      'limit': limit,
      if (cursor != null && cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
    });
    return DiaryPage.fromMap(body);
  }

  Future<DiaryPage> listFollowing({
    String? cursor,
    int limit = 20,
  }) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('listFollowing', <String, dynamic>{
      'limit': limit,
      if (cursor != null && cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
    });
    return DiaryPage.fromMap(body);
  }

  Future<String> createDiary({
    required String text,
    required List<String> imageObjectIds,
    required bool commentsEnabled,
  }) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('createDiary', <String, dynamic>{
      'text': text,
      'imageObjectIds': imageObjectIds.take(2).toList(growable: false),
      'commentsEnabled': commentsEnabled,
      'idempotencyKey': _operationKey('create'),
    });
    final diaryId = (body['diaryId'] ?? '').toString().trim();
    if (diaryId.isEmpty) throw const DiaryApiException('diary_create_failed');
    return diaryId;
  }

  void close() => _client.close();
}

String diaryErrorMessage(Object error) {
  final code = error is DiaryApiException
      ? error.code
      : error.toString().replaceFirst('Bad state: ', '').trim();
  switch (code) {
    case 'guest_restricted':
    case 'auth_required':
      return 'سجّل الدخول لاستخدام هذه الميزة.';
    case 'empty_diary':
      return 'اكتب نصاً أو أضف صورة قبل النشر.';
    case 'diary_text_too_long':
      return 'الحد الأقصى للنص 500 حرف.';
    case 'external_links_not_allowed':
      return 'الروابط الخارجية غير مسموحة في يومياتي.';
    case 'invalid_diary_images':
    case 'invalid_diary_image':
      return 'تعذر استخدام إحدى الصور. حاول اختيارها من جديد.';
    case 'image_too_large_after_compression':
      return 'تعذر ضغط الصورة ضمن الحجم المسموح. اختر صورة أصغر.';
    case 'firestore_quota_exhausted':
      return 'الخدمة مشغولة الآن. حاول بعد قليل.';
    default:
      return 'تعذر إكمال العملية. حاول مرة أخرى.';
  }
}
