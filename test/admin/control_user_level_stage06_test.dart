import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Stage 06 Shadow Control level tab stays backend-only and bounded', () {
    final page = File('lib/admin/control_user_level.dart').readAsStringSync();
    final shell = File('lib/main_control.dart').readAsStringSync();
    final access =
        File('lib/admin/user_access_control_card.dart').readAsStringSync();

    expect(page, contains("shadowApiEndpoint('manage-user-level')"));
    expect(page, contains("'action': 'search'"));
    expect(page, contains("'action': 'update'"));
    expect(page, contains("'targetUid': user.uid"));
    expect(page, contains("'metric': metric.key"));
    expect(page, contains("'mode': mode"));
    expect(page, contains('Set Points'));
    expect(page, contains('Set Level'));
    expect(page, contains('الاسم / Public ID / UID'));
    expect(page, contains('Bounded حتى 20 نتيجة'));
    expect(page, contains('Room Level وVIP مستقلان'));

    for (final forbidden in <String>[
      'FirebaseFirestore',
      '.collection(',
      '.snapshots()',
      'Timer.periodic',
      'StreamBuilder',
    ]) {
      expect(page.contains(forbidden), isFalse,
          reason: 'level UI must not add direct Firestore/polling path: ' + forbidden);
    }

    expect(shell, contains("import 'admin/control_user_level.dart';"));
    expect(shell, contains('const UserLevelControlPage()'));
    expect(shell, contains("label:'المستوى'"));
    expect(shell, contains('initialNavIndex.clamp(0, 6)'));

    for (final capability in <String>[
      'manageUserLevels',
      'manageWealthLevel',
      'manageAttractionLevel',
      'manageGameLevel',
    ]) {
      expect(access, contains(capability));
    }

    final suggestedStart = access.indexOf('Set<String> _suggested');
    final suggestedEnd = access.indexOf('@override', suggestedStart);
    expect(suggestedStart, greaterThanOrEqualTo(0));
    expect(suggestedEnd, greaterThan(suggestedStart));
    final suggested = access.substring(suggestedStart, suggestedEnd);
    expect(suggested.contains('manageUserLevels'), isFalse);
    expect(suggested.contains('manageWealthLevel'), isFalse);
    expect(suggested.contains('manageAttractionLevel'), isFalse);
    expect(suggested.contains('manageGameLevel'), isFalse);
  });
}
