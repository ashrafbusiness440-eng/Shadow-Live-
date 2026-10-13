import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_action_grid.dart';

void main() {
  testWidgets('profile actions adapt to 2, 3 and 4 RTL columns with real taps',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 390, 580, 800]) {
      await tester.binding.setSurfaceSize(Size(width, 950));
      final taps = <int>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Directionality(
              textDirection: TextDirection.rtl,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: ProfileActionGrid(
                  actions: [
                    for (var i = 0; i < 9; i++)
                      InkWell(
                        key: Key('grid-profile-action-$i'),
                        onTap: () => taps.add(i),
                        child: Center(child: Text('المدخل $i')),
                      ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final columns = width >= 800
          ? 4
          : width >= 580
              ? 3
              : 2;
      final first = find.byKey(const Key('grid-profile-action-0'));
      final lastSameRow =
          find.byKey(Key('grid-profile-action-${columns - 1}'));
      final nextRow = find.byKey(Key('grid-profile-action-$columns'));
      expect(tester.getTopLeft(first).dy,
          tester.getTopLeft(lastSameRow).dy);
      expect(tester.getTopLeft(nextRow).dy,
          greaterThan(tester.getTopLeft(first).dy));
      expect(tester.getSize(first).height, 78);
      expect(tester.getSize(first).width,
          lessThanOrEqualTo((width - 32) / columns));
      expect(tester.takeException(), isNull);
      await tester.tap(first);
      expect(taps, [0]);
    }
  });

  test('own profile keeps existing routes and restricts package grants', () {
    final screen = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    final grid = File(
      'lib/features/profile/widgets/profile_action_grid.dart',
    ).readAsStringSync();
    expect(screen.contains('ProfileActionGrid('), isTrue);
    for (final label in <String>[
      'تعديل الملف',
      'شحن',
      'الإعدادات',
      'مقتنياتي',
      'المستوى',
      'VIP',
      'الشخص الغامض',
      'العلاقات',
      'وكالتي',
    ]) {
      expect(screen.contains("'$label'"), isTrue, reason: label);
    }
    expect(screen.contains('if (canGrantAgencyPackage)'), isTrue);
    expect(screen.contains('const MysteriousPersonScreen()'), isTrue);
    expect(screen.contains('const RelationshipsPage()'), isTrue);
    expect(screen.contains('const AgencyPackageGrantPage()'), isTrue);
    expect(screen.contains('const UserLevelScreen()'), isTrue);
    expect(screen.contains('AppRoutes.myAgency'), isTrue);
    expect(screen.contains("Key('profile-action-$label')"), isFalse,
        reason: 'The action key should derive dynamically, not use a fixed label');
    expect(screen.contains("Key('profile-action-\$label')"), isTrue);
    expect(grid.contains('.snapshots()'), isFalse);
    expect(grid.contains('FirebaseFirestore'), isFalse);
    expect(grid.contains('Timer.periodic'), isFalse);
    expect(screen.contains('UserLevelService()'), isFalse);
  });

  test('interests show first six with optional local-only show-all', () {
    final source = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    expect(source.contains('children: interests'), isTrue);
    expect(source.contains('.take(6)'), isTrue);
    expect(source.contains('if (interests.length > 6)'), isTrue);
    expect(source.contains("Key('own-profile-interests-show-all')"), isTrue);
    expect(source.contains('_showAllInterests(interests)'), isTrue);
    expect(source.contains('for (final interest in interests)'), isTrue);
    expect(source.contains('SingleChildScrollView('), isTrue);
  });
}
