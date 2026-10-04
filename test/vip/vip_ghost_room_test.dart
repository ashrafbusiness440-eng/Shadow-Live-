import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP5 Ghost UI is hide-presence only and keeps hidden entry separate', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    final roomService = File(
      'lib/features/room/services/room_action_service.dart',
    ).readAsStringSync();
    final realtimeSource = File(
      'cloudflare-worker/src/room-realtime.js',
    ).readAsStringSync();

    expect(mainSource.contains('إخفاء الوجود في الغرفة'), isTrue);
    expect(mainSource.contains('تفتح من VIP\$_roomGhostRequiredVipLevel.'), isTrue);
    expect(mainSource.contains('الدخول الخفي'), isFalse);
    expect(mainSource.contains('_canUseRoomGhostMode'), isTrue);

    expect(roomService.contains('canUseGhostMode'), isTrue);
    expect(roomService.contains('requiredVipLevel'), isTrue);

    expect(realtimeSource.contains('activeRoomGhostMode('), isTrue);
    expect(realtimeSource.contains('activeHiddenRoomEntry('), isTrue);
    expect(realtimeSource.contains('privacy?.ghostMode'), isFalse);
  });
}
