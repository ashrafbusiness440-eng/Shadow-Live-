import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room bootstrap Top3 uses the existing visibility/privacy policy', () {
    final source = File('cloudflare-worker/src/voice-session-legacy.js')
        .readAsStringSync();
    final start = source.indexOf('async function roomBootstrap(');
    final end = source.indexOf('async function setRoomFollow(', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final bootstrap = source.substring(start, end);
    expect(
      bootstrap.contains(
        'const visibleSupporters=await filterSupporterRankingVisibility(',
      ),
      isTrue,
    );
    expect(bootstrap.contains('supporters:visibleSupporters,'), isTrue);
    expect(
      source.contains('return filterHiddenSupporters(list,byUid,viewerUid)'),
      isTrue,
    );
    expect(source.contains('applyMysteriousIdentityPresentation('), isTrue);
  });

  test('isolated production E2E requires sanitized Top3 with paid support', () {
    final e2e = File('cloudflare-worker/scripts/room-gift-e2e.mjs')
        .readAsStringSync();
    expect(
      e2e.contains('room bootstrap Top3 missing paid sender support'),
      isTrue,
    );
  });
}
