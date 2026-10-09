import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/star_battle_score_overlay.dart';

void main() {
  test('lost socket catch-up uses the existing single room action', () {
    final server = File('cloudflare-worker/src/voice-session-legacy.js')
        .readAsStringSync();
    final seat = File('lib/features/room/services/room_seat_service.dart')
        .readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();

    expect(server.contains('async function loadActiveStarBattleMicScores('),
        isTrue);
    expect(server.contains('.orderBy("coins","desc").limit(99).get();'),
        isTrue);
    expect(server.contains('starBattleSnapshot=battle?{'), isTrue);
    expect(
      server.contains('const starScoreByUid=await loadActiveStarBattleMicScores('),
      isTrue,
    );
    expect(seat.contains("'action': 'syncStarBattle'"), isTrue);
    expect(controller.contains("event.type == 'room.connection_lost'"), isTrue);
    expect(controller.contains('if (_refreshScoresAfterReconnect)'), isTrue);
    expect(controller.contains('_seatService.syncStarBattleSnapshot('), isTrue);
    expect(controller.contains('_starBattleSyncInFlight'), isTrue);
    expect(controller.contains('_roomStateController.add('), isTrue);
  });

  test('reconnect snapshot replaces stale counters without doubling old gifts', () {
    final overlay = StarBattleScoreOverlay();
    final room = <String, dynamic>{
      'starBattleState': <String, dynamic>{
        'id': 'round_123',
        'status': 'active',
        'scores': <String, dynamic>{},
      },
    };
    overlay.merge(room);
    final gift = <String, dynamic>{
      'roundId': 'round_123',
      'operationId': 'operation_a',
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'mic_user', 'coins': 50},
      ],
    };
    expect(overlay.apply(gift), isTrue);
    final revision = overlay.revision;
    expect(overlay.installBootstrap(<String, dynamic>{
      'id': 'round_123',
      'status': 'active',
      'scores': <String, dynamic>{
        'mic_user': <String, dynamic>{'coins': 250},
      },
    }, startedAtRevision: revision), isTrue);
    final scores = (overlay.merge(room)['starBattleState'] as Map)['scores'] as Map;
    expect((scores['mic_user'] as Map)['coins'], 250);
    expect(overlay.apply(gift), isFalse);
  });
}
