import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/main/screens/main_shell_screen.dart';

void main() {
  testWidgets('mini-room close owns its full 44px in-bounds target on narrow screens',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      var restored = 0;
      var left = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: GestureDetector(
              key: const Key('mini-room-restore'),
              behavior: HitTestBehavior.opaque,
              onTap: () => restored++,
              child: SizedBox(
                width: 72,
                height: 72,
                child: Stack(
                  children: [
                    const Positioned.fill(
                      child: ColoredBox(color: Color(0xFF171D2B)),
                    ),
                    Positioned(
                      top: 0,
                      right: 0,
                      child: MiniRoomCloseControl(onLeave: () => left++),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ));

      final closeRect = tester.getRect(find.byKey(const Key('mini-room-close')));
      final cardRect = tester.getRect(find.byKey(const Key('mini-room-restore')));
      expect(closeRect.size, const Size(44, 44));
      expect(cardRect.contains(closeRect.topLeft), isTrue);
      // Rect.contains() excludes its bottom/right boundary even when the
      // child and the card meet exactly at the edge.
      expect(closeRect.right <= cardRect.right, isTrue);
      expect(closeRect.bottom <= cardRect.bottom, isTrue);
      expect(tester.takeException(), isNull);

      // Inside the 44px target, even close to the edge of its bounding box.
      await tester.tapAt(closeRect.topRight + const Offset(-3, 3));
      await tester.pump();
      expect(left, 1, reason: 'close must receive the tap');
      expect(restored, 0, reason: 'close must never restore the room');

      await tester.tapAt(cardRect.bottomLeft + const Offset(5, -5));
      await tester.pump();
      expect(restored, 1, reason: 'the rest of the thumbnail still restores');
      expect(left, 1);
    }
  });
}
