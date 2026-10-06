import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP10 global entry reuses the existing rocket realtime socket', () {
    final service =
        File('lib/features/room/services/room_rocket_service.dart')
            .readAsStringSync();
    final host =
        File('lib/features/room/widgets/room_rocket_banner_host.dart')
            .readAsStringSync();

    expect(service.contains('watchGlobalEvents()'), isTrue);
    expect(service.contains("'app.global_event'"), isTrue);
    expect(service.contains("payload['recentGlobalEvents']"), isTrue);

    // Global VIP events must piggyback the existing _feedSocket connection.
    expect(service.contains('RoomPresenceSocketConnection? _feedSocket;'), isTrue);
    expect(service.contains('_globalFeedSocket'), isFalse);
    expect(service.contains('vipGlobalSocket'), isFalse);

    expect(host.contains('loadVip10GlobalEntryState()'), isTrue);
    expect(host.contains('publishVip10GlobalEntry()'), isTrue);
    expect(host.contains('authStateChanges()'), isTrue);
    expect(host.contains('مرة واحدة فقط اليوم'), isTrue);
    expect(host.contains('_Vip10GlobalBanner'), isTrue);
  });
}
