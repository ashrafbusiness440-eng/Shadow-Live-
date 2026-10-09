import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('active Star Battle Top99 uses one bounded read on explicit request', () {
    final server = File('cloudflare-worker/src/voice-session-legacy.js')
        .readAsStringSync();
    final begin = server.indexOf('async function syncStarBattle(');
    final end = server.indexOf('async function starBattleHistory(', begin);
    expect(begin, greaterThanOrEqualTo(0));
    expect(end, greaterThan(begin));
    final sync = server.substring(begin, end);
    expect(sync.contains('body.includeLeaders===true'), isTrue);
    expect(sync.contains('.orderBy("coins","desc").limit(99).get()'), isTrue);
    expect(sync.contains('displayBattle=normalizeStarBattleState('), isTrue);
    expect(sync.contains('room.starBattleState||{}'), isTrue);
  });

  test('Star Battle sheet reads once per active round and on manual refresh', () {
    final sheet = File('lib/features/room/widgets/star_battle_sheet.dart')
        .readAsStringSync();
    final service = File('lib/features/room/services/star_battle_service.dart')
        .readAsStringSync();
    expect(sheet.contains('value!.id != _loadedLeaderboardRound'), isTrue);
    expect(sheet.contains('_service.loadActiveTop99(widget.roomId)'), isTrue);
    expect(sheet.contains('تحديث أفضل 99 داعمًا'), isTrue);
    expect(sheet.contains('final leaders = _liveRanking?.id == battle?.id'),
        isTrue);
    expect(service.contains("'includeLeaders': true"), isTrue);
    expect(sheet.contains('snapshotOnly: true,'), isTrue);
  });

  test('isolated production gift E2E verifies an active paid Top99', () {
    final e2e = File('cloudflare-worker/scripts/room-gift-e2e.mjs')
        .readAsStringSync();
    expect(e2e.contains('active Star Battle Top99 omitted paid gift score'),
        isTrue);
  });
}
