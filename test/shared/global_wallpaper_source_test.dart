import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/shadow_global_wallpaper.dart';

void main() {
  test('single canonical asset key and bundled path are wired once', () {
    final registry =
        File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();
    final wallpaper = File('lib/shared/widgets/shadow_global_wallpaper.dart')
        .readAsStringSync();
    final pubspec = File('pubspec.yaml').readAsStringSync();
    expect(registry.contains("globalWallpaper = 'app.background.global'"),
        isTrue);
    expect(
      registry.contains(
        "assets/images/system/shadow_live_global_wallpaper.webp",
      ),
      isTrue,
    );
    expect(
      File('assets/images/system/shadow_live_global_wallpaper.webp')
          .existsSync(),
      isTrue,
    );
    expect(pubspec.contains('    - assets/images/system/'), isTrue);
    expect(wallpaper.contains('ShadowAssetRegistry.remoteUrl('), isTrue);
    expect(wallpaper.contains('WidgetsBindingObserver'), isTrue);
    expect(wallpaper.contains('Duration(minutes: 5)'), isTrue);
    expect(wallpaper.contains('errorBuilder: (_, __, ___) => _bundledImage()'),
        isTrue);
  });

  test('wallpaper lives at app roots and ignores custom room artwork', () {
    final live = File('lib/main.dart').readAsStringSync();
    final control = File('lib/main_control.dart').readAsStringSync();
    final home = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    final room = File('lib/main.dart').readAsStringSync();
    expect(live.contains('builder: (context, child) => ShadowGlobalWallpaper('),
        isTrue);
    expect(control.contains(
        'builder: (context, child) => ShadowGlobalWallpaper('), isTrue);
    expect(home.contains('backgroundColor: Colors.transparent'), isTrue);
    expect(room.contains("import 'features/room/services/room_image_source.dart';"), isTrue);
  });

  testWidgets('global wallpaper does not block foreground interactions',
      (tester) async {
    var taps = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: ShadowGlobalWallpaper(
          resolveUrl: () async => null,
          child: Scaffold(
            backgroundColor: Colors.transparent,
            body: Center(
              child: TextButton(
                onPressed: () => taps++,
                child: const Text('اختبر اللمس'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pump();
    expect(find.text('اختبر اللمس'), findsOneWidget);
    await tester.tap(find.text('اختبر اللمس'));
    expect(taps, 1);
  });
  testWidgets('visible wallpaper pixels survive transparent Navigator route',
      (tester) async {
    tester.view.physicalSize = const Size(400, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final boundaryKey = GlobalKey();
    await tester.pumpWidget(
      RepaintBoundary(
        key: boundaryKey,
        child: MaterialApp(
          builder: (context, child) => ShadowGlobalWallpaper(
            resolveUrl: () async => null,
            child: child ?? const SizedBox.shrink(),
          ),
          home: const Scaffold(
            backgroundColor: Colors.transparent,
            body: SizedBox.expand(),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Image encoding uses real engine callbacks. Read it outside the
    // widget tester fake-async zone to avoid deadlocking the whole CI run.
    final colorCount = await tester.runAsync(() async {
      final boundary = boundaryKey.currentContext!.findRenderObject()!
          as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 1);
      try {
        final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
        if (data == null) return 0;
        final pixels = data.buffer.asUint8List();
        final colors = <int>{};
        for (var y = 80; y < 720; y += 17) {
          for (var x = 20; x < 380; x += 11) {
            final index = (y * image.width + x) * 4;
            colors.add((pixels[index] << 16) |
                (pixels[index + 1] << 8) |
                pixels[index + 2]);
          }
        }
        return colors.length;
      } finally {
        image.dispose();
      }
    });
    expect(colorCount, isNotNull);
    expect(colorCount!, greaterThan(18),
        reason: 'Pattern must actually paint behind the route; a flat dark '
            'Scaffold or stale loading fallback is not sufficient.');
  });

}
