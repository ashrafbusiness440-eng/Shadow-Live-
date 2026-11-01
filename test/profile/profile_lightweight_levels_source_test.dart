import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('own and public profile use only the existing shared level icon renderer', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final publicProfile =
        File('lib/features/profile/screens/public_profile_screen.dart')
            .readAsStringSync();
    final shared = File('lib/features/profile/widgets/user_level_badges.dart')
        .readAsStringSync();

    final strip = File('lib/features/profile/widgets/profile_identity_status_strip.dart')
        .readAsStringSync();
    for (final source in [own, publicProfile]) {
      expect(source.contains('ProfileIdentityStatusStrip('), isTrue);
    }
    expect(strip.contains('UserLevelBadges.fromLevels('), isTrue);
    expect(strip.contains('iconOnly: true,'), isTrue);
    expect(strip.contains('gameLevel: 0,'), isTrue);
    expect(shared.contains('ShadowAssetKeys.levelMiniBadge('), isTrue);
    expect(shared.contains('if (iconOnly) {'), isTrue);
    expect(shared.contains('semanticsLabel: label'), isTrue);
    expect(shared.contains('constraints: const BoxConstraints(minHeight: 44, minWidth: 48)'), isTrue);
    // The profile header only changes presentation, not data acquisition.
    expect(shared.contains('FirebaseFirestore'), isFalse);
    expect(shared.contains('StreamBuilder'), isFalse);
    expect(shared.contains('Timer.periodic'), isFalse);
    expect(publicProfile.contains('future: _levelFuture'), isTrue);
  });
}
