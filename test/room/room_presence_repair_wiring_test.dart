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
    expect(presence.contains('if (_reconnectAttempt >= _maxReconnectAttempts) return;'), isTrue);
    expect(presence.contains('static const int _maxReconnectAttempts = 6;'), isTrue);
    expect(presence.contains("type: 'room.connection_lost'"), isTrue);
    expect(controller.contains("event.type == 'room.connection_lost'"), isTrue);
    expect(controller.contains("'presenceDegraded': false"), isTrue);
    expect(controller.contains("'presenceDegraded': true"), isTrue);
  });

  test('terminal ZEGO disconnect reuses exactly one room leave path', () {
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    expect(controller.contains('final unexpectedLoss = _active &&'), isTrue);
    expect(controller.contains('if (unexpectedLoss) unawaited(leave());'),
        isTrue);
    expect(controller.contains('Future<void>? _leaveInFlight;'), isTrue);
    expect(controller.contains('if (pending != null) return pending;'),
        isTrue);
    expect(controller.contains('operation = _leaveRoomSession().whenComplete'),
        isTrue);

    final start = controller.indexOf('Future<void> _leaveBannedRoom()');
    final end = controller.indexOf('void _watchRoomLifecycle', start);
    final ban = controller.substring(start, end);
    expect(ban.contains('await leave();'), isTrue);
    expect(ban.contains('await _stopPresence('), isFalse);

    final closedStart =
        controller.indexOf('Future<void> _leaveClosedRoom()');
    final closedEnd =
        controller.indexOf('String _displayNameForJoin(', closedStart);
    final closed = controller.substring(closedStart, closedEnd);
    expect(closed.contains('await leave();'), isTrue);
    expect(closed.contains('await _stopPresence('), isFalse);
  });

  test('remote room mute is enforced on the existing room state stream', () {
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final lifecycle = controller.substring(
      controller.indexOf('void _watchRoomLifecycle('),
      controller.indexOf('Future<void> _leaveClosedRoom('),
    );
    expect(lifecycle.contains("final rawSeats = data['seats'];"), isTrue);
    expect(lifecycle.contains("final serverMuted = mySeat?['muted'] != false;"),
        isTrue);
    expect(lifecycle.contains('hasSeat && serverMuted'), isTrue);
    expect(lifecycle.contains('unawaited(setMicMuted(true));'), isTrue);
    expect(lifecycle.contains('RoomSeatService().watch('), isFalse);
    expect(lifecycle.contains('Timer.periodic'), isFalse);
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
