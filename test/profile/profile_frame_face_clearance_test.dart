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

  testWidgets('equipped profile frames retain their complete ornament',
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
        isFalse,
      );
      // Asset resolution may render a placeholder on the first pump;
      // the shared source guard below verifies the inset geometry.
      expect(find.byType(CircleAvatar), findsOneWidget);
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

  test('only public and own large headers use full-frame avatar inset', () {
    final own = File('lib/features/user/screens/profile_screen.dart')
        .readAsStringSync();
    final pub = File('lib/features/profile/screens/public_profile_screen.dart')
        .readAsStringSync();
    final shared = File('lib/features/profile/widgets/profile_avatar_with_frame.dart')
        .readAsStringSync();
    expect(own.contains('diameter: 102,\n                    frameScale: 1.12,\n                    protectAvatarCenter: true,'), isTrue);
    expect(pub.contains('diameter: 110,\n            protectAvatarCenter: true,'), isTrue);
    expect(shared.contains('AnimatedProfileFrameVisual('), isTrue);
    expect(shared.contains('fit: BoxFit.contain'), isTrue);
    expect(shared.contains('scale: widget.protectAvatarCenter ? .82 : 1.0'), isTrue);
    expect(shared.contains('VipAvatarFrame('), isTrue);
    expect(shared.contains('protectAvatarCenter: widget.protectAvatarCenter'), isTrue);
    expect(shared.contains('FirebaseFirestore'), isFalse);
    expect(shared.contains('Timer.periodic'), isFalse);
    expect(own.contains('colors: [Color(0xFFFFC84A), Color(0xFF8A3DFF)]'), isFalse);
  });
}
