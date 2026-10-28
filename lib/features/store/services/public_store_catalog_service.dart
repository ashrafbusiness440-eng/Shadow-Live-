import 'dart:convert';

import 'package:http/http.dart' as http;

class PublicStoreItem {
  const PublicStoreItem({
    required this.id,
    required this.nameAr,
    required this.category,
    required this.priceCoins,
    required this.durationDays,
    required this.rarity,
    required this.minVipLevel,
    required this.assetKey,
  });

  final String id;
  final String nameAr;
  final String category;
  final int priceCoins;
  final int durationDays;
  final String rarity;
  final int minVipLevel;
  final String assetKey;

  factory PublicStoreItem.fromJson(Map<String, dynamic> value) {
    final id = value['id']?.toString() ?? '';
    final assetKey = value['assetKey']?.toString() ?? '';
    if (!RegExp(r'^[1-9][0-9]{5,8}$').hasMatch(id) ||
        assetKey != 'store.item.$id.icon') {
      throw const FormatException('invalid_public_store_item');
    }
    return PublicStoreItem(
      id: id,
      nameAr: value['nameAr']?.toString() ?? '',
      category: value['category']?.toString() ?? '',
      priceCoins: (value['priceCoins'] as num).toInt(),
      durationDays: (value['durationDays'] as num).toInt(),
      rarity: value['rarity']?.toString() ?? '',
      minVipLevel: (value['minVipLevel'] as num).toInt(),
      assetKey: assetKey,
    );
  }
}

class PublicStoreCatalog {
  const PublicStoreCatalog({required this.items, required this.categories});

  final List<PublicStoreItem> items;
  final Map<String, String> categories;
}

class PublicStoreCatalogService {
  PublicStoreCatalogService({http.Client? client, String? apiBase})
      : _client = client ?? http.Client(),
        _base = apiBase ?? const String.fromEnvironment(
          'SHADOW_CLOUDFLARE_API_BASE_URL',
          defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
        );

  final http.Client _client;
  final String _base;

  Future<PublicStoreCatalog> load() async {
    final response = await _client.get(Uri.parse('${_base.replaceFirst(RegExp(r"/+$"), "")}/store-catalog'))
        .timeout(const Duration(seconds: 20));
    if (response.statusCode != 200) {
      throw StateError('store_catalog_unavailable');
    }
    final decoded = jsonDecode(response.body);
    if (decoded is! Map || decoded['ok'] != true ||
        decoded['purchasingEnabled'] != false ||
        decoded['items'] is! List || decoded['categories'] is! Map) {
      throw const FormatException('invalid_public_store_catalog');
    }
    final items = (decoded['items'] as List)
        .whereType<Map>()
        .map((value) => PublicStoreItem.fromJson(
            Map<String, dynamic>.from(value)))
        .toList(growable: false);
    if (items.length > 100) {
      throw const FormatException('invalid_public_store_catalog');
    }
    final categories = (decoded['categories'] as Map).map(
      (key, value) => MapEntry(key.toString(), value.toString()),
    );
    return PublicStoreCatalog(items: items, categories: categories);
  }

  void close() => _client.close();
}
