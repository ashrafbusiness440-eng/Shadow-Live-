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
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
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

  test('stale mic cleanup is delayed and bounded on last socket departure', () {
    final realtime = File(
      'cloudflare-worker/src/room-realtime-object.js',
    ).readAsStringSync();
    final leave = File(
      'cloudflare-worker/src/voice-session-legacy.js',
    ).readAsStringSync();
    final shim = File(
      'cloudflare-worker/src/legacy-firebase-admin-shim.js',
    ).readAsStringSync();
    final persistence = File(
      'cloudflare-worker/src/room-realtime-persistence.js',
    ).readAsStringSync();

    expect(realtime.contains('const SEAT_DEPARTURE_GRACE_MS = 20_000;'),
        isTrue);
    expect(realtime.contains('const SEAT_DEPARTURE_BATCH_LIMIT = 24;'),
        isTrue);
    expect(realtime.contains('async #scheduleSeatDeparture('), isTrue);
    expect(realtime.contains('async #processSeatDepartures('), isTrue);
    expect(realtime.contains('limit: SEAT_DEPARTURE_BATCH_LIMIT,'), isTrue);
    expect(realtime.contains('if (hasPresenceUid(live, uid)) {'), isTrue);
    expect(realtime.contains('await this.#scheduleSeatDeparture(roomId, uid);'),
        isTrue);
    expect(realtime.contains('if (attempts >= 2)'), isTrue);
    expect(realtime.contains('const seatDepartures = await this.#processSeatDepartures(nowMs);'),
        isTrue);
    expect(realtime.contains('Number(task.endedAtMs || nowMs)'), isTrue);
    expect(realtime.contains('await reclaimDepartedRoomSeat('), isTrue);
    expect(realtime.contains('roomDepartureCleanupCandidates('), isTrue);
    expect(realtime.contains('const candidatesByRoom = new Map();'), isTrue);
    expect(realtime.contains('if (!candidates.has(uid)) {'), isTrue);
    expect(realtime.toLowerCase().contains('firestore'), isFalse);
    expect(realtime.toLowerCase().contains('firebase'), isFalse);
    expect(persistence.contains('export async function reclaimDepartedRoomSeat('),
        isTrue);
    expect(persistence.contains('return roomSessionLeave('), isTrue);
    expect(
      persistence.contains('export function roomDepartureCandidatesFromSnapshot('),
      isTrue,
    );
    expect(realtime.contains('Timer.periodic'), isFalse);
    expect(realtime.contains('setInterval('), isFalse);
    expect(realtime.contains('RoomPresenceService('), isFalse);

    expect(
      leave.contains(
        'export async function roomSessionLeave(db,uid,roomId,endedAtMs=Date.now())',
      ),
      isTrue,
    );
    final cleanupStart = leave.indexOf('export async function roomSessionLeave(');
    final cleanupEnd = leave.indexOf('async function roomPresenceJoin(', cleanupStart);
    expect(cleanupStart, greaterThanOrEqualTo(0));
    expect(cleanupEnd, greaterThan(cleanupStart));
    final cleanup = leave.substring(cleanupStart, cleanupEnd);
    expect(cleanup.contains('await recordMicActivity(tx,db,uid,seat,endedAtMs);'),
        isTrue);
    expect(cleanup.contains('tx.update(roomRef,update);'), isTrue);
    expect(cleanup.contains('customerServiceMicExpiresAtMs:0,'), isTrue);
    expect(shim.contains('export function getFirestoreForEnv(env)'), isTrue);
  });

  test('people sheet lists both microphone occupants and room listeners', () {
    final screen = File('lib/main.dart').readAsStringSync();
    final start = screen.indexOf('Future<void> _showRoomParticipantsSheet()');
    final end = screen.indexOf('Future<void> _showMicRequestsSheet()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final sheet = screen.substring(start, end);
    // The roster must share the existing mic and socket snapshots without
    // hiding seated people, querying every user profile, or leaking mystery.
    expect(sheet.contains('final seatByUid = <String, VoiceSeat>{'), isTrue);
    expect(sheet.contains('for (final user in _voiceSession.roomParticipants)'), isTrue);
    expect(sheet.contains('usersByUid.putIfAbsent('), isTrue);
    expect(sheet.contains('if (seat.occupied && seat.uid.isNotEmpty)'), isTrue);
    expect(sheet.contains('usersByUid.values.toList('), isTrue);
    expect(sheet.contains('!seatedUids.contains(user.uid)'), isFalse);
    expect(sheet.contains("'mysteriousMode': seat.mysteriousMode"), isTrue);
    expect(sheet.contains('MysteriousRoomPresenceSkin('), isTrue);
    expect(sheet.contains('snapshotOnly: true,'), isTrue);
    expect(sheet.contains('Timer.periodic'), isFalse);
  });

  test('room gift checks existing presence service before mutation', () {
    final sheet = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    final main = File('lib/main.dart').readAsStringSync();

    expect(sheet.contains('Future<bool> Function()? ensurePresence'), isTrue);
    expect(sheet.contains('final ensurePresence = widget.ensurePresence;'), isTrue);
    expect(sheet.contains('await ensurePresence();'), isTrue);
    // Reuse the existing connection on demand; the backend alone
    // decides whether the sender may gift within this room.
    expect(sheet.contains("StateError('room_presence_unavailable')"), isFalse);
    expect(sheet.contains('final result = await _gifts.send('), isTrue);
    expect(main.contains('_voiceSession.ensureRoomPresenceReady'), isTrue);
  });
}
