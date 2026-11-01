import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/profile_membership_days.dart';

void main() {
  test('quick profile uses the verified shared membership age with no extra reads', () {
    final quick = File('lib/features/profile/widgets/quick_profile_sheet.dart')
        .readAsStringSync();
    expect(quick, contains("import '../services/profile_membership_days.dart';"));
    expect(quick, contains('verifiedMembershipDays(profile)'));
    expect(quick, contains('ProfileIdentityStatusStrip('));
    expect(quick, contains("_identityStatusStrip(data, vip)"));
    expect(quick, isNot(contains('في التطبيق منذ')));
    expect(quick, contains("_profileFuture = FirebaseFirestore.instance"));
    expect(quick, isNot(contains('Timer.periodic')));
  });

  test('unknown dates stay absent instead of using a guessed account age', () {
    expect(verifiedMembershipDays({}, now: DateTime.utc(2026, 11, 1)), isNull);
    expect(
      verifiedMembershipDays(
        {'createdAt': '2026-10-31T00:00:00Z'},
        now: DateTime.utc(2026, 11, 1),
      ),
      1,
    );
  });
}
