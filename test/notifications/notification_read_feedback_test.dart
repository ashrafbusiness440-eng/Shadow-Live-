import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/shared/widgets/loading_indicator.dart';

void main() {
  testWidgets('Arabic notification loading errors retry only on a tap',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      var retries = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF070B16),
          body: ShadowReadState(
            icon: Icons.wifi_off_rounded,
            message: 'تعذر تحميل الإشعارات. تحقق من اتصال الإنترنت.',
            onRetry: () => retries++,
          ),
        ),
      ));
      expect(find.text('إعادة المحاولة'), findsOneWidget);
      expect(retries, 0);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('shadow-read-retry')));
      await tester.pump();
      expect(retries, 1);
    }
  });

  test('notification reads keep prior items and manual pagination retries', () {
    final page = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    expect(page.contains('LoadingIndicator('), isTrue);
    expect(page.contains('ShadowReadState('), isTrue);
    expect(page.contains("message: 'لا توجد إشعارات حاليًا'"), isTrue);
    expect(page.contains('onRetry: _refresh,'), isTrue);
    expect(page.contains('bool _loadMoreFailed = false;'), isTrue);
    expect(page.contains('_loadMoreFailed = true;'), isTrue);
    expect(page.contains('onPressed: _loading ? null : _loadMore'), isTrue);
    expect(page.contains("'تعذر تحميل المزيد — إعادة المحاولة'"), isTrue);
    expect(page.contains('..addAll(page.items)'), isTrue);
    expect(page.contains('_items.addAll(next.items)'), isTrue);
    expect(page.contains('Future<void> _loadMore() async'), isTrue);
    expect(page.contains('for (final'), isFalse, reason: 'No per-item read loops in notifications UI');
  });
}
