import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';
import 'package:voice_chat_room/features/vip/widgets/vip_profile_avatar.dart';

void main() {
  testWidgets('broken avatar asset retains an Arabic-app friendly placeholder',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      await tester.pumpWidget(const MaterialApp(
        home: Scaffold(
          body: ProfileAvatarWithFrame(
            diameter: 44,
            userId: 'sample',
            snapshotOnly: true,
            fallbackProfile: <String, dynamic>{
              'profileAvatarAsset': 'assets/avatars/missing_placeholder_test.png',
            },
          ),
        ),
      ));
      await tester.pumpAndSettle();
      final circle = tester.widget<CircleAvatar>(find.byType(CircleAvatar));
      expect(circle.foregroundImage, isA<AssetImage>());
      expect(circle.onForegroundImageError, isNotNull);
      expect(find.byIcon(Icons.person_rounded), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  test('avatar fallback does not change VIP4 eligibility or frame rules', () {
    final src = File(
      'lib/features/profile/widgets/profile_avatar_with_frame.dart',
    ).readAsStringSync();
    expect(src.contains('foregroundImage: provider'), isTrue);
    expect(src.contains('onForegroundImageError:'), isTrue);
    expect(src.contains('backgroundImage: provider'), isFalse);
    expect(src.contains('effectiveProfileAvatarProvider(profile)'), isTrue);
    expect(src.contains('AnimatedProfileFrameVisual('), isTrue);
    expect(src.contains('if (_frameActive(profile))'), isTrue);
    expect(src.contains('if (widget.snapshotOnly) return _render(fallback);'),
        isTrue);

    final allowed = effectiveProfileAvatarProvider(<String, dynamic>{
      'profileImageUrl': 'https://example.invalid/static.webp',
      'profileAvatarAnimationUrl': 'https://example.invalid/moving.gif',
      'effectiveVipLevel': 4,
      'vipExpiresAt': DateTime.now().add(const Duration(days: 1)),
    });
    expect((allowed! as NetworkImage).url, endsWith('moving.gif'));
    final expired = effectiveProfileAvatarProvider(<String, dynamic>{
      'profileImageUrl': 'https://example.invalid/static.webp',
      'profileAvatarAnimationUrl': 'https://example.invalid/moving.gif',
      'effectiveVipLevel': 4,
      'vipExpiresAt': DateTime.now().subtract(const Duration(days: 1)),
    });
    expect((expired! as NetworkImage).url, endsWith('static.webp'));
  });
}
