import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/loading_indicator.dart';

void main() {
  testWidgets('read retry is Arabic, manual and fits a narrow screen',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 640));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    var attempts = 0;

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: ShadowReadState(
          icon: Icons.error_outline,
          message: 'تعذر تحميل المحادثات. تحقق من اتصال الإنترنت.',
          onRetry: () => attempts++,
        ),
      ),
    ));
    expect(find.text('إعادة المحاولة'), findsOneWidget);
    expect(find.textContaining('تعذر تحميل المحادثات'), findsOneWidget);
    expect(attempts, 0, reason: 'Never retry automatically');
    expect(tester.takeException(), isNull);

    await tester.tap(find.byKey(const Key('shadow-read-retry')));
    await tester.pump();
    expect(attempts, 1);
  });

  testWidgets('empty read state does not advertise a retry action',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ShadowReadState(
          icon: Icons.forum_outlined,
          message: 'لا توجد محادثات بعد',
        ),
      ),
    ));
    expect(find.text('لا توجد محادثات بعد'), findsOneWidget);
    expect(find.byKey(const Key('shadow-read-retry')), findsNothing);
  });

  testWidgets('Arabic read feedback stays usable at 390 and 430 widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 844));
      var attempts = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF05060D),
          body: ListView(
            children: [
              ShadowReadState(
                icon: Icons.wifi_off_rounded,
                message: 'تعذر تحميل الاستكشاف. تحقق من اتصال الإنترنت.',
                onRetry: () => attempts++,
              ),
            ],
          ),
        ),
      ));
      expect(find.text('إعادة المحاولة'), findsOneWidget);
      expect(tester.takeException(), isNull);
      expect(attempts, 0);
      await tester.tap(find.byKey(const Key('shadow-read-retry')));
      await tester.pump();
      expect(attempts, 1);
    }
  });

  test('home and diaries reuse the read state without new read loops', () {
    final home = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    expect(home.contains('child: ShadowReadState('), isTrue);
    expect(home.contains('if (_data != null || _error == null) ...['), isTrue);
    expect(home.contains('() => _load(forceRefresh: true)'), isTrue);

    final diaries = File('lib/features/diaries/screens/diaries_screen.dart')
        .readAsStringSync();
    expect(diaries.contains('child: ShadowReadState('), isTrue);
    expect(diaries.contains("message: 'جارٍ تحميل اليوميات...'"), isTrue);
    expect(diaries.contains('onRetry: () => _load(reset: true)'), isTrue);
    expect(diaries.contains('onRetry: _loading ? null : () => _load(reset: true)'),
        isTrue);
    expect(diaries.contains('for (final item in _items) _diaryCard(item)'), isTrue);
    expect(diaries.contains('else if (_hasMore)'), isTrue);
  });

  test('chat retries data reads only and handles hidden-list failures', () {
    final chat =
        File('lib/features/chat/screens/chat_list_screen.dart').readAsStringSync();
    expect(chat.contains("key: ValueKey('conversations-\$_readRetry')"), isTrue);
    expect(chat.contains('onRetry: _retryRead'), isTrue);
    expect(chat.contains('if (hiddenSnapshot.hasError)'), isTrue);
    expect(chat.contains('if (!hiddenSnapshot.hasData)'), isTrue);
    expect(chat.contains('static Widget _state('), isFalse);
    final state = File('lib/shared/widgets/loading_indicator.dart')
        .readAsStringSync();
    expect(state.contains('if (onRetry != null)'), isTrue);
    expect(state.contains('onPressed: onRetry'), isTrue);
  });
}
