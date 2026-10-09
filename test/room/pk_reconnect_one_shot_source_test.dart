import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('PK socket catch-up only follows a reconnect on the existing stream', () {
    final source = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final seatApi = File(
      'lib/features/room/services/room_seat_service.dart',
    ).readAsStringSync();

    expect(source.contains("event.type == 'room.connection_lost'"), isTrue);
    expect(source.contains("event.type == 'server.ready'"), isTrue);
    expect(source.contains('if (_refreshScoresAfterReconnect)'), isTrue);
    expect(source.contains(
      'unawaited(_refreshPkAfterReconnect(roomId));',
    ), isTrue);
    expect(source.contains('_pkSyncInFlight'), isTrue);
    expect(source.contains('_pkScores.installSnapshot('), isTrue);
    expect(source.contains('_roomStateController.add(_projectRoomState());'),
        isTrue);
    expect(seatApi.contains("'action': 'pkState'"), isTrue);
    expect(seatApi.contains('syncPkRoundSnapshot(String roomId)'), isTrue);
  });

  test('no new PK room listener or recurring timer is required', () {
    final source = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final begin = source.indexOf(
      'Future<void> _refreshPkAfterReconnect(String targetRoomId) async',
    );
    final end = source.indexOf(
      'void _handleRealtimeEvent(RoomRealtimeEvent event)', begin,
    );
    expect(begin, greaterThanOrEqualTo(0));
    expect(end, greaterThan(begin));
    final method = source.substring(begin, end);
    expect(method.contains('snapshots()'), isFalse);
    expect(method.contains('Timer.periodic'), isFalse);
    expect(method.contains('syncPkRoundSnapshot('), isTrue);
  });
}
