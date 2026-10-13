import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/country_selector.dart';

void main() {
  test('country flags use the canonical selector and retain custom country', () {
    expect(shadowCountryByName('سوريا')?.flag, '🇸🇾');
    expect(shadowCountryByName('الإمارات')?.flag, '🇦🇪');
    expect(shadowCountryByName('UAE')?.flag, '🇦🇪');
    expect(shadowCountryByName('الباشان')?.flag, '🇸🇨');
    expect(shadowCountryByName('غير موجود'), isNull);
  });

  testWidgets('profile renders only known flag, with no country name text',
      (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: Column(
              children: [
                ShadowProfileCountryFlag(location: 'سوريا'),
                ShadowProfileCountryFlag(location: 'الباشان'),
                ShadowProfileCountryFlag(location: 'غير معروف'),
                ShadowProfileCountryFlag(location: 'أخرى'),
              ],
            ),
          ),
        ),
      ),
    );
    expect(find.text('🇸🇾'), findsOneWidget);
    expect(find.text('🇸🇨'), findsOneWidget);
    expect(find.text('سوريا'), findsNothing);
    expect(find.text('الباشان'), findsNothing);
    expect(find.text('🌐'), findsNothing);
  });

  test('all full and quick profiles reuse the canonical flag without new IO', () {
    for (final file in const [
      'lib/features/user/screens/profile_screen.dart',
      'lib/features/profile/screens/public_profile_screen.dart',
    ]) {
      final source = File(file).readAsStringSync();
      expect(source.contains('ProfileIdentityInfoLine('), isTrue,
          reason: 'Shared identity line must be used by $file');
      expect(source.contains('ProfileAvatarWithFrame('), isTrue,
          reason: 'Preserve existing avatar/frame in $file');
    }
    final quick = File('lib/features/profile/widgets/quick_profile_sheet.dart')
        .readAsStringSync();
    expect(quick.contains('ShadowProfileCountryFlag('), isTrue);
    expect(quick.contains('ProfileAvatarWithFrame('), isTrue);
    final identity = File('lib/features/profile/widgets/profile_identity_info_line.dart')
        .readAsStringSync();
    expect(identity.contains('ShadowProfileCountryFlag('), isTrue);
    expect(identity.contains('FirebaseFirestore'), isFalse);
    final picker = File('lib/shared/widgets/country_selector.dart')
        .readAsStringSync();
    expect(picker.contains('final country = shadowCountryByName(location);'),
        isTrue);
    expect(picker.contains('country.isoCode.isEmpty'), isTrue);
  });
}
