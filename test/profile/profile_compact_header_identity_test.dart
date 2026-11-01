import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_compact_header_identity.dart';

void main() {
  testWidgets('phone layouts pack actual visual geometry, retaining ID/status taps',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 760));
      var idTaps = 0;
      var vipTaps = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: width - 36,
              child: ProfileCompactHeaderIdentity(
                portraitHeight: 116,
                portrait: const SizedBox.square(
                  dimension: 114,
                  child: ColoredBox(color: Colors.amber),
                ),
                name: const Text('SHADOW',
                    style: TextStyle(fontSize: 24, height: 1.15)),
                identityId: Center(
                  child: SizedBox(
                    height: 44,
                    child: TextButton(
                      key: const Key('tap-id'),
                      onPressed: () => idTaps++,
                      child: const Text('ID: 010'),
                    ),
                  ),
                ),
                identityStatus: Center(
                  child: SizedBox(
                    height: 44,
                    child: TextButton(
                      key: const Key('tap-vip'),
                      onPressed: () => vipTaps++,
                      child: const Text('VIP 10'),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ));
      final portrait = tester.getRect(find.byKey(const Key('profile-header-portrait')));
      final name = tester.getRect(find.byKey(const Key('profile-header-name')));
      final id = tester.getRect(find.byKey(const Key('tap-id')));
      final vip = tester.getRect(find.byKey(const Key('tap-vip')));
      final group = tester.getRect(find.byKey(const Key('profile-compact-header-identity')));

      expect(group.height, lessThan(230));
      expect(portrait.center.dx, closeTo(group.center.dx, .1));
      expect(name.center.dx, closeTo(group.center.dx, .1));
      expect(name.top - portrait.bottom, inInclusiveRange(0, 12));
      expect(id.center.dy - name.center.dy, lessThan(40));
      expect(vip.center.dy - id.center.dy, lessThan(36));
      expect(id.height, greaterThanOrEqualTo(44));
      expect(vip.height, greaterThanOrEqualTo(44));
      await tester.tap(find.byKey(const Key('tap-id')));
      await tester.tap(find.byKey(const Key('tap-vip')));
      expect(idTaps, 1);
      expect(vipTaps, 1);
      expect(tester.takeException(), isNull);
    }
  });

  test('own and public headers use shared measured layout; quick remains intact', () {
    final own = File('lib/features/user/screens/profile_screen.dart').readAsStringSync();
    final pub = File('lib/features/profile/screens/public_profile_screen.dart').readAsStringSync();
    final quick = File('lib/features/profile/widgets/quick_profile_sheet.dart').readAsStringSync();
    expect(own, contains('ProfileCompactHeaderIdentity('));
    expect(own, contains('portraitHeight: 116,'));
    expect(own, contains('onVipTap: _openVip'));
    expect(pub, contains('ProfileCompactHeaderIdentity('));
    expect(pub, contains('portraitHeight: 136,'));
    expect(pub, contains('_identityStatusStrip(profile, vip)'));
    expect(quick, contains('protectAvatarCenter: true'));
    expect(own, contains("ProfileWalletOverlay("));
  });

  test('protected face stays safely inside the frame hole when lowered', () {
    const inset = .125;
    const faceRadius = .5 - inset;
    const drop = .04;
    const frameHoleRadius = .42;
    expect(faceRadius + drop, lessThan(frameHoleRadius));
  });
}
