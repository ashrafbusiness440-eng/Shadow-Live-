import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/widgets/legendary_gift_visual.dart';

void main() {
  testWidgets('legendary preview respects reduced motion without network assets', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: const Scaffold(
            body: SizedBox(
              width: 320,
              height: 350,
              child: LegendaryGiftVisual(
                assetKey: '',
                fallbackAssetKey: '',
                durationMs: 4300,
                size: 500,
              ),
            ),
          ),
        ),
      ),
    );
    expect(find.byType(LegendaryGiftVisual), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
