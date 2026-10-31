import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final presence = File(
    'lib/features/room/services/room_presence_service.dart',
  ).readAsStringSync();
  final controller = File(
    'lib/features/voice/services/voice_room_session_controller.dart',
  ).readAsStringSync();

  test('parallel admission callers share the first join, not two sockets', () {
    final join = presence.substring(
      presence.indexOf('Future<void> join(String roomId)'),
      presence.indexOf('Future<bool> ensureReady(String roomId)'),
    );
    expect(join, contains('if (pending != null && _joinRoomId == id) return pending;'));
    expect(join, contains('_joinInFlight = operation;'));
    expect(join, contains('identical(_joinInFlight, operation)'));
    expect(join, contains('generation != _generation || _desiredRoomId != id'));
    expect(join, contains('await _connect(id, generation, announceOnReady: true);'));
    expect(join, contains('final previousSubscription = _socketSubscription;'));
    expect(join, contains('await previousSubscription?.cancel();'));
    expect(join, contains('generation != _generation || _desiredRoomId != id'));
  });

  test('leave invalidates old flight without closing a newer socket', () {
    final leave = presence.substring(
      presence.indexOf('Future<void> leave(String roomId)'),
      presence.indexOf('Future<void> refreshIdentity('),
    );
    expect(leave, contains('_joinInFlight = null;'));
    expect(leave, contains("_joinRoomId = '';"));
    expect(leave, contains('final oldSubscription = _socketSubscription;'));
    expect(leave, contains('final connection = _socket;'));
    expect(leave.indexOf('_socket = null;'), lessThan(leave.indexOf('await oldSubscription?.cancel();')));
  });

  test('chat recovery first waits for admission and never revives departed room', () {
    final ensure = presence.substring(
      presence.indexOf('Future<bool> ensureReady(String roomId)'),
      presence.indexOf('Future<void> leave(String roomId)'),
    );
    expect(ensure, contains('final joining = _joinInFlight;'));
    expect(ensure, contains('await joining.timeout(const Duration(seconds: 7));'));
    expect(ensure, contains('await pending.future.timeout(const Duration(seconds: 6));'));
    expect(ensure, contains('if (_desiredRoomId != id) return false;'));
    expect(ensure, contains('await join(id);'));
    expect(ensure, isNot(contains('Timer.periodic')));
    expect(ensure, isNot(contains("await _socketSubscription?.cancel()")));
  });

  test('old websocket callbacks cannot assert readiness in a new room', () {
    final connect = presence.substring(
      presence.indexOf('Future<void> _connect('),
      presence.indexOf('Future<void> join(String roomId)'),
    );
    expect(connect, contains('generation == _generation'));
    expect(connect, contains('_desiredRoomId == roomId'));
    expect(connect, contains('identical(_socket, connection)'));
    expect(connect, contains('_handleSocketMessage(message);'));
  });

  test('chat send remains bound to same authenticated room after await', () {
    final chat = controller.substring(
      controller.indexOf('Future<void> sendRoomChat('),
      controller.indexOf('Future<void> _refreshStarBattleAfterReconnect('),
    );
    expect(chat, contains('final targetRoomId = roomId.trim();'));
    expect(chat, contains('final targetUid = _sessionUserUid;'));
    expect(chat, contains('await _presenceService.ensureReady(targetRoomId)'));
    expect(chat, contains('roomId != targetRoomId'));
    expect(chat, contains('_sessionUserUid != targetUid'));
    expect(chat, contains('FirebaseAuth.instance.currentUser?.uid != targetUid'));
    expect(chat, contains("StateError('room_session_changed')"));
    expect(chat, contains('roomId: targetRoomId,'));
  });

  test('room presence is unknown until admitted, and old join cannot repaint new room', () {
    final join = controller.substring(
      controller.indexOf('Future<void> join(\n'),
      controller.indexOf('Future<void> enterPrivateCallMedia('),
    );
    final start = controller.substring(
      controller.indexOf('Future<void> _startPresence('),
      controller.indexOf('Future<void> _stopPresence('),
    );
    expect(join, contains("..['presenceDegraded'] = true;"));
    expect(start, contains('if (!_active || roomId != targetRoomId) return;'));
    expect(start, contains('await _presenceService.join(targetRoomId);'));
    expect(start, contains('_roomSessionGeneration != sessionGeneration'));
    expect(join, contains('final sessionGeneration = ++_roomSessionGeneration;'));
    expect(join, contains('_startPresence(targetRoomId, sessionGeneration)'));
  });
  test('audience never shows stale count or phantom owner as live', () {
    final room = File('lib/main.dart').readAsStringSync();
    final audience = room.substring(
      room.indexOf('int get _roomAudienceTotalCount'),
      room.indexOf('Future<void> _showRoomParticipantsSheet()'),
    );
    expect(audience, contains("if (_roomArguments['presenceDegraded'] == true ||"));
    expect(audience, contains("return '—';"));
    expect(audience, contains('return max(0, reported);'));
    expect(audience, contains('profileByUid.containsKey(ownerUid)'));
    expect(audience, contains('profileByUid.containsKey(uid)'));
    expect(audience, contains('final totalLabel = _roomAudienceCountLabel;'));
    expect(audience, isNot(contains('return max(reported, activeUids.length);')));
  });


}
