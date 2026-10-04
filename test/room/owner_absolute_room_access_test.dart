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

  test('Shadow Control exposes Owner-only absolute room toggle', () {
    final source = File('lib/main_control.dart').readAsStringSync();
    expect(source.contains('صلاحيات غرف مطلقة'), isTrue);
    expect(source.contains('ownerAbsoluteRoomAccessState'), isTrue);
    expect(source.contains('setOwnerAbsoluteRoomAccess'), isTrue);
    expect(source.contains('owner-absolute-room-access-toggle'), isTrue);
  });
}
