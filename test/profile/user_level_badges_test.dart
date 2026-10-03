import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/user_level_service.dart';
import 'package:voice_chat_room/features/profile/widgets/user_level_badges.dart';

void main() {
  const summary = UserLevelSummary(
    uid: 'public_user',
    policyVersion: 1,
    wealth: UserLevelSectionSummary(
      level: 6,
      maxLevel: 35,
      points: 300000,
      minimumThreshold: 300000,
      nextThreshold: 500000,
      remaining: 200000,
      progressBps: 0,
    ),
    attraction: UserLevelSectionSummary(
      level: 0,
      maxLevel: 35,
      points: 0,
      minimumThreshold: 0,
      nextThreshold: 10000,
      remaining: 10000,
      progressBps: 0,
    ),
    games: UserGameLevelSummary(
      level: 4,
      maxLevel: 21,
      points: 9620000,
      minimumThreshold: 9620000,
      nextThreshold: 18000000,
      remaining: 8380000,
      progressBps: 0,
      storedPoints: 9620000,
      pendingDecayPoints: 0,
      pendingDecayDays: 0,
      lastGameActivityAtMs: null,
    ),
  );

  testWidgets('public level badges show only earned levels and navigate by tab', (tester) async {
    final taps = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UserLevelBadges(
            summary: summary,
            onTap: taps.add,
          ),
        ),
      ),
    );

    expect(find.text('الثروة LV6'), findsOneWidget);
    expect(find.text('الجاذبية LV0'), findsNothing);
    expect(find.text('الألعاب LV4'), findsOneWidget);

    await tester.tap(find.byKey(const Key('level-badge-0')));
    await tester.tap(find.byKey(const Key('level-badge-2')));
    expect(taps, [0, 2]);
  });
}
