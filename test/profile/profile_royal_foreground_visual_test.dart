import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';
import 'package:voice_chat_room/features/vip/widgets/vip_profile_identity.dart';

void main() {
  testWidgets('the royal decoration is always below identity and wallet controls',
      (tester) async {
    for (final level in <int>[0, 5, 10]) {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: SizedBox(
            width: 390,
            height: 386,
            child: VipProfileIdentitySurface(
              vipLevel: level,
              child: const ColoredBox(
                key: Key('royal-background'),
                color: Color(0xFF171022),
              ),
              foreground: Center(
                child: TextButton(
                  key: const Key('royal-identity-foreground'),
                  onPressed: () {},
                  child: const Text('SHADOW'),
                ),
              ),
            ),
          ),
        ),
      ));
      final stack = find.descendant(
        of: find.byType(VipProfileIdentitySurface),
        matching: find.byType(Stack),
      ).first;
      final layers = tester.widget<Stack>(stack).children;
      expect(layers.last, isA<Positioned>());
      final positioned = layers.last as Positioned;
      expect(
        positioned.child,
        isA<Center>(),
      );
      expect(find.byKey(const Key('royal-identity-foreground')), findsOneWidget);
      expect(tester.takeException(), isNull);
    }
  });

  testWidgets('face is moved within a stationary frame window', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Center(
          child: ProfileAvatarWithFrame(
            diameter: 102,
            frameScale: 1.12,
            protectAvatarCenter: true,
            snapshotOnly: true,
            userId: 'frame-fixture',
            fallbackProfile: <String, dynamic>{
              'activeProfileFrameAssetKey': 'custom.visual.test',
              'activeProfileFramePermanent': true,
            },
          ),
        ),
      ),
    ));
    final frame = tester.getCenter(find.byType(ProfileAvatarWithFrame));
    final window = tester.getCenter(find.byType(ClipOval).first);
    final photo = tester.getCenter(find.byType(CircleAvatar).first);
    expect((frame.dy - window.dy).abs(), lessThan(1));
    expect(photo.dy, greaterThan(window.dy));
    expect(
      tester.getSize(find.byType(CircleAvatar)).width,
      greaterThan(102 * 0.8),
    );
    expect(
      tester.getSize(find.byType(CircleAvatar)).width,
      lessThan(102 * 0.84),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('no frame still shows a full-sized portrait', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ProfileAvatarWithFrame(
          diameter: 102,
          userId: 'unframed-fixture',
          snapshotOnly: true,
          protectAvatarCenter: true,
        ),
      ),
    ));
    expect(find.byType(ClipOval), findsNothing);
    expect(tester.getSize(find.byType(CircleAvatar)).width, closeTo(102, 0.1));
    expect(tester.takeException(), isNull);
  });

  test('foreground layer remains explicit on the two full-profile screens', () {
    final own = File('lib/features/user/screens/profile_screen.dart').readAsStringSync();
    final other = File('lib/features/profile/screens/public_profile_screen.dart').readAsStringSync();
    expect(own, contains('foreground: Stack('));
    expect(other, contains('foreground: Padding('));
  });
}
