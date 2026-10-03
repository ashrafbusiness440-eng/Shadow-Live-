import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('legacy level data migration stays bounded and scoped', () {
    final script = File(
      'cloudflare-worker/scripts/migrate-legacy-user-level-data.mjs',
    ).readAsStringSync();

    expect(script.contains('const PAGE_SIZE = 100;'), isTrue);
    expect(script.contains('const MAX_PAGES_PER_COLLECTION = 50;'), isTrue);
    expect(script.contains('["users", "public_profiles"]'), isTrue);

    for (final field in const [
      '"level"',
      '"userLevel"',
      '"memberLevel"',
      '"popularity"',
      '"popularityLevel"',
      '"wealth"',
      '"wealthLevel"',
    ]) {
      expect(script.contains(field), isTrue, reason: field);
    }

    expect(script.contains('"roomLevel"'), isFalse);
    expect(script.contains('"vipLevel"'), isFalse);
    expect(script.contains('while (true)'), isFalse);
    expect(script.contains('unbounded scan'), isTrue);
  });
}
