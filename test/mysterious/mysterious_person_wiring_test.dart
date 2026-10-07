import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mysterious person has two entry points and one shared state path', () {
    final privacy = File(
      'lib/screens/settings/vip_privacy_settings_screen.dart',
    ).readAsStringSync();
    final profile = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/mysterious/screens/mysterious_person_screen.dart',
    ).readAsStringSync();
    final service = File(
      'lib/features/mysterious/services/mysterious_person_service.dart',
    ).readAsStringSync();

    expect(privacy.contains("'mysterious-person-entry'"), isTrue);
    expect(privacy.contains('MysteriousPersonScreen'), isTrue);
    expect(privacy.contains('_mysterious.setEnabled(enabled)'), isTrue);
    expect(privacy.contains('تشغيل الشخص الغامض'), isTrue);

    expect(profile.contains('TabController(length: 4'), isTrue);
    expect(profile.contains("Tab(text: 'الشخص الغامض')"), isTrue);
    expect(profile.contains('MysteriousPersonScreen(embedded: true)'), isTrue);

    expect(screen.contains("Key('mysterious-change-id')"), isTrue);
    expect(screen.contains("Key('mysterious-toggle')"), isTrue);
    expect(screen.contains('إيقاف الوضع لا يلغي الاشتراك'), isTrue);

    expect(service.contains('/mysterious-person'), isTrue);
    expect(service.contains('FirebaseFirestore'), isFalse);
    expect(service.contains('.snapshots()'), isFalse);
    expect(service.contains('Timer.periodic'), isFalse);
  });

  test('mysterious UI stays independent from VIP entitlement checks', () {
    final service = File(
      'lib/features/mysterious/services/mysterious_person_service.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/mysterious/screens/mysterious_person_screen.dart',
    ).readAsStringSync();

    expect(service.contains('effectiveVipLevel'), isFalse);
    expect(screen.contains('requiredVip'), isFalse);
    expect(screen.contains('VipScreen'), isFalse);
  });
}
