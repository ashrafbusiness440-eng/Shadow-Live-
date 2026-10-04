import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/level_asset_image.dart';

void main() {
  testWidgets('Stage 08 level asset image falls back when registry has no asset',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: LevelAssetImage(
          assetKey: 'levels.game.lv01_03.mainBadge',
          resolveUri: (_) async => null,
          fallback: const Text('fallback'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('fallback'), findsOneWidget);
  });

  testWidgets('Stage 08 missing key avoids any remote lookup', (tester) async {
    var calls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: LevelAssetImage(
          assetKey: null,
          resolveUri: (_) async {
            calls += 1;
            return null;
          },
          fallback: const Text('fallback'),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.text('fallback'), findsOneWidget);
    expect(calls, 0);
  });
}
