import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';
import 'package:voice_chat_room/features/vip/widgets/vip_avatar_frame.dart';

void main() {
  test('transparent frame center does not cover the face but retains outer art', () {
    const clipper = AvatarFrameClearCenterClipper(avatarDiameter: 102);
    const size = Size(114.24, 114.24);
    final shape = clipper.getClip(size);
    expect(shape.contains(const Offset(57.12, 57.12)), isFalse);
    expect(shape.contains(const Offset(4, 4)), isTrue);
    expect(clipper.shouldReclip(const AvatarFrameClearCenterClipper(
      avatarDiameter: 102,
    )), isFalse);
    expect(clipper.shouldReclip(const AvatarFrameClearCenterClipper(
      avatarDiameter: 96,
    )), isTrue);
  });

  testWidgets('only opted-in equipped frames protect the face',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 700));
      await tester.pumpWidget(
        const MaterialApp(
          home: Scaffold(
            body: Center(
              child: ProfileAvatarWithFrame(
                diameter: 102,
                frameScale: 1.12,
                protectAvatarCenter: true,
                snapshotOnly: true,
                userId: 'person',
                fallbackProfile: <String, dynamic>{
                  'activeProfileFrameAssetKey': 'custom.frame',
                  'activeProfileFramePermanent': true,
                },
              ),
            ),
          ),
        ),
      );
      final clippers = tester.widgetList<ClipPath>(find.byType(ClipPath));
      expect(
        clippers.any((clip) =>
            clip.clipper is AvatarFrameClearCenterClipper),
        isTrue,
      );
      expect(find.byType(CircleAvatar), findsOneWidget);
      // The portrait is inset below the ring; the outer artwork is painted
      // after the avatar in the shared frame Stack.
      expect(
        tester.getSize(find.byType(CircleAvatar)).width,
        lessThan(102 * 0.84),
      );
      final imageCenter = tester.getCenter(find.byType(CircleAvatar));
      final frameCenter = tester.getCenter(find.byType(ProfileAvatarWithFrame));
      expect(imageCenter.dy, greaterThan(frameCenter.dy));
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('VIP fallback uses the same center-safe clipping if requested',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: VipAvatarFrame(
            vipLevel: 10,
            avatarDiameter: 96,
            protectAvatarCenter: true,
            resolveUri: (_) async => null,
            child: const CircleAvatar(radius: 48),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(
      tester.widgetList<ClipPath>(find.byType(ClipPath)).any(
        (clip) => clip.clipper is AvatarFrameClearCenterClipper,
      ),
      isTrue,
    );
  });

  test('all profile headers opt into the face cutout without extra IO', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final pub = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
    final quick = File('lib/features/profile/widgets/quick_profile_sheet.dart')
        .readAsStringSync();
    final shared = File('lib/features/profile/widgets/profile_avatar_with_frame.dart')
        .readAsStringSync();
    expect(own.contains('diameter: 102,\n                    frameScale: 1.12,\n                    protectAvatarCenter: true,'), isTrue);
    expect(pub.contains('diameter: 110,\n            protectAvatarCenter: true,'), isTrue);
    expect(quick.contains('diameter: 96,\n                      protectAvatarCenter: true,'), isTrue);
    expect(shared.contains('widget.diameter * 0.11'), isTrue);
    expect(shared.contains('widget.diameter * 0.025'), isTrue);
    expect(shared.contains('child: _framedAvatar(profile)'), isTrue);
    final overlay = shared.substring(shared.indexOf('if (_frameActive('),
        shared.indexOf('if (widget.useVipFallback'));
    expect(overlay.indexOf('            avatar,'),
        lessThan(overlay.indexOf('Positioned.fill(')));

    expect(shared.contains('AnimatedProfileFrameVisual('), isTrue);
    expect(shared.contains('VipAvatarFrame('), isTrue);
    expect(shared.contains('protectAvatarCenter: widget.protectAvatarCenter'), isTrue);
    expect(shared.contains('FirebaseFirestore'), isFalse);
    expect(shared.contains('Timer.periodic'), isFalse);
    expect(own.contains('colors: [Color(0xFFFFC84A), Color(0xFF8A3DFF)]'), isFalse);
  });
}
