import 'dart:io';

import 'package:flutter/material.dart';
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
}
