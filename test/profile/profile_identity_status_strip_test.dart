import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_identity_status_strip.dart';

void main() {
  testWidgets('days are compact and physically before wealth and attraction',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 700));
      final tabs = <int>[];
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ProfileIdentityStatusStrip(
            membershipDays: 123,
            wealthLevel: 7,
            attractionLevel: 5,
            vipLevel: 0,
            location: '',
            onLevelTap: tabs.add,
          ),
        ),
      ));
      expect(find.text('123 يوم'), findsOneWidget);
      expect(find.textContaining('في التطبيق منذ'), findsNothing);
      final viewport = tester.widget<Scrollable>(
        find.ancestor(
          of: find.byKey(const Key('profile-identity-status-row')),
          matching: find.byType(Scrollable),
        ).first,
      );
      // In an RTL app, the horizontal viewport must still scroll from
      // physical left to right, keeping the day badge visible on first open.
      expect(viewport.axisDirection, AxisDirection.right);
      final day = tester.getTopLeft(find.text('123 يوم'));
      expect(day.dx, greaterThanOrEqualTo(0));
      expect(day.dx, lessThan(width));
      final wealth = tester.getTopLeft(find.byKey(const Key('level-badge-0')));
      final attraction =
          tester.getTopLeft(find.byKey(const Key('level-badge-1')));
      expect(day.dx, lessThan(wealth.dx));
      expect(wealth.dx, lessThan(attraction.dx));
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('level-badge-0')));
      expect(tabs, [0]);
    }
  });

  testWidgets('status group centers as a unit and VIP has no inner emblem',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(430, 700));
    var vipTaps = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ProfileIdentityStatusStrip(
          membershipDays: 31,
          wealthLevel: 0,
          attractionLevel: 0,
          vipLevel: 10,
          location: 'سوريا',
          onLevelTap: (_) {},
          onVipTap: () => vipTaps++,
        ),
      ),
    ));

    final group = tester.getRect(find.byKey(
      const Key('profile-identity-status-row'),
    ));
    expect((group.center.dx - 215).abs(), lessThan(1));
    expect(find.text('31 يوم'), findsOneWidget);
    expect(find.text('VIP 10'), findsOneWidget);
    expect(find.text('🇸🇾'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(const Key('profile-vip-label')),
        matching: find.byType(Icon),
      ),
      findsNothing,
    );
    await tester.tap(find.byKey(const Key('profile-vip-label')));
    expect(vipTaps, 1);
    expect(tester.takeException(), isNull);
  });

  test('all three profile surfaces use the same strip without a verbose age line',
      () {
    for (final file in [
      'lib/features/user/screens/profile_screen.dart',
      'lib/features/profile/screens/public_profile_screen.dart',
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ]) {
      final content = File(file).readAsStringSync();
      expect(content, contains('ProfileIdentityStatusStrip('), reason: file);
      expect(content, isNot(contains('في التطبيق منذ')), reason: file);
    }
  });
}
