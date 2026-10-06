import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('cancelled VIP vehicle feature is absent from VIP runtime surfaces', () {
    final vip =
        File('lib/features/vip/screens/vip_screen.dart').readAsStringSync();
    final registry =
        File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();

    expect(vip.contains('مركبة'), isFalse);
    expect(vip.contains('عرض المركبات'), isFalse);
    expect(vip.contains('vipVehicle('), isFalse);
    expect(registry.contains('vipVehicle('), isFalse);
    expect(registry.contains("vip.v$level.vehicle"), isFalse);

    expect(vip.contains('/38'), isTrue);
  });
}
