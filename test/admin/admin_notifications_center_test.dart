import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Shadow Control app bar exposes admin notification bell and badge', () {
    final source = File('lib/main_control.dart').readAsStringSync();

    expect(source.contains("tooltip:'إشعارات الإدارة'"), isTrue);
    expect(source.contains('AdminInboxService.load()'), isTrue);
    expect(source.contains('inboxUnreadCount>0'), isTrue);
    expect(source.contains("inboxUnreadCount>99?'99+'"), isTrue);
    expect(source.contains('Timer.periodic'), isFalse);
  });

  test('admin center routes approvals to the correct review surfaces', () {
    final source = File(
      'lib/admin/admin_notifications_page.dart',
    ).readAsStringSync();

    expect(source.contains("item.route == 'diary_reports'"), isTrue);
    expect(
      source.contains('DiaryReportsControlPage(initialReportId: item.targetId)'),
      isTrue,
    );
    expect(source.contains("item.route == 'agency_control'"), isTrue);
    expect(source.contains('focusType: item.type'), isTrue);
    expect(source.contains('focusId: item.targetId'), isTrue);
    expect(source.contains("'markVisibleRead'"), isTrue);
  });

  test('diary report page uses simple admin-facing copy', () {
    final source = File(
      'lib/admin/diary_reports_control_page.dart',
    ).readAsStringSync();

    expect(source.contains('راجع البلاغ واتخذ الإجراء المناسب.'), isTrue);
    expect(source.contains('القراءة bounded من Worker فقط'), isFalse);
    expect(source.contains('final String? initialReportId;'), isTrue);
    expect(source.contains("'getReport'"), isTrue);
  });

  test('agency control can prioritize notification target', () {
    final source = File(
      'lib/admin/agency_control_page.dart',
    ).readAsStringSync();

    expect(source.contains('final String? focusType;'), isTrue);
    expect(source.contains('final String? focusId;'), isTrue);
    expect(source.contains('agency_application'), isTrue);
    expect(source.contains('agency_identity_change'), isTrue);
    expect(source.contains('agency_ownership_transfer'), isTrue);
    expect(source.contains('agency_cooldown_exception'), isTrue);
  });

  test('admin inbox remains Worker-backed with no client Firestore reads', () {
    final source = File(
      'lib/admin/admin_notifications_page.dart',
    ).readAsStringSync();

    expect(source.contains("shadowApiEndpoint('admin-inbox')"), isTrue);
    expect(source.contains('FirebaseFirestore'), isFalse);
    expect(source.contains('.snapshots()'), isFalse);
    expect(source.contains('Timer.periodic'), isFalse);
  });
}
