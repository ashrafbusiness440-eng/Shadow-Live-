import 'dart:convert';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class DiaryMentionCandidate {
  const DiaryMentionCandidate({
    required this.uid,
    required this.displayName,
    required this.publicId,
    required this.profileImageUrl,
    required this.profileAvatarAsset,
  });

  final String uid;
  final String displayName;
  final String publicId;
  final String profileImageUrl;
  final String profileAvatarAsset;

  factory DiaryMentionCandidate.fromMap(Map<String, dynamic> data) {
    return DiaryMentionCandidate(
      uid: (data['uid'] ?? '').toString().trim(),
      displayName:
          (data['displayName'] ?? 'مستخدم Shadow Live').toString().trim(),
      publicId: (data['publicId'] ?? '').toString().trim(),
      profileImageUrl: (data['profileImageUrl'] ?? '').toString().trim(),
      profileAvatarAsset:
          (data['profileAvatarAsset'] ?? '').toString().trim(),
    );
  }
}

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
    required this.activeProfileFrameAssetKey,
    required this.activeProfileFrameImageUrl,
    required this.activeProfileFrameExpiresAtMs,
    required this.activeProfileFramePermanent,
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
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;
  final String text;
  final List<DiaryImageItem> images;
  final bool commentsEnabled;
  final int likeCount;
  final int commentCount;
  final int giftCount;
  final int giftCoins;
  final int viewCount;
  final int createdAtMs;

  DiaryItem copyWith({
    int? likeCount,
    int? commentCount,
    int? giftCount,
    int? giftCoins,
    int? viewCount,
    bool? commentsEnabled,
  }) {
    return DiaryItem(
      diaryId: diaryId,
      ownerUid: ownerUid,
      ownerName: ownerName,
      ownerPublicId: ownerPublicId,
      ownerProfileImageUrl: ownerProfileImageUrl,
      ownerProfileAvatarAsset: ownerProfileAvatarAsset,
      activeProfileFrameAssetKey: activeProfileFrameAssetKey,
      activeProfileFrameImageUrl: activeProfileFrameImageUrl,
      activeProfileFrameExpiresAtMs: activeProfileFrameExpiresAtMs,
      activeProfileFramePermanent: activeProfileFramePermanent,
      text: text,
      images: images,
      commentsEnabled: commentsEnabled ?? this.commentsEnabled,
      likeCount: likeCount ?? this.likeCount,
      commentCount: commentCount ?? this.commentCount,
      giftCount: giftCount ?? this.giftCount,
      giftCoins: giftCoins ?? this.giftCoins,
      viewCount: viewCount ?? this.viewCount,
      createdAtMs: createdAtMs,
    );
  }

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
      activeProfileFrameAssetKey:
          (data['activeProfileFrameAssetKey'] ?? '').toString().trim(),
      activeProfileFrameImageUrl:
          (data['activeProfileFrameImageUrl'] ?? '').toString().trim(),
      activeProfileFrameExpiresAtMs:
          (data['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
      activeProfileFramePermanent:
          data['activeProfileFramePermanent'] == true,
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

class DiaryCommentItem {
  const DiaryCommentItem({
    required this.commentId,
    required this.diaryId,
    required this.authorUid,
    required this.authorName,
    required this.authorPublicId,
    required this.authorProfileImageUrl,
    required this.authorProfileAvatarAsset,
    required this.text,
    required this.createdAtMs,
  });

  final String commentId;
  final String diaryId;
  final String authorUid;
  final String authorName;
  final String authorPublicId;
  final String authorProfileImageUrl;
  final String authorProfileAvatarAsset;
  final String text;
  final int createdAtMs;

  factory DiaryCommentItem.fromMap(Map<String, dynamic> data) {
    return DiaryCommentItem(
      commentId: (data['commentId'] ?? '').toString().trim(),
      diaryId: (data['diaryId'] ?? '').toString().trim(),
      authorUid: (data['authorUid'] ?? '').toString().trim(),
      authorName:
          (data['authorName'] ?? 'مستخدم Shadow Live').toString().trim(),
      authorPublicId: (data['authorPublicId'] ?? '').toString().trim(),
      authorProfileImageUrl:
          (data['authorProfileImageUrl'] ?? '').toString().trim(),
      authorProfileAvatarAsset:
          (data['authorProfileAvatarAsset'] ?? '').toString().trim(),
      text: (data['text'] ?? '').toString(),
      createdAtMs: (data['createdAtMs'] as num?)?.toInt() ?? 0,
    );
  }
}

class DiaryCommentPage {
  const DiaryCommentPage({
    required this.items,
    required this.nextCursor,
    required this.hasMore,
  });

  final List<DiaryCommentItem> items;
  final String? nextCursor;
  final bool hasMore;

  factory DiaryCommentPage.fromMap(Map<String, dynamic> data) {
    final raw = data['items'];
    final cursor = (data['nextCursor'] ?? '').toString().trim();
    return DiaryCommentPage(
      items: raw is List
          ? raw
              .whereType<Map>()
              .map((item) => DiaryCommentItem.fromMap(
                    Map<String, dynamic>.from(item),
                  ))
              .where((item) => item.commentId.isNotEmpty)
              .toList(growable: false)
          : const <DiaryCommentItem>[],
      nextCursor: cursor.isEmpty ? null : cursor,
      hasMore: data['hasMore'] == true,
    );
  }
}

class DiaryLikeResult {
  const DiaryLikeResult({
    required this.liked,
    required this.likeCount,
  });

  final bool liked;
  final int likeCount;
}

class DiaryCommentMutationResult {
  const DiaryCommentMutationResult({
    required this.commentCount,
    this.comment,
  });

  final int commentCount;
  final DiaryCommentItem? comment;
}

class DiaryViewResult {
  const DiaryViewResult({
    required this.counted,
    required this.viewCount,
  });

  final bool counted;
  final int viewCount;
}

class DiaryGiftEventItem {
  const DiaryGiftEventItem({
    required this.giftEventId,
    required this.giftOperationId,
    required this.diaryId,
    required this.senderId,
    required this.senderName,
    required this.senderPublicId,
    required this.senderProfileImageUrl,
    required this.receiverId,
    required this.giftId,
    required this.giftName,
    required this.quantity,
    required this.unitCoins,
    required this.totalCost,
    required this.imageUrl,
    required this.assetKey,
    required this.createdAtMs,
  });

  final String giftEventId;
  final String giftOperationId;
  final String diaryId;
  final String senderId;
  final String senderName;
  final String senderPublicId;
  final String senderProfileImageUrl;
  final String receiverId;
  final String giftId;
  final String giftName;
  final int quantity;
  final int unitCoins;
  final int totalCost;
  final String imageUrl;
  final String assetKey;
  final int createdAtMs;

  factory DiaryGiftEventItem.fromMap(Map<String, dynamic> data) {
    return DiaryGiftEventItem(
      giftEventId: (data['giftEventId'] ?? '').toString().trim(),
      giftOperationId: (data['giftOperationId'] ?? '').toString().trim(),
      diaryId: (data['diaryId'] ?? '').toString().trim(),
      senderId: (data['senderId'] ?? '').toString().trim(),
      senderName: (data['senderName'] ?? 'مستخدم Shadow Live').toString().trim(),
      senderPublicId: (data['senderPublicId'] ?? '').toString().trim(),
      senderProfileImageUrl:
          (data['senderProfileImageUrl'] ?? '').toString().trim(),
      receiverId: (data['receiverId'] ?? '').toString().trim(),
      giftId: (data['giftId'] ?? '').toString().trim(),
      giftName: (data['giftName'] ?? 'هدية').toString().trim(),
      quantity: (data['quantity'] as num?)?.toInt() ?? 1,
      unitCoins: (data['unitCoins'] as num?)?.toInt() ?? 0,
      totalCost: (data['totalCost'] as num?)?.toInt() ?? 0,
      imageUrl: (data['imageUrl'] ?? '').toString().trim(),
      assetKey: (data['assetKey'] ?? '').toString().trim(),
      createdAtMs: (data['createdAtMs'] as num?)?.toInt() ?? 0,
    );
  }
}

class DiaryGiftEventPage {
  const DiaryGiftEventPage({
    required this.items,
    required this.nextCursor,
    required this.hasMore,
  });

  final List<DiaryGiftEventItem> items;
  final String? nextCursor;
  final bool hasMore;

  factory DiaryGiftEventPage.fromMap(Map<String, dynamic> data) {
    final raw = data['items'];
    final cursor = (data['nextCursor'] ?? '').toString().trim();
    return DiaryGiftEventPage(
      items: raw is List
          ? raw
              .whereType<Map>()
              .map((item) => DiaryGiftEventItem.fromMap(
                    Map<String, dynamic>.from(item),
                  ))
              .where((item) => item.giftEventId.isNotEmpty)
              .toList(growable: false)
          : const <DiaryGiftEventItem>[],
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

  Future<DiaryItem> getDiary(String diaryId) async {
    final body = await _post('getDiary', <String, dynamic>{
      'diaryId': diaryId.trim(),
    });
    final raw = body['diary'];
    if (raw is! Map) throw const DiaryApiException('diary_not_found');
    return DiaryItem.fromMap(Map<String, dynamic>.from(raw));
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

  Future<DiaryPage> listUser(
    String userId, {
    String? cursor,
    int limit = 20,
  }) async {
    final normalizedUserId = userId.trim();
    if (normalizedUserId.isEmpty) {
      throw const DiaryApiException('invalid_user');
    }
    final body = await _post('listUser', <String, dynamic>{
      'userId': normalizedUserId,
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

  Future<List<DiaryMentionCandidate>> searchMentions(String query) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final normalized = query.trim();
    if (normalized.isEmpty) return const <DiaryMentionCandidate>[];
    final body = await _post('searchMentions', <String, dynamic>{
      'query': normalized,
    });
    final raw = body['items'];
    if (raw is! List) return const <DiaryMentionCandidate>[];
    return raw
        .whereType<Map>()
        .map((item) => DiaryMentionCandidate.fromMap(
              Map<String, dynamic>.from(item),
            ))
        .where((item) => item.uid.isNotEmpty && item.publicId.isNotEmpty)
        .take(8)
        .toList(growable: false);
  }

  Future<bool> reportDiary({
    required String diaryId,
    required String reason,
  }) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('reportDiary', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'reason': reason.trim(),
    });
    return body['code'] == 'duplicate';
  }

  Future<bool> reportComment({
    required String diaryId,
    required String commentId,
    required String reason,
  }) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('reportComment', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'commentId': commentId.trim(),
      'reason': reason.trim(),
    });
    return body['code'] == 'duplicate';
  }

  Future<DiaryLikeResult> toggleLike(String diaryId) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('toggleLike', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'idempotencyKey': _operationKey('like'),
    });
    return DiaryLikeResult(
      liked: body['liked'] == true,
      likeCount: (body['likeCount'] as num?)?.toInt() ?? 0,
    );
  }

  Future<DiaryCommentPage> listComments(
    String diaryId, {
    String? cursor,
    int limit = 20,
  }) async {
    final body = await _post('listComments', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'limit': limit,
      if (cursor != null && cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
    });
    return DiaryCommentPage.fromMap(body);
  }

  Future<DiaryCommentMutationResult> createComment({
    required String diaryId,
    required String text,
  }) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('createComment', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'text': text.trim(),
      'idempotencyKey': _operationKey('comment_create'),
    });
    final rawComment = body['comment'];
    return DiaryCommentMutationResult(
      commentCount: (body['commentCount'] as num?)?.toInt() ?? 0,
      comment: rawComment is Map
          ? DiaryCommentItem.fromMap(Map<String, dynamic>.from(rawComment))
          : null,
    );
  }

  Future<DiaryCommentMutationResult> deleteComment({
    required String diaryId,
    required String commentId,
  }) async {
    if (isGuest) throw const DiaryApiException('guest_restricted');
    final body = await _post('deleteComment', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'commentId': commentId.trim(),
      'idempotencyKey': _operationKey('comment_delete'),
    });
    return DiaryCommentMutationResult(
      commentCount: (body['commentCount'] as num?)?.toInt() ?? 0,
    );
  }

  Future<DiaryViewResult> recordView(String diaryId) async {
    final body = await _post('recordView', <String, dynamic>{
      'diaryId': diaryId.trim(),
    });
    return DiaryViewResult(
      counted: body['counted'] == true,
      viewCount: (body['viewCount'] as num?)?.toInt() ?? 0,
    );
  }

  Future<DiaryGiftEventPage> listGiftEvents(
    String diaryId, {
    String? cursor,
    int limit = 20,
  }) async {
    final body = await _post('listGiftEvents', <String, dynamic>{
      'diaryId': diaryId.trim(),
      'limit': limit,
      if (cursor != null && cursor.trim().isNotEmpty) 'cursor': cursor.trim(),
    });
    return DiaryGiftEventPage.fromMap(body);
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
    case 'empty_comment':
      return 'اكتب تعليقاً قبل الإرسال.';
    case 'invalid_report_reason':
      return 'اختر سبباً صحيحاً للإبلاغ.';
    case 'invalid_report_target':
      return 'تعذر إرسال البلاغ لهذا المحتوى.';
    case 'comment_text_too_long':
      return 'الحد الأقصى للتعليق 200 حرف.';
    case 'comments_disabled':
      return 'التعليقات متوقفة على هذه اليومية.';
    case 'comment_not_found':
      return 'هذا التعليق لم يعد موجوداً.';
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
