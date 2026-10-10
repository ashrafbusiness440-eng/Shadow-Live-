import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/confirmation_dialog.dart';

void main() {
  testWidgets('diary guest login uses a clear RTL choice at 360 and 430',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      bool? signIn;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) => TextButton(
              onPressed: () async {
                signIn = await showShadowConfirmation(
                  context,
                  title: 'تسجيل الدخول',
                  message:
                      'يمكنك مشاهدة اليوميات العامة كضيف، لكن يلزم تسجيل الدخول للتفاعل.',
                  confirmLabel: 'تسجيل الدخول',
                );
              },
              child: const Text('إجراء الضيف'),
            ),
          ),
        ),
      ));
      await tester.tap(find.text('إجراء الضيف'));
      await tester.pumpAndSettle();
      expect(find.text('تسجيل الدخول'), findsNWidgets(2));
      expect(find.text('إلغاء'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.text('إلغاء'));
      await tester.pumpAndSettle();
      expect(signIn, isFalse);
      signIn = null;
      await tester.tap(find.text('إجراء الضيف'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('shadow-confirm-action')));
      await tester.pumpAndSettle();
      expect(signIn, isTrue);
    }
  });

  test('diary reporting prevents repeated writes while its sheet is open',
      () {
    final src =
        File('lib/features/diaries/screens/diaries_screen.dart')
            .readAsStringSync();
    expect(src.contains('if (_busyReportIds.contains(item.diaryId)) return;'),
        isTrue);
    expect(src.contains('setState(() => _busyReportIds.add(item.diaryId));'),
        isTrue);
    expect(src.contains('_busyReportIds.remove(item.diaryId);'), isTrue);
    expect(src.contains('if (!mounted || reason == null || _uid != reporterUid)'),
        isTrue);
    expect(src.contains('onPressed: _busyReportIds.contains(item.diaryId)'),
        isTrue);
    expect(src.contains('showShadowConfirmation('), isTrue);
    expect(src.contains('showDiaryReportReasonSheet(context)'), isTrue);
    expect(src.contains('_service.reportDiary('), isTrue);
    expect(src.contains('تم إرسال البلاغ للمراجعة.'), isTrue);
    expect(src.contains('سبق إرسال بلاغك عن هذه اليومية.'), isTrue);
    expect(src.contains('SignOutRequested()'), isTrue);
  });
}
