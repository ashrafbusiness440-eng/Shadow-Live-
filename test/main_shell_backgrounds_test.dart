import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/core/assets/shadow_asset_registry.dart';
import 'package:voice_chat_room/shared/widgets/shadow_global_wallpaper.dart';

void main() {
  test('one Asset Studio key and bundled image for all six bottom tabs', () {
    final registry =
        File('lib/core/assets/shadow_asset_registry.dart').readAsStringSync();
    final main =
        File('lib/features/main/screens/main_shell_screen.dart')
            .readAsStringSync();
    final pubspec = File('pubspec.yaml').readAsStringSync();

    expect(ShadowAssetKeys.bottomNavigationBackground,
        'app.navigation.bottomBar');
    expect(
      ShadowAssetKeys.bottomNavigationBackgroundBundledPath,
      'assets/images/system/shadow_live_bottom_bar_background.png',
    );
    expect(registry.contains("bottomNavigationBackground = 'app.navigation.bottomBar'"), isTrue);
    expect(
      File(ShadowAssetKeys.bottomNavigationBackgroundBundledPath).existsSync(),
      isTrue,
    );
    expect(pubspec.contains('    - assets/images/system/'), isTrue);
    expect(main.contains("ValueKey('shadow-bottom-navigation-wallpaper')"),
        isTrue);
    expect(
      main.contains('assetKey: ShadowAssetKeys.bottomNavigationBackground'),
      isTrue,
    );
    expect(
      main.contains('ShadowAssetKeys.bottomNavigationBackgroundBundledPath'),
      isTrue,
    );
    expect(main.contains('index == 3 && unread > 0'), isTrue,
        reason: 'Chat unread badge must keep working');
    expect(main.contains('onTap: () => onChanged(index)'), isTrue,
        reason: 'All six bottom tabs must stay interactive');
    expect(main.contains('currentIndex == index'), isTrue,
        reason: 'Selected-tab appearance remains dynamic');
  });

  test('rooms catalog no longer masks the existing global wallpaper', () {
    final catalog =
        File('lib/screens/room/room_list_screen.dart').readAsStringSync();
    final i = catalog.indexOf('Widget build(BuildContext context)');
    final scaffold = catalog.indexOf('child: Scaffold(', i);
    expect(scaffold, greaterThan(i));
    final transparent = catalog.indexOf(
        'backgroundColor: Colors.transparent,', scaffold);
    final body = catalog.indexOf('body: SafeArea(', scaffold);
    expect(transparent, greaterThan(scaffold));
    expect(transparent, lessThan(body));
    expect(catalog.contains('color: const Color(0xFF111321)'), isTrue,
        reason: 'Room cards must retain their readable dark surfaces');
    expect(catalog.contains('CustomScrollView('), isTrue);
    expect(catalog.contains('RoomListTile('), isTrue);
    expect(catalog.contains('_load(forceRefresh: true)'), isTrue);
  });

  testWidgets('bottom wallpaper paints visibly and does not block tab taps',
      (tester) async {
    tester.view.physicalSize = const Size(400, 100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final boundaryKey = GlobalKey();
    var tabs = 0;
    await tester.pumpWidget(RepaintBoundary(
      key: boundaryKey,
      child: MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF090A11),
          body: ShadowGlobalWallpaper(
            assetKey: ShadowAssetKeys.bottomNavigationBackground,
            bundledAsset:
                ShadowAssetKeys.bottomNavigationBackgroundBundledPath,
            resolveUrl: () async => null,
            scrimColor: const Color(0x2205060D),
            child: Center(
              child: TextButton(
                onPressed: () => tabs++,
                child: const Text('الرئيسية'),
              ),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    // File decoding is asynchronous. Pre-cache before examining rendered pixels.
    final decoded = await tester.runAsync(() async {
      await precacheImage(
        const AssetImage(
          'assets/images/system/shadow_live_bottom_bar_background.png',
        ),
        boundaryKey.currentContext!,
      );
      return true;
    });
    expect(decoded, isTrue);
    await tester.pump();

    await tester.tap(find.text('الرئيسية'));
    expect(tabs, 1);

    final colors = await tester.runAsync(() async {
      final boundary = boundaryKey.currentContext!.findRenderObject()!
          as RenderRepaintBoundary;
      final image = await boundary.toImage(pixelRatio: 1);
      try {
        final data = await image.toByteData(format: ui.ImageByteFormat.rawRgba);
        if (data == null) return 0;
        final pixels = data.buffer.asUint8List();
        final palette = <int>{};
        for (var y = 6; y < 96; y += 5) {
          for (var x = 5; x < 395; x += 7) {
            final offset = (y * image.width + x) * 4;
            palette.add((pixels[offset] << 16) |
                (pixels[offset + 1] << 8) |
                pixels[offset + 2]);
          }
        }
        return palette.length;
      } finally {
        image.dispose();
      }
    });
    expect(colors, greaterThan(18),
        reason: 'The bottom bar must render the branded image, '
            'not only a flat-color fallback');
  });
}
