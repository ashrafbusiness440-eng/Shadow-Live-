import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class MyItemReward {
  const MyItemReward({
    required this.docId,
    required this.rewardId,
    required this.type,
    required this.nameAr,
    required this.assetKey,
    required this.imageUrl,
    required this.expiresAtMs,
    required this.active,
    required this.expired,
  });

  final String docId;
  final String rewardId;
  final String type;
  final String nameAr;
  final String assetKey;
  final String imageUrl;
  final int expiresAtMs;
  final bool active;
  final bool expired;

  int remainingSeconds([int? nowMs]) {
    final now = nowMs ?? DateTime.now().millisecondsSinceEpoch;
    final seconds = ((expiresAtMs - now) / 1000).ceil();
    if (seconds <= 0) return 0;
    return seconds;
  }

  factory MyItemReward.fromMap(Map<String, dynamic> data) => MyItemReward(
        docId: (data['docId'] ?? '').toString(),
        rewardId: (data['rewardId'] ?? '').toString(),
        type: (data['type'] ?? '').toString(),
        nameAr: (data['nameAr'] ?? '').toString(),
        assetKey: (data['assetKey'] ?? '').toString(),
        imageUrl: (data['imageUrl'] ?? '').toString(),
        expiresAtMs: (data['expiresAtMs'] as num?)?.toInt() ?? 0,
        active: data['active'] == true,
        expired: data['expired'] == true,
      );
}

class RewardInventoryService {
  RewardInventoryService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final String _baseUrl;

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final uri = Uri.parse('$_baseUrl/economy-router').replace(
      queryParameters: const {'route': 'reward-inventory'},
    );
    final response = await _client
        .post(
          uri,
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 20));

    final decoded = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'reward_inventory_failed').toString(),
      );
    }
    return decoded;
  }

  Future<List<MyItemReward>> load() async {
    final body = await _post({'action': 'list'});
    final raw = body['items'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map(
          (item) => MyItemReward.fromMap(
            Map<String, dynamic>.from(item),
          ),
        )
        .toList(growable: false);
  }

  Future<void> setActive(
    MyItemReward item, {
    required bool active,
  }) async {
    await _post({
      'action': 'setActive',
      'type': item.type,
      'rewardId': item.rewardId,
      'active': active,
    });
  }

  void close() => _client.close();
}
