import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:voice_chat_room/features/games/screens/game_playground_screens.dart';
import 'package:voice_chat_room/features/games/screens/games_hub_screen.dart';

Widget _host(Widget child) => MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Directionality(
        textDirection: TextDirection.rtl,
        child: child,
      ),
    );

void main() {
  testWidgets('Games hub exposes the three approved launch games', (tester) async {
    await tester.pumpWidget(_host(const GamesHubScreen()));
    expect(find.text('ألعاب Shadow Live'), findsOneWidget);
    expect(find.text('القط الجشع'), findsOneWidget);
    expect(find.text('الساحرة'), findsOneWidget);
    expect(find.text('Shadow Slot'), findsOneWidget);
  });

  testWidgets('Greedy Cat design round can be selected and settled', (tester) async {
    await tester.pumpWidget(_host(const GreedyCatGameScreen()));
    final option = find.text('سمكة ذهبية');
    await tester.ensureVisible(option);
    await tester.tap(option);
    await tester.pump();

    final joinButton = find.textContaining('شارك بـ 200');
    await tester.scrollUntilVisible(joinButton, 300, scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();
    await tester.tap(joinButton);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 900));
    await tester.pump();

    expect(find.textContaining('الفائز'), findsOneWidget);
  });

  testWidgets('Witch supports normal and advanced design modes', (tester) async {
    await tester.pumpWidget(_host(const WitchGameScreen()));
    expect(find.text('عادي'), findsOneWidget);
    expect(find.text('متقدم'), findsOneWidget);
    await tester.tap(find.text('متقدم'));
    await tester.pump();
    expect(find.textContaining('200 Coins'), findsWidgets);
  });

  testWidgets('Shadow Slot spin interaction completes', (tester) async {
    await tester.pumpWidget(_host(const ShadowSlotGameScreen()));
    await tester.tap(find.text('Spin • 200'));
    await tester.pump(const Duration(milliseconds: 700));
    expect(find.text('Spin • 200'), findsOneWidget);
  });
}
