import 'dart:io';

import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/profile_visual_identity_service.dart';
import 'package:voice_chat_room/features/vip/widgets/vip_profile_avatar.dart';

void main() {
  test('bundled user avatar wins over a blank URL and legacy photo', () {
    final provider = effectiveProfileAvatarProvider({
      'profileImageUrl': '',
      'profileAvatarAsset': 'assets/avatars/selected.png',
      'photoUrl': 'https://example.com/obsolete.png',
    });
    expect(provider, isA<AssetImage>());
    expect((provider as AssetImage).assetName, 'assets/avatars/selected.png');
  });

  test('legacy photo still renders when no canonical picture exists', () {
    final provider = effectiveProfileAvatarProvider({
      'profileImageUrl': '',
      'photoUrl': 'https://example.com/legacy.png',
    });
    expect(provider, isA<NetworkImage>());
    expect((provider as NetworkImage).url, 'https://example.com/legacy.png');
  });

  test('shared visual identity retains animation and default avatar', () {
    final identity = ProfileVisualIdentity.fromMap('u1', {
      'profileAvatarAsset': 'assets/avatars/default.png',
      'profileAvatarAnimationUrl': 'https://example.com/animation.gif',
    });
    final profile = identity.toProfileMap();
    expect(profile['profileAvatarAsset'], 'assets/avatars/default.png');
    expect(profile['profileAvatarAnimationUrl'],
        'https://example.com/animation.gif');
  });

  test('room supporter and quick profile use one bounded visual resolver', () {
    final room = File('lib/main.dart').readAsStringSync();
    final service =
        File('lib/features/profile/services/profile_visual_identity_service.dart')
            .readAsStringSync();
    final avatar =
        File('lib/features/profile/widgets/profile_avatar_with_frame.dart')
            .readAsStringSync();
    final roomService =
        File('lib/features/room/services/room_insights_service.dart')
            .readAsStringSync();
    final backend =
        File('cloudflare-worker/src/voice-session-legacy.js')
            .readAsStringSync();
    final mirror =
        File('lib/shared/services/firebase_service.dart')
            .readAsStringSync();
    final giftHandler =
        File('cloudflare-worker/src/room-gift.js').readAsStringSync();

    expect(roomService.contains("json['profileAvatarAsset']"), isTrue);
    expect(room.contains("'profileAvatarAsset': supporter.profileAvatarAsset"),
        isTrue);
    expect(avatar.contains('if (hasFreshAvatar)'), isTrue);
    expect(service.contains('if (!hasAvatar) return;'), isTrue);
    expect(service.contains('static const int _batchSize = 10'), isTrue);
    expect(backend.contains('user.profileAvatarAsset||item.profileAvatarAsset'),
        isTrue);
    expect(backend.contains('data.profileAvatarAsset||profile.profileAvatarAsset'),
        isTrue);
    expect(mirror.contains("'profileAvatarAnimationUrl':data['profileAvatarAnimationUrl']"), isTrue);
    expect(backend.contains('return applyMysteriousIdentityPresentation({'),
        isTrue);
    expect(giftHandler.contains('profileAvatarAsset: senderAvatarAsset'),
        isTrue);
    expect(giftHandler.contains('"profileAvatarAsset",'), isTrue);
    expect(backend.contains('profileAvatarAsset:clean(data.profileAvatarAsset)'),
        isTrue);
    expect(backend.contains('item.profileAvatarAsset,'), isTrue);
  });
}
