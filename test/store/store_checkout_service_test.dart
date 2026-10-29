import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/store/services/store_checkout_service.dart';

void main() {
  test('Store checkout sends buyer consent and validates atomic server receipt',
      () async {
    var calls = 0;
    final service = StoreCheckoutService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'valid-buyer-token',
      client: MockClient((request) async {
        calls++;
        expect(request.method, 'POST');
        expect(request.url.path, '/api/store-purchase');
        expect(request.headers['authorization'], 'Bearer valid-buyer-token');
        final body = jsonDecode(request.body) as Map<String, dynamic>;
        expect(body['action'], 'purchase');
        expect(body['confirmation'], 'confirmed');
        expect(body['productId'], '200001');
        expect(body['operationId'], 'purchase_123456789012345678901234');
        expect(body['expectedPriceCoins'], 25000);
        expect(body['expectedDurationDays'], 7);
        expect(body.containsKey('buyerUid'), isFalse);
        expect(body.containsKey('walletBalance'), isFalse);
        return http.Response(jsonEncode({
          'ok': true, 'operationId': body['operationId'],
          'productId': body['productId'], 'priceCoins': 25000,
          'durationDays': 7, 'deliveryStatus': 'delivered',
          'duplicate': calls > 1,
        }), 200);
      }),
    );
    for (var i = 0; i < 2; i++) {
      final result = await service.purchase(
        productId: '200001',
        operationId: 'purchase_123456789012345678901234',
        expectedPriceCoins: 25000,
        expectedDurationDays: 7,
      );
      expect(result['deliveryStatus'], 'delivered');
      expect(result['duplicate'], i == 1);
    }
    expect(calls, 2);
    service.close();
  });

  test('checkout fails closed for stale quote, invalid receipt and no login',
      () async {
    final stale = StoreCheckoutService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'buyer',
      client: MockClient((_) async => http.Response(jsonEncode({
        'ok': false, 'code': 'store_purchase_quote_changed',
      }), 409)),
    );
    await expectLater(stale.purchase(
      productId: '200001',
      operationId: 'purchase_123456789012345678901234',
      expectedPriceCoins: 25000,
      expectedDurationDays: 7,
    ), throwsStateError);
    stale.close();

    final forged = StoreCheckoutService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'buyer',
      client: MockClient((_) async => http.Response(jsonEncode({
        'ok': true, 'productId': '200001',
        'operationId': 'purchase_123456789012345678901234',
        'priceCoins': 26000, 'durationDays': 7,
        'deliveryStatus': 'delivered',
      }), 200)),
    );
    await expectLater(forged.purchase(
      productId: '200001',
      operationId: 'purchase_123456789012345678901234',
      expectedPriceCoins: 25000,
      expectedDurationDays: 7,
    ), throwsStateError);
    forged.close();

    final unauth = StoreCheckoutService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => null,
      client: MockClient((_) async => throw StateError('request_unexpected')),
    );
    await expectLater(unauth.purchase(
      productId: '200001',
      operationId: 'purchase_123456789012345678901234',
      expectedPriceCoins: 25000,
      expectedDurationDays: 7,
    ), throwsStateError);
    unauth.close();
  });

  test('checkout rejects malformed operation and non-positive approved quote',
      () async {
    final service = StoreCheckoutService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'token',
      client: MockClient((_) async => throw StateError('request_unexpected')),
    );
    for (final operationId in ['invalid', '../unsafe', 'a b']) {
      await expectLater(service.purchase(
        productId: '200001', operationId: operationId,
        expectedPriceCoins: 25000, expectedDurationDays: 7,
      ), throwsStateError);
    }
    await expectLater(service.purchase(
      productId: '200001',
      operationId: 'purchase_123456789012345678901234',
      expectedPriceCoins: 0,
      expectedDurationDays: 7,
    ), throwsStateError);
    service.close();
  });
}
