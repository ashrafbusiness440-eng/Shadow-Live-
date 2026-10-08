import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('user level support details stay bounded and lazy-loaded', () {
    final service = File(
      'lib/features/profile/services/user_level_service.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/profile/screens/user_level_screen.dart',
    ).readAsStringSync();

    expect(service.contains("supportMetric': normalizedMetric"), isTrue);
    expect(service.contains("'limit': '20'"), isTrue);
    expect(service.contains('class UserLevelSupportPage'), isTrue);
    expect(service.contains('class UserLevelSupportItem'), isTrue);

    expect(screen.contains("Key('level-support-details-$metric')"), isTrue);
    expect(screen.contains('class _UserLevelSupportSheet'), isTrue);
    expect(screen.contains('loadSupportPage('), isTrue);
    expect(screen.contains("'تحميل المزيد'"), isTrue);
    expect(screen.contains('showQuickProfileSheet('), isTrue);
    expect(screen.contains('showMysteriousIdentitySheet('), isTrue);
    expect(screen.contains('Timer.periodic'), isFalse);
    expect(screen.contains('.snapshots()'), isFalse);
  });
}
