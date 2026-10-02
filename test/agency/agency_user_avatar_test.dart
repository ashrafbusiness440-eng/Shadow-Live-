import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/agency/widgets/agency_user_avatar.dart';

void main() {
  test('agency avatar prefers network image over bundled avatar', () {
    final provider = agencyUserAvatarProvider(
      imageUrl: 'https://example.invalid/profile.webp',
      avatarAsset: 'assets/images/avatars/male_1.png',
    );

    expect(provider, isA<NetworkImage>());
  });

  test('agency avatar falls back to bundled avatar asset', () {
    final provider = agencyUserAvatarProvider(
      avatarAsset: 'assets/images/avatars/female_1.png',
    );

    expect(provider, isA<AssetImage>());
  });

  test('agency avatar returns null when no image exists', () {
    expect(agencyUserAvatarProvider(), isNull);
  });
}
