import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/vip/screens/vip_screen.dart';
import 'package:voice_chat_room/features/vip/services/vip_service.dart';

void main() {
  VipSummaryData summary() => const VipSummaryData(
        effectiveVipLevel: 1,
        effectiveVipSource: 'progression',
        earnedVipLevel: 1,
        adminGrantVipLevel: 0,
        growthPoints: 32308,
        maintenancePoints: 0,
        maintenanceRequired: 32308,
        currentThreshold: 32308,
        remainingToNext: 1260000,
        maxGrowthPoints: 2788461538,
        earnedVipExpiresAtMs: 1793664000000,
        adminGrantExpiresAtMs: 0,
        coins: 50000,
        purchaseGrowthPerCoin: 3,
        paidRechargeGrowthPerCoin: 1,
      );

  testWidgets(
    'VIP1 user can preview VIP10 without unlocking it',
    (tester) async {
      final data = summary();
      await tester.pumpWidget(
        MaterialApp(
          home: VipScreen(
            loadSummary: () async => data,
            buyGrowth: ({
              required int growthPoints,
              required String idempotencyKey,
            }) async =>
                data,
            assetResolver: (_) async => null,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('VIP1'), findsWidgets);
      expect(find.text('مستواك الحالي'), findsOneWidget);

      // Previous from VIP1 wraps directly to VIP10. Navigation/preview is
      // intentionally not gated by the user's effective VIP level.
      await tester.tap(find.byKey(const Key('vip-preview-prev')));
      await tester.pumpAndSettle();

      expect(find.text('VIP10'), findsWidgets);
      expect(
        find.text('معاينة فقط — يمكنك مشاهدة كل التفاصيل قبل الوصول'),
        findsOneWidget,
      );
      expect(
        find.text('القفل يمنع الاستخدام فقط ولا يمنع المعاينة'),
        findsOneWidget,
      );

      await tester.scrollUntilVisible(
        find.text('الامتيازات الحصرية 41/41'),
        350,
      );
      expect(find.text('الامتيازات الحصرية 41/41'), findsOneWidget);
      expect(find.text('شريط الدخول العام'), findsWidgets);
      expect(find.text('الحماية من الكتم'), findsOneWidget);
    },
  );

  testWidgets('VIP arrows wrap across all ten preview levels', (tester) async {
    final data = summary();
    await tester.pumpWidget(
      MaterialApp(
        home: VipScreen(
          loadSummary: () async => data,
          buyGrowth: ({
            required int growthPoints,
            required String idempotencyKey,
          }) async =>
              data,
          assetResolver: (_) async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('vip-preview-prev')));
    await tester.pumpAndSettle();
    expect(find.text('VIP10'), findsWidgets);

    await tester.tap(find.byKey(const Key('vip-preview-next')));
    await tester.pumpAndSettle();
    expect(find.text('VIP1'), findsWidgets);
  });
}
