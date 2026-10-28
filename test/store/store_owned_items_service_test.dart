import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/store/services/store_owned_items_service.dart';

void main() {
  test('store ownership is authenticated and displays only safe fields', () async {
    final service = StoreOwnedItemsService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'valid-test-token',
      client: MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/my-store-items');
        expect(request.headers['authorization'], 'Bearer valid-test-token');
        return http.Response(jsonEncode({
          'ok': true,
          'purchasingEnabled': false,
          'moreMayExist': false,
          'items': [{
            'productId': '200001',
            'nameAr': 'إطار ملكي',
            'assetKey': 'store.item.200001.icon',
            'category': 'frames',
            'source': 'purchase',
            'acquiredAtMs': 1000,
            'expiresAtMs': 50000,
            'active': true,
            'expired': false,
            'privateAuditUid': 'never_present',
          }],
        }), 200, headers: const {
          'content-type': 'application/json; charset=utf-8',
        });
      }),
    );
    final result = await service.load();
    expect(result.items.single.productId, '200001');
    expect(result.items.single.source, 'purchase');
    expect(result.items.single.expiresAtMs, 50000);
    expect(result.moreMayExist, false);
    service.close();
  });

  test('store ownership rejects missing login and tampered asset key', () async {
    final noAuth = StoreOwnedItemsService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => null,
      client: MockClient((request) async =>
        http.Response('{}', 200)),
    );
    await expectLater(noAuth.load(), throwsStateError);
    noAuth.close();
    expect(() => StoreOwnedItem.fromJson({
      'productId': '200001',
      'nameAr': 'إطار',
      'assetKey': 'store.item.200002.icon',
      'category': 'frames',
      'source': 'purchase',
      'acquiredAtMs': 1000,
      'expiresAtMs': null,
      'active': true,
      'expired': false,
    }), throwsFormatException);
  });

  test('store ownership rejects response that enables purchasing', () async {
    final service = StoreOwnedItemsService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'token',
      client: MockClient((request) async =>
        http.Response(jsonEncode({
          'ok': true, 'purchasingEnabled': true,
          'items': [], 'moreMayExist': false,
        }), 200)),
    );
    await expectLater(service.load(), throwsFormatException);
    service.close();
  });
}
