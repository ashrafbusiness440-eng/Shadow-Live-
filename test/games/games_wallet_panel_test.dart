import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/games/widgets/games_wallet_panel.dart';

void main() {
  Widget host(Widget child) => MaterialApp(
        home: Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(body: child),
        ),
      );

  testWidgets('games wallet reads real source fields and reuses recharge',
      (tester) async {
    int reads = 0;
    int opens = 0;
    await tester.pumpWidget(host(GamesWalletPanel(
      loadSnapshot: () async {
        reads++;
        return <String, dynamic>{'coins': reads == 1 ? 12500 : 25000};
      },
      openRecharge: () async { opens++; },
    )));
    await tester.pumpAndSettle();
    expect(find.text('12.5K'), findsOneWidget);
    expect(reads, 1);

    await tester.tap(find.byKey(const ValueKey('games-wallet-recharge')));
    await tester.pumpAndSettle();
    expect(opens, 1);
    expect(reads, 2);
    expect(find.text('25K'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('games-wallet-refresh')));
    await tester.pumpAndSettle();
    expect(reads, 3);
  });

  testWidgets('wallet does not invent zero when balance is absent',
      (tester) async {
    await tester.pumpWidget(host(GamesWalletPanel(
      loadSnapshot: () async => <String, dynamic>{},
    )));
    await tester.pumpAndSettle();
    expect(find.text('الرصيد غير متاح'), findsOneWidget);
    expect(find.text('0'), findsNothing);
  });

  testWidgets('wallet uses supported legacy balance and retries failures',
      (tester) async {
    bool fail = true;
    await tester.pumpWidget(host(GamesWalletPanel(
      loadSnapshot: () async {
        if (fail) throw StateError('offline');
        return <String, dynamic>{'balance': 1000};
      },
    )));
    await tester.pumpAndSettle();
    expect(find.text('تعذر تحميل الرصيد'), findsOneWidget);
    fail = false;
    await tester.tap(find.byKey(const ValueKey('games-wallet-refresh')));
    await tester.pumpAndSettle();
    expect(find.text('1K'), findsOneWidget);
  });
}
