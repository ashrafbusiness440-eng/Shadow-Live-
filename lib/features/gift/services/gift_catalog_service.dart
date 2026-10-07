import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

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
    this.minVipLevel = 0,
    this.isAnimated = false,
    this.effectMode = 'none',
    this.effectAssetKey = '',
    this.effectSoundAssetKey = '',
    this.effectMinQuantity = 0,
    this.effectDurationMs = 2200,
    this.effectSize = 0,
    this.premiumBannerMinQuantity = 0,
    this.affinityBasePoints = 0,
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
  final int minVipLevel;
  final bool isAnimated;
  final String effectMode;
  final String effectAssetKey;
  final String effectSoundAssetKey;
  final int effectMinQuantity;
  final int effectDurationMs;
  final int effectSize;
  final int premiumBannerMinQuantity;
  final int affinityBasePoints;

  bool get isRelationshipGift => category == 'cp' || category == 'friends';
  bool get hasRoomEffect =>
      effectMode == 'seat' || effectMode == 'cinematic';
  String get effectiveEffectAssetKey =>
      effectAssetKey.trim().isEmpty ? assetKey : effectAssetKey;

  int get effectiveMinVipLevel =>
      minVipLevel > 0 ? minVipLevel : (category == 'vip' ? 4 : 0);

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
      minVipLevel: (map['minVipLevel'] as num?)?.toInt() ??
          ((map['category'] ?? '').toString() == 'vip' ? 4 : 0),
      isAnimated: map['isAnimated'] == true,
      effectMode: (map['effectMode'] ?? 'none').toString(),
      effectAssetKey: (map['effectAssetKey'] ?? '').toString(),
      effectSoundAssetKey:
          (map['effectSoundAssetKey'] ?? '').toString(),
      effectMinQuantity:
          (map['effectMinQuantity'] as num?)?.toInt() ?? 0,
      effectDurationMs:
          (map['effectDurationMs'] as num?)?.toInt() ?? 2200,
      effectSize: (map['effectSize'] as num?)?.toInt() ?? 0,
      premiumBannerMinQuantity:
          (map['premiumBannerMinQuantity'] as num?)?.toInt() ?? 0,
      affinityBasePoints:
          (map['affinityBasePoints'] as num?)?.toInt() ?? 0,
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
        'minVipLevel': effectiveMinVipLevel,
        'isAnimated': isAnimated,
        'effectMode': effectMode,
        'effectAssetKey': effectiveEffectAssetKey,
        'effectSoundAssetKey': effectSoundAssetKey.trim(),
        'effectMinQuantity': effectMinQuantity,
        'effectDurationMs': effectDurationMs,
        'effectSize': effectSize,
        'premiumBannerMinQuantity': premiumBannerMinQuantity,
        'affinityBasePoints': affinityBasePoints,
      };
}

class GiftCatalogService {
  GiftCatalogService._();

  static const String _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );
  static const Duration _freshFor = Duration(seconds: 30);
  static const Duration _staleFor = Duration(minutes: 5);
  static List<GiftCatalogItem>? _cachedCatalog;
  static DateTime? _loadedAt;
  static Future<List<GiftCatalogItem>>? _inflight;
  static int? _cachedBalanceCoins;
  static Map<String, int> _cachedBagQuantities = <String, int>{};

  static int? get cachedBalanceCoins => _cachedBalanceCoins;
  static Map<String, int> get cachedBagQuantities =>
      Map<String, int>.unmodifiable(_cachedBagQuantities);

  static void updateCachedBalance(int value) {
    _cachedBalanceCoins = value < 0 ? 0 : value;
  }

  static void updateCachedBagQuantity(String giftId, int quantity) {
    final id = giftId.trim();
    if (id.isEmpty) return;
    final next = Map<String, int>.from(_cachedBagQuantities);
    if (quantity <= 0) {
      next.remove(id);
    } else {
      next[id] = quantity;
    }
    _cachedBagQuantities = next;
  }
  static const Set<String> categories = <String>{
    'general',
    'countries',
    'celebrities',
    'vip',
    'lucky',
    'activities',
    'cp',
    'friends',
  };

  static String categoryLabel(String category) => switch (category) {
        'general' => 'هدايا',
        'countries' => 'دول',
        'celebrities' => 'مشاهير',
        'vip' => 'امتياز',
        'lucky' => 'محظوظ',
        'activities' => 'أنشطة',
        'cp' => 'CP',
        'friends' => 'أصدقاء',
        _ => 'هدايا',
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

  static List<GiftCatalogItem> parseCatalog(dynamic raw) {
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
  }

  static Future<List<GiftCatalogItem>> loadCatalog({
    bool forceRefresh = false,
    http.Client? client,
  }) async {
    final now = DateTime.now();
    final cached = _cachedCatalog;
    final loadedAt = _loadedAt;
    if (!forceRefresh &&
        cached != null &&
        loadedAt != null &&
        now.difference(loadedAt) < _freshFor) {
      return cached;
    }

    if (!forceRefresh && _inflight != null) return _inflight!;

    final request = _loadCatalogFromApi(client: client);
    _inflight = request;
    try {
      final items = await request;
      _cachedCatalog = List<GiftCatalogItem>.unmodifiable(items);
      _loadedAt = DateTime.now();
      return _cachedCatalog!;
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

  static Future<List<GiftCatalogItem>> _loadCatalogFromApi({
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
            Uri.parse('$_apiBase/gift-catalog'),
            headers: <String, String>{
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode(<String, dynamic>{'action': 'catalog'}),
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
        throw StateError((body['code'] ?? 'gift_catalog_failed').toString());
      }
      final balance = (body['balance'] as num?)?.toInt();
      if (balance != null && balance >= 0) {
        _cachedBalanceCoins = balance;
      }
      final bag = <String, int>{};
      final rawBag = body['bag'];
      if (rawBag is List) {
        for (final raw in rawBag.whereType<Map>()) {
          final giftId = (raw['giftId'] ?? '').toString().trim();
          final quantity = (raw['quantity'] as num?)?.toInt() ?? 0;
          if (giftId.isNotEmpty && quantity > 0) {
            bag[giftId] = quantity;
          }
        }
      }
      _cachedBagQuantities = bag;
      return parseCatalog(body['gifts']);
    } finally {
      if (ownedClient) httpClient.close();
    }
  }

  static void clearCacheForTests() {
    _cachedCatalog = null;
    _loadedAt = null;
    _inflight = null;
    _cachedBalanceCoins = null;
    _cachedBagQuantities = <String, int>{};
  }

}
