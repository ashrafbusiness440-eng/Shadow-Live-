import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/pk_score_overlay.dart';

Map<String, dynamic> activeRoom(String roundId, {String status = 'active'}) =>
    <String, dynamic>{
      'pkState': <String, dynamic>{
        'id': roundId,
        'status': status,
        'participants': <Map<String, dynamic>>[
          <String, dynamic>{'uid': 'a', 'team': 'a', 'score': 0},
          <String, dynamic>{'uid': 'b', 'team': 'b', 'score': 0},
        ],
      },
    };

Map<String, dynamic> award(String operation, int doubled) =>
    <String, dynamic>{
      'roundId': 'pk_round_1',
      'operationId': operation,
      'deltas': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'a', 'scoreTwice': doubled},
      ],
    };

num displayedScore(PkScoreOverlay overlay, Map<String, dynamic> room) {
  final pk = overlay.merge(room)['pkState'] as Map;
  return ((pk['participants'] as List).first as Map)['score'] as num;
}

void main() {
  test('PK live x10.5 is visible without a Firestore listener', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    expect(overlay.apply(award('gift_1', 21)), isTrue);
    expect(displayedScore(overlay, room), 10.5);
    expect(overlay.apply(award('gift_1', 21)), isFalse);
    expect(displayedScore(overlay, room), 10.5);
  });

  test('one-shot PK snapshot rebases only awards after request started', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    expect(overlay.apply(award('gift_old', 21)), isTrue);
    final beforeRequest = overlay.revision;
    expect(overlay.apply(award('gift_during', 20)), isTrue);
    expect(overlay.installSnapshot(<String, dynamic>{
      'id': 'pk_round_1',
      'status': 'active',
      'participants': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'a', 'score': 10.5},
        <String, dynamic>{'uid': 'b', 'score': 0},
      ],
    }, startedAtRevision: beforeRequest), isTrue);
    expect(displayedScore(overlay, room), 20.5);
    expect(overlay.apply(award('gift_during', 20)), isFalse);
  });

  test('PK cached scores reset when a round ends or is replaced', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    overlay.apply(award('gift_1', 21));
    expect(displayedScore(overlay, room), 10.5);
    expect(displayedScore(overlay, activeRoom('pk_round_1', status: 'finished')), 0);
    expect(displayedScore(overlay, activeRoom('pk_round_2')), 0);
    expect(overlay.roundId, 'pk_round_2');
  });

  test('PK overlay keeps bounded operation identifiers', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    for (var i = 0; i < 275; i++) {
      expect(overlay.apply(award('gift_$i', 2)), isTrue);
    }
    expect(displayedScore(overlay, room), 275);
  });
}
