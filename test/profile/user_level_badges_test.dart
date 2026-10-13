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
  testWidgets('embedded room levels render without a summary request', (tester) async {
    final taps = <int>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UserLevelBadges.fromLevels(
            wealthLevel: 7,
            attractionLevel: 0,
            gameLevel: 5,
            micro: true,
            onTap: taps.add,
          ),
        ),
      ),
    );

    expect(find.text('LV7'), findsOneWidget);
    expect(find.text('LV5'), findsOneWidget);
    expect(find.text('الثروة LV7'), findsNothing);

    await tester.tap(find.byKey(const Key('level-badge-0')));
    await tester.tap(find.byKey(const Key('level-badge-2')));
    expect(taps, [0, 2]);
  });

  testWidgets('profile level badge labels and touch targets remain usable', (tester) async {
    for (final compact in <bool>[false, true]) {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: UserLevelBadges.fromLevels(
              wealthLevel: 7,
              attractionLevel: 3,
              gameLevel: 5,
              compact: compact,
              onTap: (_) {},
            ),
          ),
        ),
      );

      for (final index in <int>[0, 1, 2]) {
        expect(
          tester.getSize(find.byKey(Key('level-badge-$index'))).height,
          greaterThanOrEqualTo(44),
        );
      }
      final wealthText = tester.widget<Text>(find.text('الثروة LV7'));
      expect(wealthText.semanticsLabel, 'الثروة، المستوى 7');
    }

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UserLevelBadges.fromLevels(
            wealthLevel: 7,
            attractionLevel: 0,
            gameLevel: 5,
            micro: true,
            onTap: (_) {},
          ),
        ),
      ),
    );
    expect(
      tester.widget<Text>(find.text('LV7')).semanticsLabel,
      'الثروة، المستوى 7',
    );
    expect(
      tester.getSize(find.byKey(const Key('level-badge-0'))).height,
      lessThan(44),
    );
  });

  testWidgets('profile header uses transparent icon-and-number indicators at phone widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 700));
      final taps = <int>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: UserLevelBadges.fromLevels(
                wealthLevel: 7,
                attractionLevel: 3,
                gameLevel: 5,
                iconOnly: true,
                onTap: taps.add,
              ),
            ),
          ),
        ),
      );

      expect(find.text('7'), findsOneWidget);
      expect(find.text('3'), findsOneWidget);
      expect(find.text('5'), findsOneWidget);
      expect(find.textContaining('LV'), findsNothing);
      expect(find.textContaining('الثروة'), findsNothing);
      expect(find.textContaining('الجاذبية'), findsNothing);
      expect(tester.widget<Text>(find.text('7')).semanticsLabel,
          'الثروة، المستوى 7');
      for (final index in <int>[0, 1, 2]) {
        final key = find.byKey(Key('level-badge-$index'));
        expect(tester.getSize(key).height, greaterThanOrEqualTo(44));
      }
      final wealthMaterial = tester.widget<Material>(
        find.ancestor(
          of: find.byKey(const Key('level-badge-0')),
          matching: find.byType(Material),
        ).first,
      );
      expect(wealthMaterial.color, Colors.transparent);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('level-badge-0')));
      await tester.tap(find.byKey(const Key('level-badge-1')));
      expect(taps, [0, 1]);
    }
  });

  testWidgets('profile indicators omit unavailable levels without placeholder',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: UserLevelBadges.fromLevels(
            wealthLevel: 0,
            attractionLevel: 4,
            gameLevel: 0,
            iconOnly: true,
            onTap: (_) {},
          ),
        ),
      ),
    );
    expect(find.byKey(const Key('level-badge-0')), findsNothing);
    expect(find.byKey(const Key('level-badge-1')), findsOneWidget);
    expect(find.byKey(const Key('level-badge-2')), findsNothing);
    expect(find.text('4'), findsOneWidget);
  });

}
