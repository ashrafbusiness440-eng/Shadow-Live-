import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/pk_score_overlay.dart';

void main() {
  test('existing reconnect event triggers one bounded PK score refresh', () {
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final seats = File(
      'lib/features/room/services/room_seat_service.dart',
    ).readAsStringSync();
    expect(controller.contains("event.type == 'room.connection_lost'"), true);
    expect(controller.contains("event.type == 'server.ready'"), true);
    expect(controller.contains('unawaited(_refreshPkAfterReconnect(roomId));'),
        true);
    expect(controller.contains('_pkSyncInFlight'), true);
    expect(controller.contains('.timeout(const Duration(seconds: 8))'), true);
    expect(controller.contains('_pkScores.installSnapshot('), true);
    expect(seats.contains("'action': 'pkState'"), true);
    expect(seats.contains('syncPkScoreSnapshot(String roomId)'), true);
  });

  test('PK authoritative reconnect snapshot includes missed paid gifts only once',
      () {
    final overlay = PkScoreOverlay();
    final raw = <String, dynamic>{
      'pkState': <String, dynamic>{
        'id': 'pk_round',
        'status': 'active',
        'participants': <Map<String, dynamic>>[
          <String, dynamic>{'uid': 'receiver', 'team': 'a', 'score': 0},
        ],
      },
    };
    overlay.merge(raw);
    final before = overlay.revision;
    expect(overlay.apply(<String, dynamic>{
      'roundId': 'pk_round',
      'operationId': 'gift_during_refresh',
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'receiver', 'scoreTwice': 20},
      ],
    }), true);
    expect(overlay.installSnapshot(<String, dynamic>{
      'id': 'pk_round',
      'status': 'active',
      'participants': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'receiver', 'score': 100},
      ],
    }, startedAtRevision: before), true);
    final projected = overlay.merge(raw)['pkState'] as Map;
    final receiver = (projected['participants'] as List).first as Map;
    expect(receiver['score'], 110);
  });
}
