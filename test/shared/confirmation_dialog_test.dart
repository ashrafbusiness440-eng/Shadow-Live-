import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/confirmation_dialog.dart';

void main() {
  testWidgets('Arabic confirmation requires an explicit tap on compact screens',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));

    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      bool? accepted;

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(
            child: ElevatedButton(
              onPressed: () async {
                accepted = await showShadowConfirmation(
                  tester.element(find.byType(Scaffold)),
                  title: 'إخفاء المحادثة من قائمتك؟',
                  message:
                      'ستختفي من قائمة رسائلك فقط، وإذا وصلتك رسالة جديدة ستظهر ثانية.',
                  confirmLabel: 'إخفاء المحادثة',
                  destructive: true,
                );
              },
              child: const Text('فتح التأكيد'),
            ),
          ),
        ),
      ));

      await tester.tap(find.text('فتح التأكيد'));
      await tester.pumpAndSettle();
      expect(find.text('إلغاء'), findsOneWidget);
      expect(find.text('إخفاء المحادثة'), findsOneWidget);
      expect(accepted, isNull, reason: 'Opening the dialog must not commit');
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('إلغاء'));
      await tester.pumpAndSettle();
      expect(accepted, isFalse);

      accepted = null;
      await tester.tap(find.text('فتح التأكيد'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('shadow-confirm-action')));
      await tester.pumpAndSettle();
      expect(accepted, isTrue);
      expect(tester.takeException(), isNull);
    }
  });

  test('chat hide keeps the existing atomic batch and never retries a write',
      () {
    final chat =
        File('lib/features/chat/screens/chat_list_screen.dart')
            .readAsStringSync();
    expect(chat.contains('showShadowConfirmation('), isTrue);
    expect(chat.contains('_pendingConversationHides.add(conversationId)'),
        isTrue);
    expect(chat.contains('_pendingConversationHides.remove(conversationId)'),
        isTrue);
    expect(chat.contains('if (!confirmed || !mounted || uid != me) return;'),
        isTrue);
    expect(chat.contains("collection('conversation_hides')"), isTrue);
    expect(chat.contains('await batch.commit();'), isTrue);
    expect(chat.contains('تعذر إخفاء المحادثة'), isTrue);
    expect(chat.contains('حذف المحادثة؟'), isFalse);
  });
}
