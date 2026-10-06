import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/vip/screens/vip_screen.dart';
import 'package:voice_chat_room/features/vip/services/vip_service.dart';

void main() {
  test('VIP summary parses Hide Lists entitlement and preference', () {
    final parsed = VipSummaryData.fromJson({
      'effectiveVipLevel': 7,
      'effectiveVipSource': 'progression',
      'earnedVipLevel': 7,
      'adminGrantVipLevel': 0,
      'growthPoints': 1,
      'maintenancePoints': 0,
      'maintenanceRequired': 1,
      'currentThreshold': 1,
      'remainingToNext': 1,
      'maxGrowthPoints': 1,
      'earnedVipExpiresAtMs': 1,
      'adminGrantExpiresAtMs': 0,
      'coins': 0,
      'purchaseGrowthPerCoin': 3,
      'paidRechargeGrowthPerCoin': 1,
      'canHideRankingLists': true,
      'hideRankingLists': true,
    });
    expect(parsed.canHideRankingLists, isTrue);
    expect(parsed.hideRankingLists, isTrue);

    final state = VipHideListsState.fromJson({
      'hideRankingLists': true,
      'canHideRankingLists': true,
      'requiredVipLevel': 7,
    });
    expect(state.hideRankingLists, isTrue);
    expect(state.canHideRankingLists, isTrue);
    expect(state.requiredVipLevel, 7);
  });

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
      final requestedAssets = <String>{};
      await tester.pumpWidget(
        MaterialApp(
          home: VipScreen(
            loadSummary: () async => data,
            buyGrowth: ({
              required int growthPoints,
              required String idempotencyKey,
            }) async =>
                data,
            assetResolver: (key) async {
              requestedAssets.add(key);
              return null;
            },
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

      final scrollable = find.byType(ListView).first;
      for (var i = 0; i < 5; i++) {
        await tester.drag(scrollable, const Offset(0, -500));
        await tester.pumpAndSettle();
      }
      expect(find.text('الامتيازات الحصرية 38/38'), findsOneWidget);
      expect(find.text('الحماية من الكتم'), findsOneWidget);
      // Cosmetic tiles may be disposed once they scroll off-screen. The
      // resolver history is the stable assertion that VIP10 actually
      // requested those preview visuals from Asset Studio.
      expect(requestedAssets.contains('vip.v10.mainBadge'), isTrue);
      expect(requestedAssets.contains('vip.v10.profileFrame'), isTrue);
      expect(requestedAssets.contains('vip.v10.globalEntryBanner'), isTrue);
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
