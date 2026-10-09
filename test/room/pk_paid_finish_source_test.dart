import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('PK expiration settles score docs and Top3 without per-gift room writes', () {
    final server = File('cloudflare-worker/src/voice-session-legacy.js')
        .readAsStringSync();
    expect(server.contains('async function loadPkPaidRoundScores('), isTrue);
    expect(server.contains('const scoreRows=paths.length?await db.client.getMany(paths):[];'), isTrue);
    expect(server.contains('.collection("supporters").orderBy("coins","desc").limit(3).get();'), isTrue);
    expect(server.contains('next={...next,status:"finalizing"};'), isTrue);
    expect(server.contains('const decision=pkRoundDecision('), isTrue);
    expect(server.contains('status:"finished"'), isTrue);
    expect(server.contains('winner:decision.winner,'), isTrue);
  });

  test('PK isolated gift E2E checks paid live scoreboard and finish', () {
    final e2e = File('cloudflare-worker/scripts/room-gift-e2e.mjs')
        .readAsStringSync();
    expect(e2e.contains('PK live snapshot missing settled paid scores and Top3'), isTrue);
    expect(e2e.contains('PK final winner or supporter was not settled from paid gifts'), isTrue);
    expect(e2e.contains('PK finished paid winner was not persisted'), isTrue);
  });
}
