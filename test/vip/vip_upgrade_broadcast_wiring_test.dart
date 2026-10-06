import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP upgrade banner reuses existing global realtime feed', () {
    final host = File(
      'lib/features/room/widgets/room_rocket_banner_host.dart',
    ).readAsStringSync();
    final service = File(
      'lib/features/room/services/room_rocket_service.dart',
    ).readAsStringSync();

    expect(host.contains("'vip_level_upgrade'"), isTrue);
    expect(host.contains("'vip10_global_entry'"), isTrue);
    expect(host.contains('ترقّى إلى VIP'), isTrue);
    expect(service.contains('watchGlobalEvents()'), isTrue);
    expect(service.contains('RoomPresenceSocketConnection? _feedSocket;'), isTrue);
    expect(service.contains('_globalFeedSocket'), isFalse);
  });
}
