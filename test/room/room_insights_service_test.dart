import 'package:flutter_test/flutter_test.dart';
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
}
