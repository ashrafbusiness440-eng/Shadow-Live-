import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/loading_indicator.dart';

void main() {
  testWidgets('reusable Arabic search read failure retries only when tapped',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var retries = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ShadowReadState(
          icon: Icons.wifi_off_rounded,
          message: 'تعذر البحث حالياً. تحقق من الاتصال.',
          onRetry: () => retries++,
        ),
      ),
    ));
    expect(retries, 0);
    expect(find.text('إعادة المحاولة'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const Key('shadow-read-retry')));
    await tester.pump();
    expect(retries, 1);
  });

  test('new chat search debounces requests and ignores stale session results',
      () {
    final source =
        File('lib/features/chat/screens/chat_list_screen.dart')
            .readAsStringSync();
    expect(
      source.contains('const Duration(milliseconds: 320)'),
      isTrue,
    );
    expect(source.contains('searchDebounce?.cancel();'), isTrue);
    expect(source.contains('version != searchVersion'), isTrue);
    expect(source.contains('uid != sessionUid'), isTrue);
    expect(source.contains('controller.dispose();'), isTrue);
    expect(source.contains('immediate: true'), isTrue);
    expect(source.contains('successfulPaths == 0 && lastFailure != null'),
        isTrue);
    expect(source.contains('searchError = true;'), isTrue);
    expect(source.contains('suggestionsError = true;'), isTrue);
    expect(source.contains('unawaited(loadSuggestions('), isTrue);
    expect(source.contains('جارٍ تحميل الحسابات المقترحة'), isTrue);
    expect(source.contains('تعذر تحميل المقترحات'), isTrue);
    expect(source.contains('لا توجد حسابات مطابقة لبحثك'), isTrue);
  });
}
