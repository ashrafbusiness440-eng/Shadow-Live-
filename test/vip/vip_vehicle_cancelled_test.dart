import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('cancelled vehicle feature cannot return to VIP UI or registry', () {
    final screen =
        File('lib/features/vip/screens/vip_screen.dart').readAsStringSync();
    final registry =
        File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();

    expect(screen.contains('vipVehicle('), isFalse);
    expect(screen.contains('مركبة حصرية'), isFalse);
    expect(screen.contains('عرض المركبات'), isFalse);
    expect(screen.contains('مركبة خاصة'), isFalse);
    expect(registry.contains('vipVehicle('), isFalse);

    // Vehicle removal changes the approved cumulative entitlement total.
    expect(screen.contains(r'${benefits.length}/38'), isTrue);
    expect(screen.contains(r'${benefits.length}/41'), isFalse);
  });
}
