import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('paid gifts atomically credit active Star Battle rounds', () {
    final source = File('cloudflare-worker/src/room-gift.js').readAsStringSync();
    expect(source.contains('const earnsStarBattleCoins ='), isTrue);
    expect(source.contains('paidRecipientCost > 0 &&'), isTrue);
    expect(source.contains('round?.status === "active"'), isTrue);
    expect(source.contains('Number(round.endsAtMs || 0) > nowMs'), isTrue);
    expect(source.contains('if (starBattleAward) {'), isTrue);
    expect(source.contains('db.increment("coins", paidRecipientCost)'), isTrue);
    expect(source.contains('"/star_battle_scores/"'), isTrue);
    expect(source.contains('await db.commit(transaction, writes);'), isTrue);
    expect(source.contains('starBattleAward,'), isTrue);
  });

  test('isolated gift E2E verifies round credits and idempotency', () {
    final e2e =
        File('cloudflare-worker/scripts/room-gift-e2e.mjs').readAsStringSync();
    expect(e2e.contains('const starBattleId='), isTrue);
    expect(e2e.contains('const scoreSnapshot=await fsGet(starBattleScorePath);'), isTrue);
    expect(e2e.contains('const scoreAfterDuplicate=await fsGet(starBattleScorePath);'), isTrue);
    expect(e2e.contains('Star Battle realtime gift score mismatch'), isTrue);
  });
}
