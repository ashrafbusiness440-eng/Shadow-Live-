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
      final day = tester.getTopLeft(find.text('123 يوم'));
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
