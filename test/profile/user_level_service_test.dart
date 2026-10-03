import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/user_level_service.dart';

void main() {
  test('user level summary parses authoritative server values', () {
    final summary = UserLevelSummary.fromJson({
      'uid': 'user_1',
      'policyVersion': 1,
      'wealth': {
        'level': 12,
        'maxLevel': 35,
        'points': 7000000,
        'minimumThreshold': 6750000,
        'nextThreshold': 10000000,
        'remaining': 3000000,
        'progressBps': 769,
      },
      'attraction': {
        'level': 5,
        'maxLevel': 35,
        'points': 150000,
        'minimumThreshold': 100000,
        'nextThreshold': 200000,
        'remaining': 50000,
        'progressBps': 5000,
      },
      'games': {
        'level': 1,
        'maxLevel': 21,
        'points': 810000,
        'minimumThreshold': 200000,
        'nextThreshold': 1000000,
        'remaining': 190000,
        'progressBps': 7625,
        'storedPoints': 1000000,
        'pendingDecayPoints': 190000,
        'pendingDecayDays': 2,
        'lastGameActivityAtMs': 1791028800000,
      },
    });

    expect(summary.uid, 'user_1');
    expect(summary.wealth.level, 12);
    expect(summary.wealth.remaining, 3000000);
    expect(summary.attraction.progressBps, 5000);
    expect(summary.games.points, 810000);
    expect(summary.games.storedPoints, 1000000);
    expect(summary.games.pendingDecayPoints, 190000);
    expect(summary.games.pendingDecayDays, 2);
  });

  test('level progress basis points are clamped defensively', () {
    final high = UserLevelSectionSummary.fromJson({
      'level': 2,
      'maxLevel': 35,
      'points': 10000,
      'minimumThreshold': 10000,
      'nextThreshold': 25000,
      'remaining': 15000,
      'progressBps': 50000,
    });
    final low = UserLevelSectionSummary.fromJson({
      'level': 1,
      'maxLevel': 35,
      'points': 0,
      'minimumThreshold': 0,
      'nextThreshold': 10000,
      'remaining': 10000,
      'progressBps': -10,
    });

    expect(high.progressBps, 10000);
    expect(low.progressBps, 0);
  });
}
