import 'dart:async';
import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:voice_chat_room/features/room/services/room_insights_service.dart';

void main() {
  test('room insights parses dated support periods', () {
    final insights = RoomInsights.fromJson({
      'roomId': 'room_1',
      'level': 5,
      'levelPoints': 18000,
      'levelTarget': 25000,
      'followerCount': 120,
      'followed': true,
      'favorited': false,
      'dailySupport': 12500,
      'weeklySupport': 88200,
      'monthlySupport': 304500,
      'activityScore': 900,
      'dailyRank': 3,
      'supporters': [
        {
          'uid': 'u1',
          'rank': 1,
          'displayName': 'A',
          'profileImageUrl': '',
          'profileAvatarAsset': 'assets/avatars/supporter.png',
          'totalSupport': 7000,
          'dailySupport': 7000,
          'publicId': '7777',
          'vipLevel': 4,
          'badges': ['verified', 'support_team'],
          'wealthLevel': 6,
          'attractionLevel': 8,
          'gameLevel': 3,
        },
        {
          'uid': 'u2',
          'rank': 2,
          'displayName': 'B',
          'profileImageUrl': '',
          'totalSupport': 5500,
          'dailySupport': 5500,
        },
      ],
      'ranking': [],
    });

    expect(insights.dailySupport, 12500);
    expect(insights.weeklySupport, 88200);
    expect(insights.monthlySupport, 304500);
    expect(insights.supporters.length, 2);
    expect(insights.supporters.first.rank, 1);
    expect(insights.supporters.first.dailySupport, 7000);
    expect(insights.supporters.first.publicId, '7777');
    expect(insights.supporters.first.profileAvatarAsset,
        'assets/avatars/supporter.png');
    expect(insights.supporters.first.vipLevel, 4);
    expect(insights.supporters.first.badges, ['verified', 'support_team']);
    expect(insights.supporters.first.wealthLevel, 6);
    expect(insights.supporters.first.attractionLevel, 8);
    expect(insights.supporters.first.gameLevel, 3);
  });

  test('room support periods default safely to zero', () {
    final insights = RoomInsights.fromJson({
      'roomId': 'room_2',
      'level': 1,
      'levelPoints': 0,
      'levelTarget': 1000,
      'supporters': [],
      'ranking': [],
    });

    expect(insights.dailySupport, 0);
    expect(insights.weeklySupport, 0);
    expect(insights.monthlySupport, 0);
  });

  test('room insights cached follow state is never shared across accounts', () async {
    final auth = _RoomTestAuth()..activeUser = _RoomTestUser('member-a');
    var requests = 0;
    final client = MockClient((request) async {
      requests++;
      final token = request.headers['authorization'];
      return http.Response(jsonEncode({
        'ok': true,
        'roomId': 'room-183',
        'followed': token == 'Bearer test-member-a',
        'favorited': token == 'Bearer test-member-a',
      }), 200);
    });
    final service = RoomInsightsService(
      auth: auth, client: client, baseUrl: 'https://example.invalid/api',
    );

    final a = await service.load('room-183');
    expect(a.followed, isTrue);
    expect(a.favorited, isTrue);
    await service.load('room-183');
    expect(requests, 1); // The same viewer still benefits from caching.

    auth.activeUser = _RoomTestUser('member-b');
    final b = await service.load('room-183');
    expect(b.followed, isFalse);
    expect(b.favorited, isFalse);
    expect(requests, 2); // A different viewer never receives A's cache.

    auth.activeUser = null;
    await expectLater(service.load('room-183'), throwsStateError);
    expect(requests, 2); // Signing out cannot return cached account data.
    service.close();
  });

  test('late prior-account response cannot overwrite current viewer cache', () async {
    final auth = _RoomTestAuth()..activeUser = _RoomTestUser('member-a');
    final started = Completer<void>();
    final oldReply = Completer<http.Response>();
    var callsB = 0;
    final client = MockClient((request) async {
      if (request.headers['authorization'] == 'Bearer test-member-a') {
        started.complete();
        return oldReply.future;
      }
      callsB++;
      return http.Response(jsonEncode({
        'ok': true, 'roomId': 'room-183', 'followed': false,
      }), 200);
    });
    final service = RoomInsightsService(
      auth: auth, client: client, baseUrl: 'https://example.invalid/api',
    );

    final earlier = service.load('room-183');
    await started.future;
    auth.activeUser = _RoomTestUser('member-b');
    final current = await service.load('room-183');
    expect(current.followed, isFalse);

    oldReply.complete(http.Response(jsonEncode({
      'ok': true, 'roomId': 'room-183', 'followed': true,
    }), 200));
    await expectLater(earlier, throwsStateError);
    final cachedB = await service.load('room-183');
    expect(cachedB.followed, isFalse);
    expect(callsB, 1); // Stale A did not replace or evict B's in-flight cache.
    service.close();
  });

}

class _RoomTestAuth extends Fake implements FirebaseAuth {
  User? activeUser;

  @override
  User? get currentUser => activeUser;
}

class _RoomTestUser extends Fake implements User {
  _RoomTestUser(this.uid);

  @override
  final String uid;

  @override
  Future<String> getIdToken([bool forceRefresh = false]) async => 'test-$uid';
}
