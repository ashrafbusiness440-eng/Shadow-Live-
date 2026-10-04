import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/screens/user_level_screen.dart';
import 'package:voice_chat_room/features/profile/services/user_level_service.dart';

void main() {
  Future<void> tapPreviewTier(WidgetTester tester, int tierIndex) async {
    // The enlarged preview hero can place tier chips below the 600px test
    // viewport. Move the only active vertical ListView first, then let
    // ensureVisible finish positioning the requested chip.
    await tester.drag(
      find.byType(ListView).first,
      const Offset(0, -260),
    );
    await tester.pumpAndSettle();

    final tier = find.byKey(Key('level-tier-preview-$tierIndex'));
    await tester.ensureVisible(tier);
    await tester.pumpAndSettle();
    await tester.tap(tier);
    await tester.pumpAndSettle();
  }

  const summary = UserLevelSummary(
    uid: 'user_1',
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
      level: 10,
      maxLevel: 35,
      points: 1150000,
      minimumThreshold: 1150000,
      nextThreshold: 3000000,
      remaining: 1850000,
      progressBps: 0,
    ),
    games: UserGameLevelSummary(
      level: 1,
      maxLevel: 21,
      points: 810000,
      minimumThreshold: 200000,
      nextThreshold: 1000000,
      remaining: 190000,
      progressBps: 7625,
      storedPoints: 1000000,
      pendingDecayPoints: 190000,
      pendingDecayDays: 2,
      lastGameActivityAtMs: 1791028800000,
    ),
  );

  testWidgets('level screen exposes all three approved sections', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('المستوى'), findsWidgets);
    expect(find.text('الثروة'), findsWidgets);
    expect(find.text('الجاذبية'), findsOneWidget);
    expect(find.text('الألعاب'), findsOneWidget);
    expect(find.text('LV6'), findsOneWidget);
    expect(find.text('شريط الدعم'), findsOneWidget);

    await tester.tap(find.text('الجاذبية'));
    await tester.pumpAndSettle();
    expect(find.text('LV10'), findsOneWidget);
    expect(find.text('رتبة بصرية'), findsOneWidget);

    await tester.tap(find.text('الألعاب'));
    await tester.pumpAndSettle();
    expect(find.text('LV1'), findsOneWidget);
    expect(find.text('خصم الخمول محسوب'), findsOneWidget);
    expect(find.text('دعم اللعبة'), findsOneWidget);
  });
  testWidgets('wealth allows previewing locked cosmetic tiers', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tapPreviewTier(tester, 6);

    expect(find.text('LV31–35'), findsWidgets);
    expect(find.text('معاينة فقط — تُفتح عند الوصول إلى هذه الفئة'), findsOneWidget);
    expect(find.text('المركبة'), findsOneWidget);
    expect(
      find.text('يمكنك مشاهدة هذه التصاميم الآن، لكنها لا تصبح قابلة للاستخدام إلا بعد فتح الفئة.'),
      findsOneWidget,
    );
  });

  testWidgets('attraction allows previewing locked visual tiers', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('الجاذبية'));
    await tester.pumpAndSettle();

    await tapPreviewTier(tester, 6);

    expect(find.text('LV31–35'), findsWidgets);
    expect(find.text('معاينة فقط — تُفتح عند الوصول إلى هذه الفئة'), findsOneWidget);
    expect(find.byKey(const Key('attraction-rank-preview')), findsOneWidget);
    expect(find.text('شارة الجاذبية'), findsOneWidget);
  });

  testWidgets('games allows previewing locked visual tiers', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          initialTabIndex: 2,
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tapPreviewTier(tester, 6);

    expect(find.text('LV19–21'), findsWidgets);
    expect(find.text('معاينة فقط — تُفتح عند الوصول إلى هذه الفئة'), findsOneWidget);
    expect(find.byKey(const Key('game-rank-preview')), findsOneWidget);
    expect(find.text('شارة الألعاب'), findsOneWidget);
  });

  testWidgets('attraction arrows navigate into locked tiers', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          initialTabIndex: 1,
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Attraction level 10 starts at LV6–10. Move forward twice into locked tiers.
    await tester.tap(find.byKey(const Key('level-preview-next-attraction')));
    await tester.pumpAndSettle();
    expect(find.text('LV11–15'), findsWidgets);
    expect(find.text('معاينة فقط — تُفتح عند الوصول إلى هذه الفئة'), findsOneWidget);

    await tester.tap(find.byKey(const Key('level-preview-next-attraction')));
    await tester.pumpAndSettle();
    expect(find.text('LV16–20'), findsWidgets);
  });

  testWidgets('games arrows navigate into locked tiers without unlock', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          initialTabIndex: 2,
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Game level 1 starts at LV1–3. Arrow navigation must not be gated.
    await tester.tap(find.byKey(const Key('level-preview-next-games')));
    await tester.pumpAndSettle();
    expect(find.text('LV4–6'), findsWidgets);
    expect(find.text('معاينة فقط — تُفتح عند الوصول إلى هذه الفئة'), findsOneWidget);

    await tester.tap(find.byKey(const Key('level-preview-next-games')));
    await tester.pumpAndSettle();
    expect(find.text('LV7–9'), findsWidgets);
  });

  testWidgets('level screen can open directly on the requested public section', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          userId: 'public_user_2',
          initialTabIndex: 2,
          loadSummary: () async => summary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('LV1'), findsOneWidget);
    expect(find.text('دعم اللعبة'), findsOneWidget);
    expect(find.text('شريط الدعم'), findsNothing);
  });
  hiddenLevelStage07Tests(summary);
}


const hiddenPublicSummary = UserLevelSummary(
  uid: 'hidden_user',
  policyVersion: 1,
  visibility: UserLevelVisibility(
    hiddenLevelEntitled: true,
    hideWealthLevel: true,
    isSelf: false,
    canEdit: false,
  ),
  wealth: UserLevelSectionSummary(
    level: 0,
    maxLevel: 35,
    points: 0,
    minimumThreshold: 0,
    nextThreshold: null,
    remaining: 0,
    progressBps: 0,
    hidden: true,
    publiclyHidden: true,
  ),
  attraction: UserLevelSectionSummary(
    level: 4,
    maxLevel: 35,
    points: 50000,
    minimumThreshold: 50000,
    nextThreshold: 100000,
    remaining: 50000,
    progressBps: 0,
  ),
  games: UserGameLevelSummary(
    level: 1,
    maxLevel: 21,
    points: 200000,
    minimumThreshold: 200000,
    nextThreshold: 1000000,
    remaining: 800000,
    progressBps: 0,
    storedPoints: 200000,
    pendingDecayPoints: 0,
    pendingDecayDays: 0,
    lastGameActivityAtMs: null,
  ),
);

void hiddenLevelStage07Tests(UserLevelSummary baseSummary) {
  testWidgets('Stage 07 direct public hidden section never renders LV0/details',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          userId: 'hidden_user',
          loadSummary: () async => hiddenPublicSummary,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('مستوى مخفي'), findsOneWidget);
    expect(find.text('LV0'), findsNothing);
    expect(find.byKey(const Key('level-visibility-wealth')), findsNothing);
  });

  testWidgets('Stage 07 VIP3 self can toggle Wealth independently',
      (tester) async {
    var savedWealth = false;
    var savedAttraction = false;
    var savedGames = false;
    final own = baseSummary.copyWithVisibility(
      const UserLevelVisibility(
        hiddenLevelEntitled: true,
        isSelf: true,
        canEdit: true,
      ),
    );

    await tester.pumpWidget(
      MaterialApp(
        home: UserLevelScreen(
          loadSummary: () async => own,
          updateVisibility: ({
            required hideWealthLevel,
            required hideAttractionLevel,
            required hideGameLevel,
          }) async {
            savedWealth = hideWealthLevel;
            savedAttraction = hideAttractionLevel;
            savedGames = hideGameLevel;
            return UserLevelVisibility(
              hiddenLevelEntitled: true,
              hideWealthLevel: hideWealthLevel,
              hideAttractionLevel: hideAttractionLevel,
              hideGameLevel: hideGameLevel,
              isSelf: true,
              canEdit: true,
            );
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('level-visibility-wealth')));
    await tester.pumpAndSettle();

    expect(savedWealth, isTrue);
    expect(savedAttraction, isFalse);
    expect(savedGames, isFalse);
  });
}
