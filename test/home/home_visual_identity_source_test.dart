import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';
import 'package:voice_chat_room/features/vip/widgets/vip_profile_avatar.dart';

void main() {
  testWidgets('snapshot avatar renders without needing a user ID or a read',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ProfileAvatarWithFrame(
          diameter: 40,
          userId: '',
          snapshotOnly: true,
          fallbackProfile: <String, dynamic>{},
        ),
      ),
    ));
    expect(find.byType(ProfileAvatarWithFrame), findsOneWidget);
    expect(find.byType(CircleAvatar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('VIP GIF is displayed only when the snapshot proves VIP4+ is valid', () {
    final profile = <String, dynamic>{
      'effectiveVipLevel': 4,
      'vipExpiresAt': DateTime.now().add(const Duration(days: 2)),
      'profileAvatarAnimationUrl': 'https://example.invalid/animated.gif',
      'profileImageUrl': 'https://example.invalid/static.png',
    };
    final eligible = effectiveProfileAvatarProvider(profile);
    expect(eligible, isA<NetworkImage>());
    expect((eligible! as NetworkImage).url, endsWith('animated.gif'));

    final expired = effectiveProfileAvatarProvider(<String, dynamic>{
      ...profile,
      'vipExpiresAt': DateTime.now().subtract(const Duration(days: 1)),
    });
    expect(expired, isA<NetworkImage>());
    expect((expired! as NetworkImage).url, endsWith('static.png'));
  });

  test('home and search do not claim online from an unverified profile flag', () {
    final home =
        File('lib/features/home/screens/home_screen.dart').readAsStringSync();
    final service = File('lib/features/home/services/discovery_service.dart')
        .readAsStringSync();
    final search =
        File('lib/features/home/screens/discovery_search_screen.dart')
            .readAsStringSync();

    expect(home.contains('if (person.isOnline)'), isFalse);
    expect(service.contains('if (a.isOnline != b.isOnline)'), isFalse);
    expect(search.contains("if (isOnline)"), isFalse);
    expect(search.contains("person['isOnline'] == true"), isFalse);
    expect(search.contains("b['isOnline'] == true"), isFalse);
    expect(home.contains('final avatarData = <String, dynamic>{'), isTrue);
    expect(home.contains('snapshotOnly: true'), isTrue);
    expect(home.contains('fallbackProfile: avatarData'), isTrue);
    expect(home.contains('ProfileAvatarWithFrame('), isTrue);
    expect(home.contains('ImageProvider? _profileImage()'), isFalse);
  });
}
