import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP information center exposes live policy, history and recharge', () {
    final service =
        File('lib/features/vip/services/vip_service.dart').readAsStringSync();
    final screen = File(
      'lib/features/vip/screens/vip_information_center_screen.dart',
    ).readAsStringSync();
    final vipScreen =
        File('lib/features/vip/screens/vip_screen.dart').readAsStringSync();

    expect(service, contains("'action': 'history'"));
    expect(service, contains('VipHistoryPage'));
    expect(service, contains('VipPolicyData'));
    expect(service, contains('quickPurchaseOffers'));

    expect(screen, contains("Tab(text: 'نقاط النمو'"));
    expect(screen, contains("Tab(text: 'السجل'"));
    expect(screen, contains("Tab(text: 'قواعد VIP'"));
    expect(screen, contains("const RechargeScreen(initialTab: 0)"));
    expect(screen, contains("key: const Key('vip-history-load-more')"));
    expect(screen, contains("key: const Key('vip-open-recharge')"));
    expect(screen, contains('quickPurchaseOffers'));
    expect(screen, contains('downgradeRetentionBps'));
    expect(screen, isNot(contains('FirebaseFirestore')));
    expect(screen, isNot(contains('.snapshots()')));
    expect(screen, isNot(contains('Timer.periodic')));

    expect(
      vipScreen,
      contains('VipInformationCenterScreen('),
    );
  });

  test('Shadow Control quick offers remain backend-only and permission split', () {
    final control =
        File('lib/admin/control_vip_information.dart').readAsStringSync();
    final shell = File('lib/main_control.dart').readAsStringSync();

    expect(control, contains("shadowApiEndpoint('manage-vip-information')"));
    expect(control, contains("'action': 'state'"));
    expect(control, contains("'action': 'saveQuickOffers'"));
    expect(control, contains('idempotencyKey'));
    expect(control, contains('الحد الأعلى 8 عروض سريعة'));
    expect(control, isNot(contains('FirebaseFirestore')));
    expect(control, isNot(contains('.snapshots()')));
    expect(control, isNot(contains('Timer.periodic')));

    expect(
      shell,
      contains("capabilities.contains('manageVipPolicy')"),
    );
    expect(
      shell,
      contains("capabilities.contains('manageVipLevels')"),
    );
    expect(shell, contains("ControlItem('عروض VIP السريعة'"));
    expect(shell, contains('const VipInformationControlPage()'));
  });
}
