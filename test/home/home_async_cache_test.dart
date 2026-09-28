import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/home_async_cache.dart';

void main() {
  test('returns cached value while TTL is active', () async {
    var now = DateTime(2026, 9, 28, 12);
    var calls = 0;
    final cache = AsyncTtlCache<int>(
      ttl: const Duration(seconds: 30),
      clock: () => now,
    );

    Future<int> load() async => ++calls;

    expect(await cache.get(load), 1);
    expect(await cache.get(load), 1);
    expect(calls, 1);

    now = now.add(const Duration(seconds: 31));
    expect(await cache.get(load), 2);
    expect(calls, 2);
  });

  test('deduplicates concurrent loads', () async {
    final completer = Completer<int>();
    var calls = 0;
    final cache = AsyncTtlCache<int>(ttl: const Duration(seconds: 30));

    Future<int> load() {
      calls += 1;
      return completer.future;
    }

    final first = cache.get(load);
    final second = cache.get(load, forceRefresh: true);

    expect(calls, 1);
    completer.complete(7);
    expect(await first, 7);
    expect(await second, 7);
  });

  test('force refresh bypasses a fresh cached value', () async {
    var calls = 0;
    final cache = AsyncTtlCache<int>(ttl: const Duration(minutes: 1));

    Future<int> load() async => ++calls;

    expect(await cache.get(load), 1);
    expect(await cache.get(load, forceRefresh: true), 2);
    expect(calls, 2);
  });

  test('failed load is not cached', () async {
    var calls = 0;
    final cache = AsyncTtlCache<int>(ttl: const Duration(minutes: 1));

    Future<int> load() async {
      calls += 1;
      if (calls == 1) throw StateError('first failure');
      return 9;
    }

    await expectLater(cache.get(load), throwsStateError);
    expect(await cache.get(load), 9);
    expect(calls, 2);
  });
}
