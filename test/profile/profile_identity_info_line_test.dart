import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_identity_info_line.dart';
import 'package:voice_chat_room/shared/widgets/country_selector.dart';

void main() {
  testWidgets('compact profile identity metadata stays tappable at phone widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var copyCount = 0;
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 720));
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Center(
              child: ProfileIdentityInfoLine(
                id: '12345678',
                location: 'الإمارات',
                gender: 'ذكر',
                copyKey: const Key('profile-id-copy-test'),
                onCopy: () => copyCount++,
              ),
            ),
          ),
        ),
      );
      final copy = find.byKey(const Key('profile-id-copy-test'));
      expect(copy, findsOneWidget);
      expect(find.text('ID: 12345678'), findsOneWidget);
      expect(find.byType(ShadowProfileCountryFlag), findsOneWidget);
      expect(find.text('♂'), findsOneWidget);
      expect(tester.getSize(copy).height, greaterThanOrEqualTo(44));
      expect(tester.takeException(), isNull);
      await tester.tap(copy);
    }
    expect(copyCount, 4);
  });

  testWidgets('fancy ID is readable, copyable and has no decorative pill',
      (tester) async {
    var copyCount = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ProfileIdentityInfoLine(
            id: '987654321',
            location: '',
            copyKey: const Key('public-copy-test'),
            onCopy: () => copyCount++,
          ),
        ),
      ),
    );
    expect(find.text('ID: 987654321'), findsOneWidget);
    expect(find.byTooltip('نسخ ID'), findsOneWidget);
    expect(find.text('♀'), findsNothing);
    await tester.tap(find.byKey(const Key('public-copy-test')));
    expect(copyCount, 1);
  });

  test('own/public metadata reuse shared widget and existing ID copy actions', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final publicProfile =
        File('lib/features/profile/screens/public_profile_screen.dart')
            .readAsStringSync();
    final row = File('lib/features/profile/widgets/profile_identity_info_line.dart')
        .readAsStringSync();

    expect(own.contains('ProfileIdentityInfoLine('), isTrue);
    expect(own.contains("copyKey: const Key('own-profile-copy-id')"), isTrue);
    expect(own.contains('onCopy: () => _copyId(profile)'), isTrue);
    expect(publicProfile.contains('ProfileIdentityInfoLine('), isTrue);
    expect(publicProfile.contains("copyKey: const Key('public-profile-copy-id')"), isTrue);
    expect(publicProfile.contains('onCopy: () => _copyUserIds('), isTrue);
    expect(row.contains('ShadowProfileCountryFlag('), isTrue);
    expect(row.contains('minimumSize: const Size(44, 44)'), isTrue);
    expect(row.contains('FirebaseFirestore'), isFalse);
    expect(row.contains('Timer.periodic'), isFalse);
  });
}
