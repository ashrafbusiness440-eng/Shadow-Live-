import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Star Battle closes score window before one-off Top99 archive', () {
    final server = File(
      'cloudflare-worker/src/voice-session-legacy.js',
    ).readAsStringSync();
    expect(server.contains('status:"finalizing"'), isTrue);
    expect(server.contains('room.starBattleState?.status==="finalizing"'), isTrue);
    expect(server.contains('.orderBy("coins","desc").limit(99).get()'), isTrue);
    expect(server.contains('const leaderSource=Array.isArray(raw.leaders)'), isTrue);
    expect(server.contains('tx.set(historyRef,{...result'), isTrue);
    expect(server.contains('["active","finalizing"].includes('), isTrue);
  });

  test('isolated production room gift coverage asserts archived paid stars', () {
    final e2e = File('cloudflare-worker/scripts/room-gift-e2e.mjs')
        .readAsStringSync();
    expect(e2e.contains('action:"finishStarBattle"'), isTrue);
    expect(e2e.contains('finished Star Battle did not capture paid Top99 leader'),
        isTrue);
    expect(e2e.contains('Star Battle paid leaderboard was not archived'),
        isTrue);
    expect(e2e.contains('star_battle_history/'), isTrue);
    expect(e2e.contains('star_battle_finish_'), isTrue);
  });
}
