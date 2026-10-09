import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

import 'package:voice_chat_room/features/room/services/room_bootstrap_service.dart';

void main() {
  test('Room bootstrap parses the full initial room snapshot', () {
    final snapshot = RoomBootstrapSnapshot.fromJson(
      <String, dynamic>{
        'serverNowMs': 123456,
        'room': <String, dynamic>{
          'roomId': 'room_1',
          'name': 'Shadow Room',
          'onlineCount': 12,
        },
        'ownerProfile': <String, dynamic>{
          'displayName': 'Owner',
          'profileImageUrl': 'https://example.test/owner.webp',
          'location': 'AE',
        },
        'seatState': <String, dynamic>{
          'roomId': 'room_1',
          'seats': <Map<String, dynamic>>[
            <String, dynamic>{
              'index': 0,
              'uid': 'u1',
              'displayName': 'User',
              'profileImageUrl': '',
              'muted': false,
            },
          ],
          'micInvites': <String>[],
          'micRequests': <String>[],
          'micInviteOnly': true,
          'starBattleActive': false,
          'isOwner': false,
          'isHost': false,
          'canManageMic': false,
          'isActive': true,
          'onlineCount': 12,
        },
        'moderatorState': <String, dynamic>{
          'roomId': 'room_1',
          'isOwner': false,
          'limit': 5,
          'myCapabilities': <String>['manageMic'],
          'moderators': <Map<String, dynamic>>[],
        },
        'insights': <String, dynamic>{
          'roomId': 'room_1',
          'level': 3,
          'levelPoints': 5000,
          'levelTarget': 10000,
          'followerCount': 50,
          'followed': true,
          'favorited': false,
          'dailySupport': 1200,
          'weeklySupport': 5000,
          'monthlySupport': 10000,
          'activityScore': 99,
          'dailyRank': 2,
          'supporters': <Map<String, dynamic>>[
            <String, dynamic>{
              'uid': 's1',
              'rank': 1,
              'displayName': 'Supporter',
              'profileImageUrl': '',
              'totalSupport': 1200,
              'dailySupport': 1200,
            },
          ],
          'ranking': <Map<String, dynamic>>[],
        },
        'rocketState': <String, dynamic>{
          'currentLevel': 2,
          'progressCoins': 25000,
          'levelThresholdCoins': 50000,
          'levelContributors': <String, dynamic>{},
        },
        'games': <String, dynamic>{
          'items': <Map<String, dynamic>>[
            <String, dynamic>{
              'key': 'greedy_cat',
              'gameId': 'greedy_cat',
              'mode': '',
              'label': 'القط الجشع',
              'targetRtpBps': 8500,
              'bets': <int>[200, 2000],
            },
          ],
        },
      },
    );

    expect(snapshot.room['roomId'], 'room_1');
    expect(snapshot.ownerProfile['displayName'], 'Owner');
    expect(snapshot.seatState.onlineCount, 12);
    expect(snapshot.seatState.seats.single.uid, 'u1');
    expect(snapshot.moderatorState.has('manageMic'), isTrue);
    expect(snapshot.insights.supporters.single.uid, 's1');
    expect(snapshot.rocketState.currentLevel, 2);
    expect(snapshot.games.single.key, 'greedy_cat');
    expect(snapshot.serverNowMs, 123456);
  });

  test('room bootstrap batches paid Star Battle scores for seated users', () {
    final voiceSource =
        File('cloudflare-worker/src/voice-session-legacy.js').readAsStringSync();
    expect(
      voiceSource.contains(
        '.orderBy("coins","desc").limit(99).get();',
      ),
      isTrue,
    );
    expect(
      voiceSource.contains('const scoreRaw=battle?.scores?.[seat.uid];'),
      isFalse,
    );

    final snapshot = RoomBootstrapSnapshot.fromJson(<String, dynamic>{
      'seatState': <String, dynamic>{
        'roomId': 'room_star_test',
        'starBattleActive': true,
        'seats': <Map<String, dynamic>>[
          <String, dynamic>{
            'index': 0,
            'uid': 'speaker_1',
            'starBattleCoins': 1250,
          },
        ],
      },
    });
    expect(
      voiceSource.contains('scores:starScoreByUid,'),
      isTrue,
    );
    expect(
      voiceSource.contains('const seats=normalizedSeats.map((seat)=>({'),
      isTrue,
    );
    expect(snapshot.seatState.starBattleActive, isTrue);
    expect(snapshot.seatState.seats.single.starBattleCoins, 1250);
  });

}
