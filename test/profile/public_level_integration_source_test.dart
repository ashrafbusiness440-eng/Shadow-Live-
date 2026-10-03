import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

int occurrences(String source, String needle) {
  var count = 0;
  var start = 0;
  while (true) {
    final index = source.indexOf(needle, start);
    if (index < 0) return count;
    count += 1;
    start = index + needle.length;
  }
}

void main() {
  test('public and quick profiles reuse one bounded level future per open', () {
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quickProfile = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();

    for (final source in [publicProfile, quickProfile]) {
      expect(source.contains('late Future<UserLevelSummary> _levelFuture'), isTrue);
      expect(source.contains('UserLevelBadges('), isTrue);
      expect(source.contains('initialTabIndex: tabIndex'), isTrue);
      expect(occurrences(source, 'loadForUser(widget.userId)'), 1);
      expect(
        source.contains(
          "future: FirebaseFirestore.instance.collection('public_profiles')",
        ),
        isFalse,
      );
    }
  });
}
