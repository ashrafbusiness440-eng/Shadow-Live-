import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/star_battle_score_overlay.dart';

void main() {
  Map<String, dynamic> room(String id, String status) => <String, dynamic>{
        'roomId': 'room1',
        'starBattleState': <String, dynamic>{
          'id': id,
          'status': status,
          'scores': <String, dynamic>{},
        },
      };

  test('server-confirmed gift scores update active round once', () {
    final overlay = StarBattleScoreOverlay();
    overlay.merge(room('star_one', 'active'));
    final award = <String, dynamic>{
      'roundId': 'star_one',
      'operationId': 'gift_one',
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'speaker_1', 'coins': 250},
        <String, dynamic>{'uid': 'speaker_2', 'coins': 250},
      ],
    };
    expect(overlay.apply(award), isTrue);
    expect(overlay.apply(award), isFalse);
    final first = overlay.merge(room('star_one', 'active'));
    final battle = Map<String, dynamic>.from(first['starBattleState'] as Map);
    final scores = Map<String, dynamic>.from(battle['scores'] as Map);
    expect((scores['speaker_1'] as Map)['coins'], 250);
    expect((scores['speaker_2'] as Map)['coins'], 250);
    expect(overlay.apply(<String, dynamic>{
      'roundId': 'star_one',
      'operationId': 'invalid_zero',
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'speaker_1', 'coins': 0},
      ],
    }), isFalse);
  });

  test('round finish and next round clear old star counters', () {
    final overlay = StarBattleScoreOverlay();
    overlay.merge(room('star_one', 'active'));
    expect(overlay.apply(<String, dynamic>{
      'roundId': 'star_one',
      'operationId': 'paid_one',
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'speaker_1', 'coins': 123},
      ],
    }), isTrue);
    final ended = overlay.merge(room('star_one', 'finished'));
    expect(
      (ended['starBattleState'] as Map)['scores'],
      isEmpty,
    );
    expect(overlay.roundId, isEmpty);
    overlay.merge(room('star_two', 'active'));
    expect(overlay.apply(<String, dynamic>{
      'roundId': 'star_one',
      'operationId': 'late',
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'speaker_1', 'coins': 50},
      ],
    }), isFalse);
    expect((overlay.merge(room('star_two', 'active'))['starBattleState']
        as Map)['scores'], isEmpty);
  });

  test('score updates use existing room state stream and no new listener', () {
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    expect(
      controller.contains(
        '_roomStateController.add(_starBattleScores.merge(_lastRawRoomState));',
      ),
      isTrue,
    );
    expect(
      controller.contains('StarBattleScoreOverlay _starBattleScores'),
      isTrue,
    );
  });
}
