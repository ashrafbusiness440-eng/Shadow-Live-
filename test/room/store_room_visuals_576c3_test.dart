import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/store/services/store_visual_presentation_service.dart';

void main() {
  test('both equipped room visuals use one owner-scoped authenticated request', () async {
    var requests = 0;
    final end = DateTime.now().millisecondsSinceEpoch + 60000;
    final service = StoreVisualPresentationService(
      baseUrl: 'https://example.test/api',
      tokenProvider: () async => 'viewer-token',
      client: MockClient((request) async {
        requests++;
        expect(request.url.path, '/api/store-presentation');
        expect(request.url.queryParameters['uid'], 'room-owner');
        expect(request.headers['authorization'], 'Bearer viewer-token');
        return http.Response(jsonEncode({
          'ok': true,
          'visuals': {
            'roomFrames': {
              'assetKey': 'store.item.200008.visual',
              'imageUrl': 'https://example.test/room-frame.webp',
              'expiresAtMs': end,
            },
            'backgrounds': {
              'assetKey': 'store.item.200009.visual',
              'imageUrl': 'https://example.test/room-bg.webp',
              'expiresAtMs': null,
            },
          },
        }), 200);
      }),
    );
    final visuals = await service.loadRoomDecorations('room-owner');
    expect(requests, 1);
    expect(visuals.keys, containsAll(['roomFrames', 'backgrounds']));
    expect(visuals['roomFrames']?.activeNow, isTrue);
    expect(visuals['backgrounds']?.activeNow, isTrue);
    service.close();
  });

  test('expired and forged room visuals are rejected independently', () async {
    final past = DateTime.now().millisecondsSinceEpoch - 1000;
    final service = StoreVisualPresentationService(
      tokenProvider: () async => 'viewer-token',
      client: MockClient((_) async => http.Response(jsonEncode({
        'ok': true,
        'visuals': {
          'roomFrames': {
            'assetKey': 'store.item.200008.icon',
            'imageUrl': 'https://example.test/fake.webp',
            'expiresAtMs': null,
          },
          'backgrounds': {
            'assetKey': 'store.item.200009.visual',
            'imageUrl': 'https://example.test/expired.webp',
            'expiresAtMs': past,
          },
        },
      }), 200)),
    );
    expect(await service.loadRoomDecorations('room-owner'), isEmpty);
    service.close();
  });

  test('network or authorization failure leaves both legacy room visuals', () async {
    final denied = StoreVisualPresentationService(
      tokenProvider: () async => null,
      client: MockClient((_) async => throw StateError('no request allowed')),
    );
    expect(await denied.loadRoomDecorations('room-owner'), isEmpty);
    denied.close();
    final failed = StoreVisualPresentationService(
      tokenProvider: () async => 'viewer-token',
      client: MockClient((_) async => http.Response('unavailable', 503)),
    );
    expect(await failed.loadRoomDecorations('room-owner'), isEmpty);
    failed.close();
  });
}
