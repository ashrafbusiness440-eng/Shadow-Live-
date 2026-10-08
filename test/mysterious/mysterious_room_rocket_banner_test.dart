import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('rocket banner does not load real profile avatar while mysterious', () {
    final service = File(
      'lib/features/room/services/room_rocket_service.dart',
    ).readAsStringSync();
    final banner = File(
      'lib/features/room/widgets/room_rocket_banner_host.dart',
    ).readAsStringSync();

    expect(service.contains('triggerMysteriousMode'), isTrue);
    expect(service.contains('triggerMysteriousId'), isTrue);
    expect(banner.contains('event.triggerMysteriousMode'), isTrue);
    expect(
      banner.contains('? const MysteriousIdentityAvatar(diameter: 44)'),
      isTrue,
    );
  });
}
