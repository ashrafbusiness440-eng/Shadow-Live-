import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class RechargePackageConfig {
  const RechargePackageConfig({
    required this.id,
    required this.productId,
    required this.priceUsd,
    required this.baseCoins,
    required this.bonusCoins,
    required this.enabled,
    required this.badge,
    required this.sortOrder,
    required this.imageAsset,
  });

  final String id;
  final String productId;
  final double priceUsd;
  final int baseCoins;
  final int bonusCoins;
  final bool enabled;
  final String badge;
  final int sortOrder;
  final String imageAsset;

  int get totalCoins => baseCoins + bonusCoins;

  factory RechargePackageConfig.fromMap(Map<String, dynamic> map) {
    return RechargePackageConfig(
      id: (map['id'] ?? '').toString(),
      productId: (map['productId'] ?? '').toString(),
      priceUsd: (map['priceUsd'] as num?)?.toDouble() ?? 0,
      baseCoins: (map['baseCoins'] as num?)?.toInt() ?? 0,
      bonusCoins: (map['bonusCoins'] as num?)?.toInt() ?? 0,
      enabled: map['enabled'] != false,
      badge: (map['badge'] ?? '').toString(),
      sortOrder: (map['sortOrder'] as num?)?.toInt() ?? 0,
      imageAsset: (map['imageAsset'] ?? '').toString(),
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'productId': productId,
        'priceUsd': priceUsd,
        'baseCoins': baseCoins,
        'bonusCoins': bonusCoins,
        'enabled': enabled,
        'badge': badge,
        'sortOrder': sortOrder,
        'imageAsset': imageAsset,
      };
}

class RechargeConfigService {
  RechargeConfigService._();

  static const String _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );
  static const Duration _freshFor = Duration(seconds: 30);
  static const Duration _staleFor = Duration(minutes: 5);
  static const int coinsPerUsd = 10000;
  static List<RechargePackageConfig>? _cachedPackages;
  static DateTime? _loadedAt;
  static Future<List<RechargePackageConfig>>? _inflight;

  static const List<RechargePackageConfig> fallbackPackages = [
    RechargePackageConfig(
      id: 'coins_099',
      productId: 'shadow_coins_099',
      priceUsd: 0.99,
      baseCoins: 9900,
      bonusCoins: 1100,
      enabled: true,
      badge: '',
      sortOrder: 0,
      imageAsset: 'assets/images/coins/coins_500.png',
    ),
    RechargePackageConfig(
      id: 'coins_199',
      productId: 'shadow_coins_199',
      priceUsd: 1.99,
      baseCoins: 19900,
      bonusCoins: 3100,
      enabled: true,
      badge: '',
      sortOrder: 1,
      imageAsset: 'assets/images/coins/coins_1200.png',
    ),
    RechargePackageConfig(
      id: 'coins_499',
      productId: 'shadow_coins_499',
      priceUsd: 4.99,
      baseCoins: 49900,
      bonusCoins: 10100,
      enabled: true,
      badge: 'الأكثر شعبية',
      sortOrder: 2,
      imageAsset: 'assets/images/coins/coins_2500.png',
    ),
    RechargePackageConfig(
      id: 'coins_999',
      productId: 'shadow_coins_999',
      priceUsd: 9.99,
      baseCoins: 99900,
      bonusCoins: 25100,
      enabled: true,
      badge: '',
      sortOrder: 3,
      imageAsset: 'assets/images/coins/coins_5000.png',
    ),
    RechargePackageConfig(
      id: 'coins_2499',
      productId: 'shadow_coins_2499',
      priceUsd: 24.99,
      baseCoins: 249900,
      bonusCoins: 80100,
      enabled: true,
      badge: '',
      sortOrder: 4,
      imageAsset: 'assets/images/coins/coins_12000.png',
    ),
    RechargePackageConfig(
      id: 'coins_4999',
      productId: 'shadow_coins_4999',
      priceUsd: 49.99,
      baseCoins: 499900,
      bonusCoins: 200100,
      enabled: true,
      badge: '',
      sortOrder: 5,
      imageAsset: 'assets/images/coins/coins_25000.png',
    ),
    RechargePackageConfig(
      id: 'coins_9999',
      productId: 'shadow_coins_9999',
      priceUsd: 99.99,
      baseCoins: 999900,
      bonusCoins: 500100,
      enabled: true,
      badge: 'أفضل قيمة',
      sortOrder: 6,
      imageAsset: 'assets/images/coins/coins_25000.png',
    ),
  ];

  static List<RechargePackageConfig> parsePackages(dynamic raw) {
    if (raw is! List) return fallbackPackages;
    final items = raw
        .whereType<Map>()
        .map(
          (item) => RechargePackageConfig.fromMap(
            Map<String, dynamic>.from(item),
          ),
        )
        .where(
          (item) =>
              item.enabled &&
              item.id.isNotEmpty &&
              item.productId.isNotEmpty &&
              item.priceUsd > 0 &&
              item.totalCoins > 0,
        )
        .toList()
      ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
    return items.isEmpty ? fallbackPackages : items;
  }

  static Future<List<RechargePackageConfig>> loadPackages({
    bool forceRefresh = false,
    http.Client? client,
  }) async {
    final now = DateTime.now();
    final cached = _cachedPackages;
    final loadedAt = _loadedAt;
    if (!forceRefresh &&
        cached != null &&
        loadedAt != null &&
        now.difference(loadedAt) < _freshFor) {
      return cached;
    }
    if (!forceRefresh && _inflight != null) return _inflight!;

    final request = _loadPackagesFromApi(client: client);
    _inflight = request;
    try {
      final items = await request;
      _cachedPackages = List<RechargePackageConfig>.unmodifiable(items);
      _loadedAt = DateTime.now();
      return _cachedPackages!;
    } catch (_) {
      if (cached != null &&
          loadedAt != null &&
          now.difference(loadedAt) < _staleFor) {
        return cached;
      }
      rethrow;
    } finally {
      if (identical(_inflight, request)) _inflight = null;
    }
  }

  static Future<List<RechargePackageConfig>> _loadPackagesFromApi({
    http.Client? client,
  }) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) {
      throw StateError('account_required');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');

    final ownedClient = client == null;
    final httpClient = client ?? http.Client();
    try {
      final response = await httpClient
          .post(
            Uri.parse('$_apiBase/recharge-config'),
            headers: <String, String>{
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode(<String, dynamic>{'action': 'packages'}),
          )
          .timeout(const Duration(seconds: 20));

      Map<String, dynamic> body = <String, dynamic>{};
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map) {
          body = Map<String, dynamic>.from(decoded);
        }
      } catch (_) {}

      if (response.statusCode != 200 || body['ok'] != true) {
        throw StateError((body['code'] ?? 'recharge_config_failed').toString());
      }
      return parsePackages(body['packages']);
    } finally {
      if (ownedClient) httpClient.close();
    }
  }

  static void clearCacheForTests() {
    _cachedPackages = null;
    _loadedAt = null;
    _inflight = null;
  }

}
