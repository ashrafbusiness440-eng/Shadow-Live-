import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room presence waits for server.ready and repairs once without polling', () {
    final presence = File(
      'lib/features/room/services/room_presence_service.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();

    expect(presence.contains("type == 'server.ready'"), isTrue);
    expect(presence.contains('room_realtime_ready_timeout'), isTrue);
    expect(presence.contains('Future<bool> ensureReady(String roomId)'), isTrue);
    expect(presence.contains('Timer.periodic'), isFalse);
    expect(controller.contains('ensureRoomPresenceReady'), isTrue);
    expect(controller.contains("'presenceDegraded': true"), isTrue);
  });

  test('room gift checks existing presence service before mutation', () {
    final sheet = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    final main = File('lib/main.dart').readAsStringSync();

    expect(sheet.contains('Future<bool> Function()? ensurePresence'), isTrue);
    expect(sheet.contains('await widget.ensurePresence'), isTrue);
    expect(sheet.contains("StateError('room_presence_unavailable')"), isTrue);
    expect(main.contains('_voiceSession.ensureRoomPresenceReady'), isTrue);
  });
}
