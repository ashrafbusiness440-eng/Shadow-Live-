import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('public and quick profiles never claim online from legacy profile data', () {
    for (final path in <String>[
      'lib/features/profile/screens/public_profile_screen.dart',
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ]) {
      final source = File(path).readAsStringSync();
      // A public_profiles.isOnline flag is not a verified live server lease.
      expect(source.contains("data['isOnline'] == true"), isFalse, reason: path);
      expect(source.contains('if (online)'), isFalse, reason: path);
      expect(source.contains('ProfileAvatarWithFrame('), isTrue,
          reason: 'Keep the shared frame and avatar for $path');
      expect(source.contains('useVipFallback: true'), isTrue,
          reason: 'VIP effects remain unchanged for $path');
      expect(source.contains('ShadowProfileCountryFlag('), isTrue,
          reason: 'Keep unified country flag for $path');
      expect(source.contains('Timer.periodic'), isFalse, reason: path);
    }
  });

  test('presence changes do not add profile lookups or affect user identity', () {
    final public = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quick = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();

    expect(public.contains("key: const Key('public-profile-copy-id')"), isTrue);
    expect(quick.contains("key: const Key('quick-profile-copy-id')"), isTrue);
    expect(quick.contains('showQuickProfileSheet('), isTrue);
    expect(public.contains('Stream.periodic'), isFalse);
    expect(quick.contains('Stream.periodic'), isFalse);
    // The existing snapshots and shared identity service remain unchanged.
    expect(public.contains('future: _profileFuture'), isTrue);
    expect(quick.contains('future: _profileFuture'), isTrue);
  });
}
