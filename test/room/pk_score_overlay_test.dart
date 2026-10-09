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

  test('live PK supporter Top3 updates from confirmed gift events', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    Map<String, dynamic> supporterAward(
      String operation,
      String uid,
      int coins,
    ) => <String, dynamic>{
      ...award(operation, coins * 20),
      'supporter': <String, dynamic>{
        'uid': uid,
        'displayName': 'Donor $uid',
        'profileImageUrl': '',
        'coins': coins,
      },
    };
    for (final item in <(String, String, int)>[
      ('op1', 'donor_1', 100),
      ('op2', 'donor_2', 300),
      ('op3', 'donor_3', 200),
      ('op4', 'donor_4', 50),
      ('op5', 'donor_1', 250),
    ]) {
      expect(overlay.apply(supporterAward(item.$1, item.$2, item.$3)), isTrue);
    }
    final pk = overlay.merge(room)['pkState'] as Map;
    final leaders = (pk['supporters'] as List).cast<Map>();
    expect(leaders.map((x) => x['uid']).toList(),
        <String>['donor_1', 'donor_2', 'donor_3']);
    expect(leaders.first['coins'], 350);
    expect(overlay.apply(supporterAward('op5', 'donor_1', 250)), isFalse);
  });

  test('authoritative PK Top3 snapshot rebases new supporter events', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    overlay.apply(<String, dynamic>{
      ...award('before_open', 200),
      'supporter': <String, dynamic>{
        'uid': 'donor_1', 'coins': 100, 'displayName': 'Donor 1',
      },
    });
    final before = overlay.revision;
    overlay.apply(<String, dynamic>{
      ...award('while_loading', 100),
      'supporter': <String, dynamic>{
        'uid': 'donor_1', 'coins': 50, 'displayName': 'Donor 1',
      },
    });
    expect(overlay.installSnapshot(<String, dynamic>{
      'id': 'pk_round_1',
      'status': 'active',
      'participants': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'a', 'score': 100},
      ],
      'supporters': <Map<String, dynamic>>[
        <String, dynamic>{
          'uid': 'donor_1', 'coins': 100, 'displayName': 'Donor 1',
        },
      ],
    }, startedAtRevision: before), isTrue);
    final leaders =
        (overlay.merge(room)['pkState'] as Map)['supporters'] as List;
    expect((leaders.first as Map)['coins'], 150);
  });

  test('mysterious PK supporters keep their masked display identity', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    final realtime = <String, dynamic>{
      ...award('mysterious_gift', 210),
      'supporter': <String, dynamic>{
        'uid': 'masked_user',
        'displayName': 'الشخص الغامض',
        'profileImageUrl': '',
        'mysteriousMode': true,
        'coins': 10,
      },
    };
    expect(overlay.apply(realtime), isTrue);
    final pk = overlay.merge(room)['pkState'] as Map;
    final supporter = (pk['supporters'] as List).first as Map;
    expect(supporter['mysteriousMode'], true);
    expect(supporter['displayName'], 'الشخص الغامض');
    expect(supporter['profileImageUrl'], '');
  });

  test('reconnect installs paid scores without replaying older events', () {
    final overlay = PkScoreOverlay();
    final room = activeRoom('pk_round_1');
    overlay.merge(room);
    expect(overlay.apply(award('old_event', 21)), isTrue);
    final revisionAtStart = overlay.revision;
    expect(overlay.apply(award('during_request', 20)), isTrue);
    expect(overlay.installSnapshot(<String, dynamic>{
      'id': 'pk_round_1',
      'status': 'active',
      'participants': <Map<String, dynamic>>[
        <String, dynamic>{'uid': 'a', 'score': 10.5},
        <String, dynamic>{'uid': 'b', 'score': 0},
      ],
    }, startedAtRevision: revisionAtStart), isTrue);
    expect(displayedScore(overlay, room), 20.5);
    expect(overlay.apply(award('during_request', 20)), isFalse);
    expect(displayedScore(overlay, room), 20.5);
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
