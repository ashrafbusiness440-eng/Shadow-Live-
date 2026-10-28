import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/store/services/public_store_catalog_service.dart';

void main() {
  test('public store parses only a read-only catalog with stable asset key',
      () async {
    final service = PublicStoreCatalogService(
      apiBase: 'https://example.com/api',
      client: MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/store-catalog');
        return http.Response(jsonEncode({
          'ok': true,
          'purchasingEnabled': false,
          'categories': {'frames': 'الإطارات'},
          'items': [{
            'id': '200001',
            'nameAr': 'إطار ملكي',
            'category': 'frames',
            'priceCoins': 1200,
            'durationDays': 7,
            'rarity': 'rare',
            'minVipLevel': 0,
            'assetKey': 'store.item.200001.icon',
          }],
        }), 200);
      }),
    );
    final catalog = await service.load();
    expect(catalog.items.single.id, '200001');
    expect(catalog.items.single.priceCoins, 1200);
    expect(catalog.categories['frames'], 'الإطارات');
    service.close();
  });

  test('public store rejects purchase activation from response', () async {
    final service = PublicStoreCatalogService(
      apiBase: 'https://example.com/api',
      client: MockClient((request) async =>
        http.Response(jsonEncode({
          'ok': true, 'purchasingEnabled': true,
          'categories': {}, 'items': [],
        }), 200)),
    );
    await expectLater(service.load(), throwsFormatException);
    service.close();
  });

  test('public store rejects altered image identity', () {
    expect(
      () => PublicStoreItem.fromJson({
        'id': '200001',
        'nameAr': 'اسم',
        'category': 'frames',
        'priceCoins': 20,
        'durationDays': 7,
        'rarity': 'normal',
        'minVipLevel': 0,
        'assetKey': 'store.item.200002.icon',
      }),
      throwsFormatException,
    );
  });
}
