import 'package:cloud_firestore/cloud_firestore.dart';

class GiftCatalogItem {
  const GiftCatalogItem({
    required this.id,
    required this.nameAr,
    required this.priceCoins,
    required this.category,
    required this.enabled,
    required this.featured,
    required this.sortOrder,
    required this.assetKey,
    required this.localPlaceholder,
  });

  final String id;
  final String nameAr;
  final int priceCoins;
  final String category;
  final bool enabled;
  final bool featured;
  final int sortOrder;
  final String assetKey;
  final String localPlaceholder;

  factory GiftCatalogItem.fromMap(Map<String, dynamic> map) {
    return GiftCatalogItem(
      id: (map['id'] ?? '').toString(),
      nameAr: (map['nameAr'] ?? '').toString(),
      priceCoins: (map['priceCoins'] as num?)?.toInt() ?? 0,
      category: (map['category'] ?? 'general').toString(),
      enabled: map['enabled'] != false,
      featured: map['featured'] == true,
      sortOrder: (map['sortOrder'] as num?)?.toInt() ?? 0,
      assetKey: (map['assetKey'] ?? 'gifts.placeholder.default').toString(),
      localPlaceholder: (map['localPlaceholder'] ??
              'assets/images/gifts/gift_placeholder.webp')
          .toString(),
    );
  }

  Map<String, dynamic> toMap() => {
        'id': id,
        'nameAr': nameAr,
        'priceCoins': priceCoins,
        'category': category,
        'enabled': enabled,
        'featured': featured,
        'sortOrder': sortOrder,
        'assetKey': assetKey,
        'localPlaceholder': localPlaceholder,
      };
}

class GiftCatalogService {
  GiftCatalogService._();

  static final FirebaseFirestore _db = FirebaseFirestore.instance;
  static const Set<String> categories = <String>{
    'general',
    'countries',
    'celebrities',
    'vip',
    'lucky',
    'activities',
  };

  static const List<GiftCatalogItem> fallbackGifts = <GiftCatalogItem>[
    GiftCatalogItem(
      id: 'rose',
      nameAr: 'وردة',
      priceCoins: 100,
      category: 'general',
      enabled: true,
      featured: false,
      sortOrder: 0,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'coffee',
      nameAr: 'قهوة',
      priceCoins: 300,
      category: 'general',
      enabled: true,
      featured: false,
      sortOrder: 1,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'heart',
      nameAr: 'قلب',
      priceCoins: 500,
      category: 'general',
      enabled: true,
      featured: true,
      sortOrder: 2,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'chocolate',
      nameAr: 'شوكولا',
      priceCoins: 1000,
      category: 'general',
      enabled: true,
      featured: false,
      sortOrder: 3,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'crown',
      nameAr: 'تاج',
      priceCoins: 2500,
      category: 'vip',
      enabled: true,
      featured: true,
      sortOrder: 4,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'ring',
      nameAr: 'خاتم ألماس',
      priceCoins: 5000,
      category: 'vip',
      enabled: true,
      featured: false,
      sortOrder: 5,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'sports_car',
      nameAr: 'سيارة رياضية',
      priceCoins: 10000,
      category: 'vip',
      enabled: true,
      featured: true,
      sortOrder: 6,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'yacht',
      nameAr: 'يخت فاخر',
      priceCoins: 25000,
      category: 'vip',
      enabled: true,
      featured: false,
      sortOrder: 7,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'private_jet',
      nameAr: 'طائرة خاصة',
      priceCoins: 50000,
      category: 'vip',
      enabled: true,
      featured: true,
      sortOrder: 8,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'castle',
      nameAr: 'قصر ملكي',
      priceCoins: 100000,
      category: 'vip',
      enabled: true,
      featured: true,
      sortOrder: 9,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'golden_dragon',
      nameAr: 'التنين الذهبي',
      priceCoins: 250000,
      category: 'vip',
      enabled: true,
      featured: true,
      sortOrder: 10,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
    GiftCatalogItem(
      id: 'galaxy',
      nameAr: 'مجرة شادو',
      priceCoins: 500000,
      category: 'vip',
      enabled: true,
      featured: true,
      sortOrder: 11,
      assetKey: 'gifts.placeholder.default',
      localPlaceholder: 'assets/images/gifts/gift_placeholder.webp',
    ),
  ];

  static Stream<List<GiftCatalogItem>> watchCatalog() {
    return _db.collection('system_config').doc('gift_catalog').snapshots().map(
      (snapshot) {
        final raw = snapshot.data()?['gifts'];
        if (raw is! List) return fallbackGifts;
        final items = raw
            .whereType<Map>()
            .map(
              (item) => GiftCatalogItem.fromMap(
                Map<String, dynamic>.from(item),
              ),
            )
            .where(
              (item) =>
                  item.enabled &&
                  item.id.isNotEmpty &&
                  item.nameAr.isNotEmpty &&
                  item.priceCoins > 0 &&
                  categories.contains(item.category),
            )
            .toList()
          ..sort((a, b) => a.sortOrder.compareTo(b.sortOrder));
        return items.isEmpty ? fallbackGifts : items;
      },
    );
  }
}
