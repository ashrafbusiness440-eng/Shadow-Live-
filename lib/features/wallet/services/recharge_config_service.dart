import 'package:cloud_firestore/cloud_firestore.dart';

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

  static final FirebaseFirestore _db = FirebaseFirestore.instance;
  static const int coinsPerUsd = 10000;

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

  static Stream<List<RechargePackageConfig>> watchPackages() {
    return _db.collection('system_config').doc('recharge').snapshots().map(
      (snapshot) {
        final data = snapshot.data();
        final raw = data?['packages'];
        if (raw is! List) return fallbackPackages;
        final items = raw
            .whereType<Map>()
            .map((item) => RechargePackageConfig.fromMap(
                  Map<String, dynamic>.from(item),
                ))
            .where((item) =>
                item.enabled &&
                item.id.isNotEmpty &&
                item.priceUsd > 0 &&
                item.totalCoins > 0)
            .toList()
          ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
        return items.isEmpty ? fallbackPackages : items;
      },
    );
  }
}
