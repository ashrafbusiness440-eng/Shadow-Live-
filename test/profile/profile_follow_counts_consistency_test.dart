import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('own and public profiles use the exact same existing follows aggregate', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final publicProfile =
        File('lib/features/profile/screens/public_profile_screen.dart')
            .readAsStringSync();
    final follow = File('lib/features/profile/services/follow_service.dart')
        .readAsStringSync();

    expect(follow.contains("collection('follows')"), isTrue);
    expect(follow.contains(".where('followingUid', isEqualTo: userId).count().get()"), isTrue);
    expect(follow.contains(".where('followerUid', isEqualTo: userId).count().get()"), isTrue);

    expect(own.contains('final FollowService _followService = FollowService();'), isTrue);
    expect(own.contains('_followCountsFuture = _followService.counts(uid);'), isTrue);
    expect(own.contains('FutureBuilder<FollowCounts>('), isTrue);
    expect(own.contains("counts == null ? '—' : formatCompactAmount(counts.followers)"), isTrue);
    expect(own.contains("counts == null ? '—' : formatCompactAmount(counts.following)"), isTrue);
    expect(own.contains("['followersCount', 'followers']"), isFalse);
    expect(own.contains("['followingCount', 'following']"), isFalse);

    expect(publicProfile.contains('_followCountsFuture = _follow.counts(widget.userId);'), isTrue);
    expect(publicProfile.contains('future: _followCountsFuture,'), isTrue);
    expect(publicProfile.contains('future: _follow.counts(userId),'), isFalse);
  });

  test('follow counts remain scoped to an account and avoid rebuild amplification', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final publicProfile =
        File('lib/features/profile/screens/public_profile_screen.dart')
            .readAsStringSync();
    expect(own.contains('if (_followCountsFuture == null || _followCountsUid != uid)'), isTrue);
    expect(own.contains('_followCountsFuture = null;'), isTrue);
    expect(own.contains('_followCountsUid = null;'), isTrue);
    expect(own.contains('return _followCountsFuture!;'), isTrue);
    expect(publicProfile.contains('if (oldWidget.userId != widget.userId)'), isTrue);
    expect(publicProfile.contains('_loadProfileFutures();'), isTrue);
    expect(own.contains('Timer.periodic('), isFalse);
    expect(publicProfile.contains('Timer.periodic('), isFalse);
  });
}
