import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_compact_header_identity.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_identity_info_line.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_identity_status_strip.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_wallet_overlay.dart';

void noop() {}

void main() {
  testWidgets('capture actual rendered profile header widgets at four phone widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final folder = Directory('profile-visual-qa')..createSync(recursive: true);
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 750));
      await tester.pumpWidget(MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: ThemeData.dark(useMaterial3: true),
        home: Scaffold(
          backgroundColor: const Color(0xFF070C16),
          body: RepaintBoundary(
            key: const Key('profile-screenshot-boundary'),
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  const DecoratedBox(decoration: BoxDecoration(
                    gradient: RadialGradient(
                      center: Alignment(0, -0.4), radius: 1.3,
                      colors: [Color(0xFF4B196E), Color(0xFF1C1236), Color(0xFF070D19)],
                    ),
                  )),
                  Column(children: [
                    SizedBox(height: 380, child: Stack(children: [
                      Column(children: [
                    const SizedBox(height: 56, child: Row(children: [
                      SizedBox(width: 8),
                      Text('Shadow Live', style: TextStyle(fontSize: 21, color: Color(0xFFFFD54A), fontWeight: FontWeight.w900)),
                      Spacer(),
                      Icon(Icons.edit_rounded), SizedBox(width: 12),
                      Icon(Icons.settings_rounded), SizedBox(width: 14),
                    ])),
                    const Spacer(),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(18, 0, 18, 14),
                      child: ProfileCompactHeaderIdentity(
                        portraitHeight: 116,
                        portrait: Stack(alignment: Alignment.center, children: [
                          Container(width: 114, height: 114, decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(width: 6, color: const Color(0xFFFFC857)),
                          )),
                          const ProfileAvatarWithFrame(
                            diameter: 102, frameScale: 1.12,
                            protectAvatarCenter: true, snapshotOnly: true,
                            userId: 'visual-fixture',
                          ),
                        ]),
                        name: const Text('SHADOW', textAlign: TextAlign.center,
                          style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
                        identityId: ProfileIdentityInfoLine(
                          id: '010', location: '', onCopy: noop,
                        ),
                        identityStatus: ProfileIdentityStatusStrip(
                          membershipDays: 49, wealthLevel: 0,
                          attractionLevel: 0, vipLevel: 10,
                          location: 'سيشل', gender: 'ذكر',
                          onLevelTap: (_) {}, onVipTap: noop,
                        ),
                      ),
                    ),
                    const Padding(
                      padding: EdgeInsets.only(bottom: 12),
                      child: Text('🔥 👑 المالك', style: TextStyle(fontSize: 12)),
                    ),
                  ]),
                  const Positioned(left: 12, top: 70, child: ProfileWalletOverlay(
                    coins: 650300000, diamonds: 956,
                    onCoinsTap: noop, onDiamondsTap: noop,
                  )),
                  ])),
                  const SizedBox(height: 45,
                    child: Center(child: Text('حول             الغرف             الهدايا'))),
                  const SizedBox(height: 120, child: Center(
                    child: Text('المتابعون       أتابع       غرف       هدايا'),
                  )),
                  ]),
                ],
              ),
            ),
          ),
        ),
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 150));
      final group = tester.getRect(find.byKey(const Key('profile-compact-header-identity')));
      final portrait = tester.getRect(find.byKey(const Key('profile-header-portrait')));
      final name = tester.getRect(find.byKey(const Key('profile-header-name')));
      final id = tester.getRect(find.byKey(const Key('profile-header-id')));
      final status = tester.getRect(find.byKey(const Key('profile-header-status')));
      expect(group.height, lessThan(230));
      expect((portrait.center.dx - name.center.dx).abs(), lessThan(1));
      expect((name.center.dx - id.center.dx).abs(), lessThan(1));
      expect((id.center.dx - status.center.dx).abs(), lessThan(1));
      expect(tester.takeException(), isNull);
      final boundary = tester.renderObject<RenderRepaintBoundary>(
          find.byKey(const Key('profile-screenshot-boundary')));
      // Engine image encoding is real async work. Fake async can stall here
      // indefinitely; run only raster readback outside tester's fake clock.
      final pngBytes = await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1.4);
        final png = await image.toByteData(format: ui.ImageByteFormat.png);
        return png?.buffer.asUint8List();
      });
      expect(pngBytes, isNotNull);
      final label = width.toInt().toString();
      File(folder.path + '/profile-' + label + 'px.png')
          .writeAsBytesSync(pngBytes!);
      File(folder.path + '/profile-' + label + 'px-geometry.txt').writeAsStringSync(
        'portrait=' + portrait.toString() + '\nname=' + name.toString()
        + '\nid=' + id.toString() + '\nstatus=' + status.toString()
        + '\ngroup=' + group.toString(),
      );
    }
  });
}