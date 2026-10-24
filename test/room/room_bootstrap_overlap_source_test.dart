import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final room = File('lib/main.dart').readAsStringSync();
  final zego = File('lib/features/voice/services/zego_voice_service.dart')
      .readAsStringSync();
  final controller =
      File('lib/features/voice/services/voice_room_session_controller.dart')
          .readAsStringSync();
  final voice =
      File('lib/features/voice/services/voice_service.dart').readAsStringSync();

  test('room details prefetch starts only after authenticated room admission',
      () {
    final token = zego.indexOf('final session = await _tokenClient.createSession(');
    final admit = zego.indexOf('onRoomAuthorized?.call();', token);
    final engine = zego.indexOf('await _ensureEngine(session.appId);', admit);
    final login = zego.indexOf(
      'final result = await ZegoExpressEngine.instance.loginRoom(',
      engine,
    );

    expect(token, greaterThanOrEqualTo(0));
    expect(admit, greaterThan(token));
    expect(engine, greaterThan(admit));
    expect(login, greaterThan(engine));
    expect(voice, contains('void Function()? onRoomAuthorized,'));
    expect(controller, contains('onRoomAuthorized: onRoomAuthorized,'));
  });

  test('one in-flight room bootstrap overlaps ZEGO but is applied after join',
      () {
    final start = room.indexOf('Future<RoomBootstrapSnapshot?>? authorizedBootstrap;');
    final begin = room.indexOf('authorizedBootstrap ??= fetchAuthorizedBootstrap();',
        start);
    final join = room.indexOf('await _voiceSession.join({', begin);
    final apply = room.indexOf(
      'unawaited(_loadRoomBootstrap(roomId, authorizedBootstrap));',
      join,
    );

    expect(start, greaterThanOrEqualTo(0));
    expect(begin, greaterThan(start));
    expect(join, greaterThan(begin));
    expect(apply, greaterThan(join));
    expect(room, contains('onRoomAuthorized: beginAuthorizedBootstrap'));
    expect(room, contains('if (_minimizeAfterJoin) {'));
  });

  test('failed prefetch and newer live snapshots cannot regress room safety',
      () {
    expect(room, contains('Future<RoomBootstrapSnapshot?> fetchAuthorizedBootstrap() async'));
    expect(room, contains('return null;'));
    expect(room, contains('FirebaseAuth.instance.currentUser?.uid != joinedUserUid'));
    expect(room, contains('final hasNewerLiveSnapshot ='));
    expect(room, contains('_roomLiveRevision++;'));
    expect(room, contains('if (!hasNewerLiveSnapshot) {'));
    expect(room, contains('_roomSeatState = snapshot.seatState;'));
    expect(room, contains('_roomModeratorState = snapshot.moderatorState;'));
  });
}
