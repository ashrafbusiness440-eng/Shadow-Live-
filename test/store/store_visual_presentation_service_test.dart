import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/store/services/store_visual_presentation_service.dart';

void main() {
  test('profile visual uses authenticated verified endpoint', () async {
    final service = StoreVisualPresentationService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => 'test-token',
      client: MockClient((request) async {
        expect(request.method, 'GET');
        expect(request.url.path, '/api/store-presentation');
        expect(request.url.queryParameters['uid'], 'owner_one');
        expect(request.headers['authorization'], 'Bearer test-token');
        return http.Response(jsonEncode({
          'ok': true,
          'visuals': {
            'frames': {
              'assetKey': 'store.item.200001.visual',
              'imageUrl': 'https://cdn.example.com/frame.webp',
              'productId': '200001',
              'expiresAtMs': null,
            },
          },
        }), 200);
      }),
    );
    final frame = await service.loadFrame('owner_one');
    expect(frame?.assetKey, 'store.item.200001.visual');
    expect(frame?.imageUrl, 'https://cdn.example.com/frame.webp');
    expect(frame?.activeNow, true);
    service.close();
  });

  test('invalid or expired Store frame never overrides legacy presentation', () async {
    for (final raw in <Map<String, Object?>>[
      {
        'assetKey': 'store.item.200001.icon',
        'imageUrl': 'https://cdn.example.com/icon.webp',
        'expiresAtMs': null,
      },
      {
        'assetKey': 'store.item.200001.visual',
        'imageUrl': 'http://unsafe.example.com/frame.webp',
        'expiresAtMs': null,
      },
      {
        'assetKey': 'store.item.200001.visual',
        'imageUrl': 'https://cdn.example.com/frame.webp',
        'expiresAtMs': 0,
      },
    ]) {
      final service = StoreVisualPresentationService(
        baseUrl: 'https://example.com/api',
        tokenProvider: () async => 'test-token',
        client: MockClient((request) async =>
          http.Response(jsonEncode({
            'ok': true, 'visuals': {'frames': raw},
          }), 200)),
      );
      expect(await service.loadFrame('owner_one'), null);
      service.close();
    }
  });

  test('missing session or failure produces safe legacy fallback', () async {
    final service = StoreVisualPresentationService(
      baseUrl: 'https://example.com/api',
      tokenProvider: () async => null,
      client: MockClient((request) async => http.Response('{}', 500)),
    );
    expect(await service.loadFrame('owner_one'), null);
    service.close();
  });
}
