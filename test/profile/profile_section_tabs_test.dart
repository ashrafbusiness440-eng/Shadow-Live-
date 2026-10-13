import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_section_tabs.dart';

void main() {
  testWidgets('four RTL profile tabs fit narrow phones and remain tappable',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 700));
      await tester.pumpWidget(MaterialApp(
        home: DefaultTabController(
          length: 4,
          child: Builder(
            builder: (context) => Directionality(
              textDirection: TextDirection.rtl,
              child: Scaffold(
                body: Column(
                  children: [
                    ProfileSectionTabs(
                      controller: DefaultTabController.of(context),
                      labels: const ['حول', 'يومياتي', 'الهدايا', 'الشارات'],
                    ),
                    const Expanded(child: SizedBox()),
                  ],
                ),
              ),
            ),
          ),
        ),
      ));
      expect(find.byType(ProfileSectionTabs), findsOneWidget);
      expect(find.text('يومياتي'), findsOneWidget);
      expect(find.text('الشارات'), findsOneWidget);
      expect(tester.widget<TabBar>(find.byType(TabBar)).isScrollable, isFalse);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('يومياتي'));
      await tester.pumpAndSettle();
      expect(DefaultTabController.of(tester.element(find.byType(ProfileSectionTabs))).index, 1);
      expect(tester.takeException(), isNull);
    }
  });

  test('private profile keeps its existing rooms destination', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final public = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
    expect(own.contains("labels: const ['حول', 'الغرف', 'الهدايا']"), isTrue);
    expect(public.contains("labels: const ['حول', 'يومياتي', 'الهدايا', 'الشارات']"), isTrue);
    expect(own.contains('ProfilePersonalRoomTab('), isTrue);
    expect(public.contains('DiariesScreen('), isTrue);
  });
}
