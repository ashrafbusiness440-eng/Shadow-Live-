import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP7 hidden entry stays independent from VIP5 presence hiding', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    final serviceSource = File(
      'lib/features/room/services/room_action_service.dart',
    ).readAsStringSync();
    final workerSource = File(
      'cloudflare-worker/src/voice-session-legacy.js',
    ).readAsStringSync();
    final realtimeSource = File(
      'cloudflare-worker/src/room-realtime.js',
    ).readAsStringSync();

    expect(mainSource.contains('إخفاء الوجود في الغرفة'), isTrue);
    expect(mainSource.contains('الدخول المخفي'), isTrue);
    expect(mainSource.contains('_roomHiddenEntryRequiredVipLevel = 7'), isTrue);
    expect(mainSource.contains('_canUseRoomHiddenEntry'), isTrue);

    expect(serviceSource.contains("'action': 'roomHiddenEntryState'"), isTrue);
    expect(serviceSource.contains("'action': 'setRoomHiddenEntry'"), isTrue);

    expect(workerSource.contains('hidden_entry_requires_vip7'), isTrue);
    expect(workerSource.contains('roomHiddenEntry:enabled'), isTrue);

    expect(realtimeSource.contains('activeRoomGhostMode('), isTrue);
    expect(realtimeSource.contains('activeHiddenRoomEntry('), isTrue);
  });
}
