import 'dart:convert';
import 'dart:math';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RelationshipTypeOption {
  const RelationshipTypeOption({
    required this.key,
    required this.labelAr,
    required this.enabled,
    required this.order,
    required this.assetKey,
  });

  final String key;
  final String labelAr;
  final bool enabled;
  final int order;
  final String assetKey;

  factory RelationshipTypeOption.fromMap(Map<String, dynamic> data) {
    return RelationshipTypeOption(
      key: (data['key'] ?? '').toString().trim(),
      labelAr: (data['labelAr'] ?? data['label'] ?? '').toString().trim(),
      enabled: data['enabled'] != false,
      order: (data['order'] as num?)?.toInt() ?? 999,
      assetKey: (data['assetKey'] ?? '').toString().trim(),
    );
  }
}

class RelationshipItem {
  const RelationshipItem({
    required this.relationshipId,
    required this.relationshipType,
    required this.relationshipTypeLabel,
    required this.assetKey,
    required this.partnerUid,
    required this.partnerName,
    required this.partnerPublicId,
    required this.partnerProfileImageUrl,
    required this.partnerProfileAvatarAsset,
  });

  final String relationshipId;
  final String relationshipType;
  final String relationshipTypeLabel;
  final String assetKey;
  final String partnerUid;
  final String partnerName;
  final String partnerPublicId;
  final String partnerProfileImageUrl;
  final String partnerProfileAvatarAsset;

  factory RelationshipItem.fromMap(Map<String, dynamic> data) {
    return RelationshipItem(
      relationshipId: (data['relationshipId'] ?? '').toString().trim(),
      relationshipType: (data['relationshipType'] ?? '').toString().trim(),
      relationshipTypeLabel:
          (data['relationshipTypeLabel'] ?? '').toString().trim(),
      assetKey: (data['assetKey'] ?? '').toString().trim(),
      partnerUid: (data['partnerUid'] ?? '').toString().trim(),
      partnerName: (data['partnerName'] ?? 'مستخدم Shadow Live').toString().trim(),
      partnerPublicId: (data['partnerPublicId'] ?? '').toString().trim(),
      partnerProfileImageUrl:
          (data['partnerProfileImageUrl'] ?? '').toString().trim(),
      partnerProfileAvatarAsset:
          (data['partnerProfileAvatarAsset'] ?? '').toString().trim(),
    );
  }
}

class RelationshipOverview {
  const RelationshipOverview({required this.items, required this.types});
  final List<RelationshipItem> items;
  final List<RelationshipTypeOption> types;
}

class RelationshipRequestDetail {
  const RelationshipRequestDetail({
    required this.requestId,
    required this.actorUid,
    required this.targetUid,
    required this.actorName,
    required this.targetName,
    required this.relationshipType,
    required this.relationshipTypeLabel,
    required this.status,
    required this.decision,
    required this.relationshipId,
  });

  final String requestId;
  final String actorUid;
  final String targetUid;
  final String actorName;
  final String targetName;
  final String relationshipType;
  final String relationshipTypeLabel;
  final String status;
  final String decision;
  final String? relationshipId;

  factory RelationshipRequestDetail.fromMap(Map<String, dynamic> data) {
    return RelationshipRequestDetail(
      requestId: (data['requestId'] ?? '').toString().trim(),
      actorUid: (data['actorUid'] ?? '').toString().trim(),
      targetUid: (data['targetUid'] ?? '').toString().trim(),
      actorName: (data['actorName'] ?? '').toString().trim(),
      targetName: (data['targetName'] ?? '').toString().trim(),
      relationshipType: (data['relationshipType'] ?? '').toString().trim(),
      relationshipTypeLabel:
          (data['relationshipTypeLabel'] ?? '').toString().trim(),
      status: (data['status'] ?? '').toString().trim(),
      decision: (data['decision'] ?? '').toString().trim(),
      relationshipId: _nullable(data['relationshipId']),
    );
  }
}

class RelationshipApiException implements Exception {
  const RelationshipApiException(this.code);
  final String code;

  @override
  String toString() => code;
}

class RelationshipService {
  RelationshipService({
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final String _baseUrl;
  static final Random _random = Random.secure();

  String _operationKey(String action) {
    final micros = DateTime.now().microsecondsSinceEpoch;
    final entropy = _random.nextInt(0x7fffffff);
    return 'rel_${action}_${micros}_${entropy}';
  }

  Future<Map<String, dynamic>> _post(
    String action, [
    Map<String, dynamic> data = const {},
  ]) async {
    final user = _auth.currentUser;
    if (user == null || user.isAnonymous) {
      throw const RelationshipApiException('auth_required');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw const RelationshipApiException('auth_required');
    }

    final response = await http.post(
      Uri.parse('$_baseUrl/relationships'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode({'action': action, ...data}),
    );

    Map<String, dynamic> body = <String, dynamic>{};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map<String, dynamic>) body = decoded;
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw RelationshipApiException(
        (body['code'] ?? 'relationships_failed').toString(),
      );
    }
    return body;
  }

  Future<List<RelationshipTypeOption>> types() async {
    final body = await _post('types');
    final raw = body['types'];
    if (raw is! List) return const [];
    final items = raw
        .whereType<Map>()
        .map((entry) => RelationshipTypeOption.fromMap(
              Map<String, dynamic>.from(entry),
            ))
        .toList(growable: false);
    items.sort((a, b) => a.order.compareTo(b.order));
    return items;
  }

  Future<RelationshipOverview> listMine() async {
    final body = await _post('listMine');
    final rawItems = body['items'];
    final rawTypes = body['types'];
    final items = rawItems is List
        ? rawItems
            .whereType<Map>()
            .map((entry) =>
                RelationshipItem.fromMap(Map<String, dynamic>.from(entry)))
            .toList(growable: false)
        : <RelationshipItem>[];
    final types = rawTypes is List
        ? rawTypes
            .whereType<Map>()
            .map((entry) => RelationshipTypeOption.fromMap(
                  Map<String, dynamic>.from(entry),
                ))
            .toList(growable: false)
        : <RelationshipTypeOption>[];
    types.sort((a, b) => a.order.compareTo(b.order));
    return RelationshipOverview(items: items, types: types);
  }

  Future<String> sendRequest({
    required String targetUserId,
    required String relationshipType,
  }) async {
    final body = await _post('sendRequest', {
      'targetUserId': targetUserId,
      'relationshipType': relationshipType,
      'idempotencyKey': _operationKey('send'),
    });
    return (body['requestId'] ?? '').toString();
  }

  Future<RelationshipRequestDetail> requestDetail(String requestId) async {
    final body = await _post('requestDetail', {'requestId': requestId});
    final raw = body['request'];
    if (raw is! Map) {
      throw const RelationshipApiException('request_not_found');
    }
    return RelationshipRequestDetail.fromMap(
      Map<String, dynamic>.from(raw),
    );
  }

  Future<void> respondRequest({
    required String requestId,
    required bool accept,
  }) async {
    await _post('respondRequest', {
      'requestId': requestId,
      'decision': accept ? 'accept' : 'reject',
      'idempotencyKey': _operationKey(accept ? 'accept' : 'reject'),
    });
  }

  Future<void> cancelRequest(String requestId) async {
    await _post('cancelRequest', {
      'requestId': requestId,
      'idempotencyKey': _operationKey('cancel'),
    });
  }

  Future<void> endRelationship(String relationshipId) async {
    await _post('endRelationship', {
      'relationshipId': relationshipId,
      'idempotencyKey': _operationKey('end'),
    });
  }
}

String? _nullable(dynamic value) {
  final text = (value ?? '').toString().trim();
  return text.isEmpty ? null : text;
}

String relationshipErrorMessage(Object error) {
  final code = error is RelationshipApiException
      ? error.code
      : error.toString();
  switch (code) {
    case 'auth_required':
      return 'سجّل الدخول لاستخدام العلاقات.';
    case 'blocked':
      return 'لا يمكن تنفيذ الطلب بسبب الحظر بين الحسابين.';
    case 'relationship_slot_occupied':
      return 'أحد الحسابين لديه علاقة نشطة من نفس النوع.';
    case 'relationship_already_active':
      return 'هذه العلاقة نشطة مسبقاً.';
    case 'relationship_request_already_pending':
      return 'يوجد طلب معلّق من نفس النوع بين الحسابين.';
    case 'relationship_type_disabled':
      return 'نوع العلاقة غير متاح حالياً.';
    case 'request_already_resolved':
      return 'تمت معالجة هذا الطلب مسبقاً.';
    case 'request_not_found':
      return 'طلب العلاقة غير موجود.';
    case 'relationship_not_active':
      return 'العلاقة غير نشطة حالياً.';
    case 'forbidden':
      return 'لا تملك صلاحية تنفيذ هذا الإجراء.';
    case 'route_not_found':
      return 'خدمة العلاقات غير متاحة في إصدار الخادم الحالي. حدّث التطبيق أو أعد المحاولة لاحقاً.';
    case 'relationships_failed':
      return 'تعذر الوصول إلى خدمة العلاقات حالياً. أعد المحاولة.';
    default:
      return 'تعذر تنفيذ عملية العلاقة حالياً.';
  }
}
