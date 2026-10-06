import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP grant capability scope is explicit and Owner-configurable', () {
    final access =
        File('lib/admin/user_access_control_card.dart').readAsStringSync();
    final shell = File('lib/main_control.dart').readAsStringSync();
    final server =
        File('cloudflare-worker/src/manage-user-access.js').readAsStringSync();
    final vipControl =
        File('cloudflare-worker/src/manage-vip-level.js').readAsStringSync();

    expect(access, contains("'manageVipLevels': 'إدارة مستويات VIP'"));
    expect(access, contains("'allowedVipGrantLevels': allowedVipLevels"));
    expect(access, contains("List<Widget>.generate(10"));
    expect(access, contains("label: Text('VIP$level')"));
    expect(
      access,
      contains('إذا بقيت القائمة فارغة فلن يستطيع منح أي مستوى'),
    );
    expect(shell, contains('allowedVipGrantLevels:'));
    expect(server, contains('"manageVipLevels"'));
    expect(server, contains('oldAllowedLevels'));
    expect(server, contains('newAllowedLevels'));

    final suggestedStart = access.indexOf('Set<String> _suggested');
    final suggestedEnd = access.indexOf('@override', suggestedStart);
    expect(suggestedStart, greaterThanOrEqualTo(0));
    expect(suggestedEnd, greaterThan(suggestedStart));
    final suggested = access.substring(suggestedStart, suggestedEnd);
    expect(suggested.contains('manageVipLevels'), isFalse,
        reason: 'Role presets must never auto-grant VIP control.');

    expect(vipControl, contains('capabilities.has("manageVipLevels")'));
    expect(vipControl, isNot(contains('capabilities.has("manageVip")')));
    expect(vipControl, contains('allowedVipGrantLevels'));
    expect(vipControl, contains('slice(0, 20)'));
  });
}
