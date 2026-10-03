import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('legacy generic user level is quarantined from active profile surfaces', () {
    final firebase = File('lib/shared/services/firebase_service.dart').readAsStringSync();
    final publicProfile = File('lib/features/profile/screens/public_profile_screen.dart').readAsStringSync();
    final quickProfile = File('lib/features/profile/widgets/quick_profile_sheet.dart').readAsStringSync();
    final control = File('lib/main_control.dart').readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();

    expect(firebase.contains("'level':data['level']"), isFalse);
    expect(
      rules.contains('request.resource.data.level == source.get(\'level\', 0)'),
      isFalse,
    );
    expect(
      rules.contains("'interests','level','vipLevel'"),
      isFalse,
    );
    expect(publicProfile.contains("data['level']"), isFalse);
    expect(publicProfile.contains('ShadowAssetKeys.levelBadge'), isFalse);
    expect(quickProfile.contains("data['level']"), isFalse);
    expect(quickProfile.contains("'level.badge.'"), isFalse);

    expect(control.contains("data['popularity']"), isFalse);
    expect(control.contains("data['popularityLevel']"), isFalse);
    expect(control.contains("data['wealth']"), isFalse);
    expect(control.contains("data['wealthLevel']"), isFalse);
    expect(control.contains("data['level'],profile['level']"), isFalse);
  });

  test('ordinary profile reads do not write public profile', () {
    final firebase =
        File('lib/shared/services/firebase_service.dart').readAsStringSync();
    final start = firebase.indexOf(
      'Future<Map<String,dynamic>?> getUserProfile',
    );
    final end = firebase.indexOf(
      'Future<void> updateUserProfile',
      start,
    );
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final getUserProfileSource = firebase.substring(start, end);
    expect(getUserProfileSource.contains('_syncPublicProfile'), isFalse);
  });

  test('legacy Lv100 policy and generic level asset key cannot return', () {
    final policy = File('lib/admin/control_user_level.dart').readAsStringSync();
    final vip = File('lib/admin/control_vip.dart').readAsStringSync();
    final assets = File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();

    expect(policy.contains('maxLevel=100'), isFalse);
    expect(policy.contains('maxLevel = 100'), isFalse);
    expect(policy.contains("'level'"), isTrue);
    expect(vip.contains('hideWealth'), isFalse);
    expect(vip.contains('hidePopularity'), isFalse);
    expect(vip.contains('hideUserLevel'), isFalse);
    expect(assets.contains('levelBadge('), isFalse);
  });
}
