import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/store/services/store_visual_presentation_service.dart';
import 'package:voice_chat_room/features/profile/widgets/store_verified_profile_card_backdrop.dart';
import 'package:flutter/widgets.dart';

void main() {
  const key = 'store.item.200006.visual';

  test('profile card reads only verified profile projection', () async {
    final expires = DateTime.now().millisecondsSinceEpoch + 60000;
    var requests = 0;
    final service = StoreVisualPresentationService(
      baseUrl: 'https://example.test/api',
      tokenProvider: () async => 'viewer-token',
      client: MockClient((request) async {
        requests++;
        expect(request.url.path, '/api/store-presentation');
        expect(request.url.queryParameters['uid'], 'profile-owner');
        expect(request.headers['authorization'], 'Bearer viewer-token');
        return http.Response(jsonEncode({
          'ok': true, 'visuals': {
            'profileCards': {
              'assetKey': key,
              'imageUrl': 'https://example.test/visual.webp',
              'expiresAtMs': expires,
            },
          },
        }), 200);
      }),
    );
    final card = await service.loadProfileCard('profile-owner');
    expect(requests, 1);
    expect(card?.assetKey, key);
    expect(card?.activeNow, true);
    service.close();
  });

  test('expired or forged card, failed API and missing auth show fallback', () async {
    final cases = <Map<String, Object?>>[
      {
        'assetKey': key,
        'imageUrl': 'https://example.test/visual.webp',
        'expiresAtMs': DateTime.now().millisecondsSinceEpoch - 1000,
      },
      {
        'assetKey': 'store.item.200006.icon',
        'imageUrl': 'https://example.test/icon.webp',
        'expiresAtMs': null,
      },
      {
        'assetKey': key,
        'imageUrl': 'http://example.test/visual.webp',
        'expiresAtMs': null,
      },
    ];
    for (final visual in cases) {
      final service = StoreVisualPresentationService(
        tokenProvider: () async => 'token',
        client: MockClient((_) async => http.Response(
          jsonEncode({'ok': true, 'visuals': {'profileCards': visual}}),
          200,
        )),
      );
      expect(await service.loadProfileCard('some-user'), isNull);
      service.close();
    }
    final denied = StoreVisualPresentationService(
      tokenProvider: () async => null,
      client: MockClient((_) async => throw StateError('must not request')),
    );
    expect(await denied.loadProfileCard('some-user'), isNull);
    denied.close();
    final networkFailed = StoreVisualPresentationService(
      tokenProvider: () async => 'token',
      client: MockClient((_) async => http.Response('unavailable', 503)),
    );
    expect(await networkFailed.loadProfileCard('some-user'), isNull);
    networkFailed.close();
  });

  test('existing frame projection stays distinct from profile cards', () async {
    final service = StoreVisualPresentationService(
      tokenProvider: () async => 'token',
      client: MockClient((_) async => http.Response(jsonEncode({
        'ok': true, 'visuals': {
          'profileCards': {
            'assetKey': key, 'imageUrl': 'https://example.test/p.webp',
            'expiresAtMs': null,
          },
        },
      }), 200)),
    );
    expect(await service.loadFrame('some-user'), isNull);
    service.close();
    const widget = StoreVerifiedProfileCardBackdrop(
      userId: 'some-user', child: SizedBox.shrink(),
    );
    expect(widget.userId, 'some-user');
  });
}
