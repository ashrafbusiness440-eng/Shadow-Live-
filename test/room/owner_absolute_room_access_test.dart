import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_moderator_service.dart';

void main() {
  test('absolute Owner can manage any room only while toggle is ON', () {
    const enabled = RoomModeratorState(
      roomId: 'room-1',
      isOwner: false,
      limit: 5,
      myCapabilities: <String>{},
      moderators: <RoomModerator>[],
      platformOwner: true,
      ownerAbsoluteRoomAccess: true,
      globalRoomManage: true,
    );
    const disabled = RoomModeratorState(
      roomId: 'room-1',
      isOwner: false,
      limit: 5,
      myCapabilities: <String>{},
      moderators: <RoomModerator>[],
      platformOwner: true,
      ownerAbsoluteRoomAccess: false,
      globalRoomManage: false,
    );

    expect(enabled.has('manageMic'), isTrue);
    expect(enabled.has('moderateUsers'), isTrue);
    expect(enabled.has('manageIds'), isTrue);
    expect(disabled.has('manageMic'), isFalse);
    expect(disabled.has('moderateUsers'), isFalse);
    expect(disabled.has('manageIds'), isFalse);
  });

  test('actual room owner keeps room ownership when absolute toggle is OFF', () {
    const state = RoomModeratorState(
      roomId: 'room-1',
      isOwner: true,
      limit: 5,
      myCapabilities: <String>{},
      moderators: <RoomModerator>[],
      platformOwner: true,
      ownerAbsoluteRoomAccess: false,
      globalRoomManage: false,
    );

    expect(state.has('manageMic'), isTrue);
    expect(state.has('manageIds'), isTrue);
  });

  test('three-dot Room Menu opens without awaiting ghost mode network', () {
    final source = File('lib/main.dart').readAsStringSync();
    final start = source.indexOf('Future<void> _showRoomMenu()');
    final end = source.indexOf('@override\n  void dispose()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final menu = source.substring(start, end);

    expect(menu.contains('await _roomActions.loadGhostMode()'), isFalse);
    expect(menu.contains('unawaited(_refreshRoomGhostMode())'), isTrue);
    expect(
      menu.contains('_roomModeratorState?.ownerAbsoluteRoomAccess'),
      isTrue,
    );
    expect(menu.contains('personal && actualOwner'), isTrue);
  });

  test('room seat acknowledgement gates local microphone opening', () {
    final source = File('lib/main.dart').readAsStringSync();
    final start = source.indexOf('Future<void> _toggleVoiceMic()');
    final end = source.indexOf('Future<void> _leaveVoiceRoom()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final toggle = source.substring(start, end);

    expect(toggle.contains('final taken = await _runSeatAction('), isTrue);
    expect(toggle.contains('if (taken == null ||'), isTrue);
    expect(toggle.indexOf('if (taken == null ||'),
        lessThan(toggle.indexOf('await _voiceSession.setMicMuted(false);')));
    expect(toggle.contains('final muted = !_voiceSession.micMuted;'), isTrue);
    expect(toggle.contains('final updated = await _runSeatAction('), isTrue);
    expect(toggle.contains('if (updated == null ||'), isTrue);
    expect(toggle.contains('await _voiceSession.setMicMuted(true);'), isTrue);
  });

  test('seat release immediately mutes and shares existing safety path', () {
    final source = File('lib/main.dart').readAsStringSync();
    final start = source.indexOf('Future<RoomSeatState?> _runSeatAction(');
    final end = source.indexOf('Future<void> _showSeatQuickProfile', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final action = source.substring(start, end);

    expect(action.contains('_applyRoomSeatSafety(state);'), isTrue);
    expect(action.contains('return null;'), isTrue);
    expect(source.contains(
        'if (!state.isOwner && !hasSeat && !_voiceSession.micMuted'), isTrue);

    final leaveSeat = source.indexOf(
        '// Stop local audio before waiting for the seat release.');
    expect(leaveSeat, greaterThanOrEqualTo(0));
    final mute = source.indexOf('await _voiceSession.setMicMuted(true);',
        leaveSeat);
    final leave = source.indexOf('_roomSeatService.leaveSeat(roomId)',
        leaveSeat);
    expect(mute, greaterThan(leaveSeat));
    expect(leave, greaterThan(mute));
  });

  test('room microphone ignores overlapping taps without new listeners', () {
    final source = File('lib/main.dart').readAsStringSync();
    expect(source.contains('bool _micActionInFlight = false;'), isTrue);

    final start = source.indexOf('Future<void> _toggleVoiceMic()');
    final end = source.indexOf('Future<void> _performToggleVoiceMic()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final gate = source.substring(start, end);
    expect(gate.contains('if (_micActionInFlight) return;'), isTrue);
    expect(gate.contains('_micActionInFlight = true;'), isTrue);
    expect(gate.contains('await _performToggleVoiceMic();'), isTrue);
    expect(gate.contains('finally {'), isTrue);
    expect(gate.contains('_micActionInFlight = false;'), isTrue);
    expect(gate.contains('Timer.periodic'), isFalse);
    expect(gate.contains('.listen('), isFalse);
  });

  test('Shadow Control exposes Owner-only absolute room toggle', () {
    final source = File('lib/main_control.dart').readAsStringSync();
    expect(source.contains('صلاحيات غرف مطلقة'), isTrue);
    expect(source.contains('ownerAbsoluteRoomAccessState'), isTrue);
    expect(source.contains('setOwnerAbsoluteRoomAccess'), isTrue);
    expect(source.contains('owner-absolute-room-access-toggle'), isTrue);
  });
}
