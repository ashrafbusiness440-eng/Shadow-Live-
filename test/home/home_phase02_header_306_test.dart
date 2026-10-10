import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/home_screen.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';

void main() {
  testWidgets('account, coins and diamonds remain usable at narrow RTL widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 760));
      var profileOpens = 0;
      var coinsOpens = 0;
      var diamondsOpens = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF05060D),
          body: SafeArea(
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: HomeAccountHeader(
                  name: 'مستخدم باسم طويل جداً جداً لاختبار واجهة الموبايل',
                  level: '37',
                  coins: '987.6M',
                  diamonds: '123.4K',
                  profile: const <String, dynamic>{},
                  userId: '',
                  onOpenProfile: () => profileOpens++,
                  onOpenCoins: () => coinsOpens++,
                  onOpenDiamonds: () => diamondsOpens++,
                ),
              ),
            ),
          ),
        ),
      ));
      expect(find.byKey(const Key('home-account-profile')), findsOneWidget);
      expect(find.byKey(const Key('home-balance-كوينز')), findsOneWidget);
      expect(find.byKey(const Key('home-balance-ألماس')), findsOneWidget);
      expect(find.text('LV.37'), findsOneWidget);
      expect(find.text('987.6M'), findsOneWidget);
      expect(find.text('123.4K'), findsOneWidget);
      expect(find.byType(ProfileAvatarWithFrame), findsOneWidget);
      expect(
        tester.widget<ProfileAvatarWithFrame>(
          find.byType(ProfileAvatarWithFrame),
        ).snapshotOnly,
        isTrue,
      );
      expect(
        tester.getSize(find.byKey(const Key('home-balance-كوينز'))).height,
        44,
      );
      expect(tester.takeException(), isNull);

      await tester.tap(find.byKey(const Key('home-account-profile')));
      await tester.tap(find.byKey(const Key('home-balance-كوينز')));
      await tester.tap(find.byKey(const Key('home-balance-ألماس')));
      expect(profileOpens, 1);
      expect(coinsOpens, 1);
      expect(diamondsOpens, 1);
    }
  });

  testWidgets('missing balance or level never appears as an invented zero',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Directionality(
          textDirection: TextDirection.rtl,
          child: HomeAccountHeader(
            name: 'ضيف Shadow',
            level: '—',
            coins: '—',
            diamonds: '—',
            profile: const <String, dynamic>{},
            userId: '',
            onOpenProfile: () {},
            onOpenCoins: () {},
            onOpenDiamonds: () {},
          ),
        ),
      ),
    ));
    expect(find.text('المستوى غير متاح'), findsOneWidget);
    expect(find.text('—'), findsNWidgets(2));
    expect(find.text('0'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  test('account uses existing user snapshot, profile tab and wallet tabs', () {
    final home =
        File('lib/features/home/screens/home_screen.dart').readAsStringSync();
    final shell =
        File('lib/features/main/screens/main_shell_screen.dart')
            .readAsStringSync();
    final service =
        File('lib/features/home/services/discovery_service.dart')
            .readAsStringSync();

    expect(home.contains("userData?['coins'] ?? userData?['balance']"), isTrue);
    expect(home.contains("userData?['diamonds']"), isTrue);
    expect(home.contains("rawCoins == null ? '—'"), isTrue);
    expect(home.contains("rawDiamonds == null ? '—'"), isTrue);
    expect(home.contains('onOpenCoins: () => _recharge(0),'), isTrue);
    expect(home.contains('onOpenDiamonds: () => _recharge(1),'), isTrue);
    expect(home.contains('RechargeScreen(initialTab: tab)'), isTrue);
    expect(home.contains('snapshotOnly: true,'), isTrue);
    expect(shell.contains('onOpenProfile: () => _changePage(5),'), isTrue);
    expect(service.contains("collection('users').doc(currentUser.uid).get()"),
        isTrue);
    expect(home.contains('Timer.periodic'), isFalse);
    expect(home.contains("AppRoutes.notifications"), isFalse);
    expect(home.contains('Icons.task_alt_rounded'), isTrue);
    expect(home.contains('onPressed: null,'), isTrue);
  });
}
