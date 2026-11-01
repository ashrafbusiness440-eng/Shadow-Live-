import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_wallet_overlay.dart';

void main() {
  testWidgets('real coins/diamonds render compactly, stacked and tappable',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 730));
      var coinsTaps = 0;
      var diamondsTaps = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Align(
            alignment: Alignment.topLeft,
            child: ProfileWalletOverlay(
              width: width <= 340 ? 88 : 104,
              coins: 1250000,
              diamonds: 24000,
              onCoinsTap: () => coinsTaps++,
              onDiamondsTap: () => diamondsTaps++,
            ),
          ),
        ),
      ));
      final coins = find.byKey(const Key('profile-cover-coins'));
      final diamonds = find.byKey(const Key('profile-cover-diamonds'));
      expect(coins, findsOneWidget);
      expect(diamonds, findsOneWidget);
      expect(tester.getTopLeft(coins).dy,
          lessThan(tester.getTopLeft(diamonds).dy));
      expect(tester.getSize(find.byKey(const Key('profile-cover-wallet'))).width,
          width <= 340 ? 88 : 104);
      expect(find.textContaining('M'), findsOneWidget);
      expect(find.textContaining('K'), findsOneWidget);
      await tester.tap(coins);
      await tester.tap(diamonds);
      expect(coinsTaps, 1);
      expect(diamondsTaps, 1);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('missing wallet fields never masquerade as zero', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ProfileWalletOverlay(
          coins: null,
          diamonds: 0,
          onCoinsTap: () {},
          onDiamondsTap: () {},
        ),
      ),
    ));
    expect(find.byKey(const Key('profile-coins-value')), findsOneWidget);
    expect(find.text('—'), findsOneWidget);
    expect(find.text('0'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('header overlay sits within the cover below the toolbar', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final pub = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
    final quick = File('lib/features/profile/widgets/quick_profile_sheet.dart')
        .readAsStringSync();
    final shared = File('lib/features/profile/widgets/profile_identity_status_strip.dart')
        .readAsStringSync();

    expect(own, contains('fit: StackFit.expand'));
    expect(own, contains('top: MediaQuery.paddingOf(context).top + kToolbarHeight + 10'));
    expect(own, contains('left: MediaQuery.sizeOf(context).width <= 340 ? 8 : 12'));
    expect(own, contains("_walletAmount(profile, const ['coins', 'balance'])"));
    expect(own, contains("_walletAmount(profile, const ['diamonds'])"));
    expect(own, contains('onCoinsTap: () => _recharge(0)'));
    expect(own, contains('onDiamondsTap: () => _recharge(1)'));
    expect(own, contains('expandedHeight: 365'));
    expect(pub, contains('expandedHeight: 365'));
    expect(quick, contains('const SizedBox(height: 10)'));
    expect(shared, contains("ShadowAssetKeys.vipLevelBadge(vipLevel)"));
    expect(shared, contains("'$" + "membershipDays يوم'"));
    expect(own, contains('protectAvatarCenter: true'));
  });
}
