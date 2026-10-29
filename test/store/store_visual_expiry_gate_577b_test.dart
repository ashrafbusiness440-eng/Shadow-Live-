import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/store/widgets/store_visual_expiry_gate.dart';

Widget scene(int? deadline) => Directionality(
      textDirection: TextDirection.rtl,
      child: StoreVisualExpiryGate(
        expiresAtMs: deadline,
        builder: (_, active) => Text(active ? 'مفعّل' : 'منتهي'),
      ),
    );

void main() {
  testWidgets('verified timed visual disappears at its deadline without reads',
      (tester) async {
    final expiry = DateTime.now().millisecondsSinceEpoch + 80;
    await tester.pumpWidget(scene(expiry));
    expect(find.text('مفعّل'), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 140));
    expect(find.text('منتهي'), findsOneWidget);
  });

  testWidgets('permanent visual stays active', (tester) async {
    await tester.pumpWidget(scene(null));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('مفعّل'), findsOneWidget);
  });

  testWidgets('changing visual expiry cancels earlier timer', (tester) async {
    final initial = DateTime.now().millisecondsSinceEpoch + 100;
    await tester.pumpWidget(scene(initial));
    final replacement = DateTime.now().millisecondsSinceEpoch + 1000;
    await tester.pumpWidget(scene(replacement));
    await tester.pump(const Duration(milliseconds: 200));
    expect(find.text('مفعّل'), findsOneWidget);
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('منتهي'), findsOneWidget);
  });

  testWidgets('already expired art never paints', (tester) async {
    await tester.pumpWidget(
      scene(DateTime.now().millisecondsSinceEpoch - 1000),
    );
    expect(find.text('منتهي'), findsOneWidget);
    expect(find.text('مفعّل'), findsNothing);
  });
}
