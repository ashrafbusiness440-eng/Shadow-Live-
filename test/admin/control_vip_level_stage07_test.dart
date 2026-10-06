import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Stage 07 Shadow Control VIP uses backend-only bounded grant flow', () {
    final page =
        File('lib/admin/control_vip_level.dart').readAsStringSync();
    final shell = File('lib/main_control.dart').readAsStringSync();
    final access =
        File('lib/admin/user_access_control_card.dart').readAsStringSync();
    final server =
        File('cloudflare-worker/src/manage-vip-level.js').readAsStringSync();

    expect(page, contains("shadowApiEndpoint('manage-vip-level')"));
    expect(page, contains("'action': 'search'"));
    expect(page, contains("'action': 'update'"));
    expect(page, contains("'mode': mode"));
    expect(page, contains("'durationMinutes': durationMinutes"));
    expect(page, contains("'vipLevel': level"));
    expect(page, contains('منح VIP'));
    expect(page, contains('تغيير / سحب المنحة'));
    expect(page, contains('allowedVipGrantLevels'));
    expect(page, contains('بحث bounded حتى 20 نتيجة'));

    for (final forbidden in <String>[
      'FirebaseFirestore',
      '.collection(',
      '.snapshots()',
      'Timer.periodic',
      'StreamBuilder',
    ]) {
      expect(
        page.contains(forbidden),
        isFalse,
        reason: 'VIP control UI must not add direct Firestore/listener path: $forbidden',
      );
    }

    expect(shell, contains("import 'admin/control_vip_level.dart';"));
    expect(shell, contains("capabilities.contains('manageVipLevels')"));
    expect(shell, contains("ControlItem('إدارة VIP'"));
    expect(shell, contains('const VipLevelControlPage()'));

    expect(access, contains("'manageVipLevels': 'إدارة مستويات VIP'"));
    expect(access, contains("'allowedVipGrantLevels': allowedVipLevels"));
    expect(access, contains("FilterChip("));
    expect(access, contains("Text('VIP$level')"));

    expect(server, contains('limit: 20'));
    expect(server, contains('capabilities.has("manageVipLevels")'));
    expect(server, contains('allowedVipGrantLevels'));
    expect(server, contains('mode === "remove"'));
    expect(server, contains('mode === "change"'));
    expect(server, contains('mode === "grant"'));
    expect(server, contains('action: "manageVipLevels"'));
  });
}
