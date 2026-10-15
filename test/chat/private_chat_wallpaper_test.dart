import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/core/assets/shadow_asset_registry.dart';
import 'package:voice_chat_room/shared/widgets/shadow_global_wallpaper.dart';

void main() {
  test('private chat uses a distinct uploaded wallpaper in one message region', () {
    final registry =
        File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();
    final chat =
        File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    final pubspec = File('pubspec.yaml').readAsStringSync();

    expect(registry.contains("chatWallpaper = 'app.background.chat'"), isTrue);
    expect(
        registry.contains(
            "assets/images/system/shadow_live_chat_wallpaper.png"),
        isTrue);
    expect(
        File('assets/images/system/shadow_live_chat_wallpaper.png')
            .existsSync(),
        isTrue);
    expect(pubspec.contains('    - assets/images/system/'), isTrue);
    expect(chat.contains("ValueKey('private-chat-interior-wallpaper')"),
        isTrue);
    expect(chat.contains('assetKey: ShadowAssetKeys.chatWallpaper'), isTrue);
    expect(chat.contains(
        'bundledAsset: ShadowAssetKeys.chatWallpaperBundledPath'), isTrue);

    // The real conversation stream, ordering, safety and message bubble path
    // remain exactly as before; the wallpaper is only their visual parent.
    expect(chat.contains(".collection('messages')"), isTrue);
    expect(chat.contains(".orderBy('createdAt', descending: true)"), isTrue);
    expect(chat.contains('.limit(100)'), isTrue);
    expect(chat.contains('_messageBubble(docs[index])'), isTrue);
    expect(chat.contains('_blockedComposer()'), isTrue);
    expect(chat.contains('_composer()'), isTrue);
    final interior = chat.indexOf('private-chat-interior-wallpaper');
    final stream = chat.indexOf('StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(', interior);
    final composer = chat.indexOf('if (_loadingSafety)', interior);
    expect(interior, greaterThanOrEqualTo(0));
    expect(stream, greaterThan(interior));
    expect(composer, greaterThan(stream));
  });

  testWidgets('uploaded chat image paints behind interactive message content',
      (tester) async {
    expect(ShadowAssetKeys.chatWallpaper, 'app.background.chat');
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    var tapped = 0;
    final key = GlobalKey();
    await tester.pumpWidget(RepaintBoundary(
      key: key,
      child: MaterialApp(
        home: Scaffold(
          backgroundColor: Colors.transparent,
          body: ShadowGlobalWallpaper(
            assetKey: ShadowAssetKeys.chatWallpaper,
            bundledAsset: ShadowAssetKeys.chatWallpaperBundledPath,
            scrimColor: const Color(0x4405060D),
            resolveUrl: () async => null,
            child: Center(
              child: TextButton(
                onPressed: () => tapped++,
                child: const Text('رسالة تجريبية'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();
    final loaded = await tester.runAsync(() async {
      await precacheImage(
        const AssetImage(
            'assets/images/system/shadow_live_chat_wallpaper.png'),
        key.currentContext!,
      );
      return true;
    });
    expect(loaded, isTrue);
    await tester.pump();

    await tester.tap(find.text('رسالة تجريبية'));
    expect(tapped, 1);

    final colors = await tester.runAsync(() async {
      final boundary = key.currentContext!.findRenderObject()!
          as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 1);
      try {
        final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
        if (data == null) return 0;
        final bytes = data.buffer.asUint8List();
        final palette = <int>{};
        for (var y = 80; y < 720; y += 17) {
          for (var x = 20; x < 380; x += 11) {
            final offset = (y * image.width + x) * 4;
            palette.add(
              (bytes[offset] << 16) |
                  (bytes[offset + 1] << 8) |
                  bytes[offset + 2],
            );
          }
        }
        return palette.length;
      } finally {
        image.dispose();
      }
    });
    expect(colors, greaterThan(18),
        reason: 'Chat backdrop should show actual pattern details, '
            'not a flat dark color.');
  });
}
