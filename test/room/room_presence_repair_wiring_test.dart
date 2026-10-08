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

  test('room presence retries stay bounded until server.ready', () {
    final presence = File(
      'lib/features/room/services/room_presence_service.dart',
    ).readAsStringSync();

    final connectStart = presence.indexOf('Future<void> _connect(');
    final joinStart = presence.indexOf('Future<void> join(', connectStart);
    expect(connectStart, greaterThanOrEqualTo(0));
    expect(joinStart, greaterThan(connectStart));
    final connect = presence.substring(connectStart, joinStart);

    final readyWait = connect.indexOf('await ready.future.timeout(');
    final resetBudget = connect.indexOf('_reconnectAttempt = 0;');
    expect(readyWait, greaterThanOrEqualTo(0));
    expect(resetBudget, greaterThan(readyWait));
    expect(connect.contains('await failedSocket.close();'), isTrue);
    expect(connect.contains('await failedSubscription?.cancel();'), isTrue);
    expect(connect.contains('_scheduleReconnect(roomId, generation);'), isTrue);
    expect(presence.contains('if (isReadyFor(id)) return;'), isTrue);
    expect(presence.contains('if (_reconnectAttempt >= 3) return;'), isTrue);
  });

  test('room gift checks existing presence service before mutation', () {
    final sheet = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    final main = File('lib/main.dart').readAsStringSync();

    expect(sheet.contains('Future<bool> Function()? ensurePresence'), isTrue);
    expect(sheet.contains('final ensurePresence = widget.ensurePresence;'), isTrue);
    expect(sheet.contains('await ensurePresence();'), isTrue);
    expect(sheet.contains("StateError('room_presence_unavailable')"), isTrue);
    expect(main.contains('_voiceSession.ensureRoomPresenceReady'), isTrue);
  });
}
