import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final home =
      File('lib/features/home/screens/home_screen.dart').readAsStringSync();

  test('pull, wallet return and login share one bounded request per account',
      () {
    expect(home.contains('Future<void>? _pendingHomeLoad;'), isTrue);
    expect(home.contains('String? _pendingHomeUid;'), isTrue);
    expect(home.contains('final pending = _pendingHomeLoad;'), isTrue);
    expect(
      home.contains(
        'if (pending != null && _pendingHomeUid == requestUid) return pending;',
      ),
      isTrue,
    );
    expect(home.contains('_pendingHomeLoad = operation;'), isTrue);
    expect(home.contains('if (identical(_pendingHomeLoad, operation))'), isTrue);
    expect(home.contains('_pendingHomeLoad = null;'), isTrue);
    expect(home.contains('onRefresh: () => _load(forceRefresh: true)'), isTrue);
    expect(home.contains('if (mounted) await _load();'), isTrue);
    expect(home.contains('Timer.periodic'), isFalse);
    expect(home.contains('Stream.periodic'), isFalse);
  });

  test('late old-account success, failure and completion never overwrite home',
      () {
    expect(home.contains('int _homeLoadRevision = 0;'), isTrue);
    expect(home.contains('final revision = ++_homeLoadRevision;'), isTrue);
    expect(home.contains('revision == _homeLoadRevision'), isTrue);
    expect(
      home.contains('FirebaseAuth.instance.currentUser?.uid == uid'),
      isTrue,
    );
    expect(home.contains('if (!_isCurrentLoad(requestUid, revision)) return;'),
        isTrue);
    expect(home.contains('if (_isCurrentLoad(requestUid, revision))'), isTrue);
    expect(home.contains('revision: revision,'), isTrue);
    expect(home.contains('revision: _homeLoadRevision,'), isTrue);
    // A changed identity clears the prior person's snapshot immediately.
    expect(home.contains('_data = null;'), isTrue);
    expect(home.contains('_eligibleSuggestionIds = null;'), isTrue);
    expect(home.contains('_suggestionRevision++;'), isTrue);
  });

  test('follow read respects the same request revision and existing batch cap',
      () {
    expect(home.contains('people.take(24).toList(growable: false)'), isTrue);
    expect(home.contains('_followService.eligibleDiscoveryPeopleAmong('), isTrue);
    expect(home.contains('_isCurrentLoad(expectedUid, revision)'), isTrue);
    expect(home.contains('_followService.isFollowing('), isFalse);
    // Home uses one shared batch presence lookup for suggested people.
    // It never fetches presence independently for each card.
    expect(home.contains('final RoomRealtimeQueryService _roomFollowQuery'), isTrue);
    expect(home.contains('ids.sublist(offset, end)'), isTrue);
    expect(home.contains('offset += 8'), isTrue);
    expect(home.contains('Timer.periodic'), isFalse);
  });
}
