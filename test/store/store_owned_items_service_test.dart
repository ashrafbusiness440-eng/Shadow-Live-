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

  test('store equipment uses authenticated POST and checks response', () async {
    final calls = <String>[];
    final service = StoreOwnedItemsService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'token',
      client: MockClient((request) async {
        expect(request.method, 'POST');
        expect(request.url.path, '/api/store-equip');
        expect(request.headers['authorization'], 'Bearer token');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        calls.add(body['action'] as String);
        if (body['action'] == 'equip') {
          expect(body['productId'], '200001');
          expect(body.containsKey('ownerUid'), false);
        } else {
          expect(body['category'], 'frames');
          expect(body.containsKey('productId'), false);
        }
        return http.Response(jsonEncode({
          'ok': true, 'changed': true, 'category': 'frames',
          'productId': body['action'] == 'equip' ? '200001' : null,
        }), 200);
      }),
    );
    const item = StoreOwnedItem(
      productId: '200001', nameAr: 'إطار', assetKey: 'store.item.200001.icon',
      category: 'frames', source: 'purchase', acquiredAtMs: 1000,
      expiresAtMs: null, active: true, expired: false,
      lifecycleState: 'active',
    );
    await service.setEquipped(item, equipped: true);
    await service.setEquipped(item, equipped: false);
    expect(calls, ['equip', 'unequip']);
    service.close();
  });

  test('expired items cannot be equipped and forged success fails', () async {
    const expired = StoreOwnedItem(
      productId: '200001', nameAr: 'إطار', assetKey: 'store.item.200001.icon',
      category: 'frames', source: 'purchase', acquiredAtMs: 1000,
      expiresAtMs: 2000, active: false, expired: true,
      lifecycleState: 'expired',
    );
    final service = StoreOwnedItemsService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'token',
      client: MockClient((request) async => http.Response(jsonEncode({
        'ok': true, 'changed': true, 'category': 'frames',
        'productId': '200002',
      }), 200)),
    );
    await expectLater(service.setEquipped(expired, equipped: true),
      throwsStateError);
    final active = StoreOwnedItem.fromJson({
      'productId': '200001', 'nameAr': 'إطار',
      'assetKey': 'store.item.200001.icon', 'category': 'frames',
      'source': 'purchase', 'acquiredAtMs': 1000,
      'expiresAtMs': null, 'active': true, 'expired': false,
      'equipped': true,
    });
    expect(active.equipped, true);
    await expectLater(service.setEquipped(active, equipped: true),
      throwsFormatException);
    service.close();
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
