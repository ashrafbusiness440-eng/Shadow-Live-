import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Fancy ID is wired to VIP and profile surfaces without extra display lookup', () {
    final vipScreen =
        File('lib/features/vip/screens/vip_screen.dart').readAsStringSync();
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quickProfile = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();
    final service = File(
      'lib/features/vip/services/vip_fancy_id_service.dart',
    ).readAsStringSync();

    expect(vipScreen.contains("'vip-fancy-id-open'"), isTrue);
    expect(vipScreen.contains('VipFancyIdScreen'), isTrue);

    expect(publicProfile.contains("data['activeFancyId']"), isTrue);
    expect(publicProfile.contains("'نسخ Fancy ID'"), isTrue);
    expect(publicProfile.contains("'نسخ Public ID الأساسي'"), isTrue);

    expect(quickProfile.contains("data['activeFancyId']"), isTrue);
    expect(quickProfile.contains("'نسخ Fancy ID'"), isTrue);
    expect(quickProfile.contains("'نسخ Public ID الأساسي'"), isTrue);

    // Display/copy uses public_profiles snapshot only; no separate Fancy-ID
    // service call is allowed just to render the ID or open the copy menu.
    expect(publicProfile.contains('VipFancyIdService'), isFalse);
    expect(quickProfile.contains('VipFancyIdService'), isFalse);

    // Search/management is server-backed and exact.
    expect(service.contains("'action': 'resolve'"), isTrue);
    expect(service.contains("'action': 'assign'"), isTrue);
  });
}
