import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('More exposes one reports hub and retains both permission paths', () {
    final main = File('lib/main_control.dart').readAsStringSync();
    expect(main.contains("ControlItem('البلاغات'"), isTrue);
    expect(main.contains("ControlItem('التقارير'"), isFalse);
    expect(main.contains("ControlItem('بلاغات المستخدمين والغرف'"), isFalse);
    expect(main.contains('canOpenGeneralReports'), isTrue);
    expect(main.contains('canOpenDiaryReports'), isTrue);
    expect(main.contains('reportsGeneralAllowed:canOpenGeneralReports'), isTrue);
    expect(main.contains('reportsDiaryAllowed:canOpenDiaryReports'), isTrue);
    expect(main.contains('ReportsHubPage('), isTrue);
  });

  test('hub mounts one permitted tab without inactive background readers', () {
    final hub = File('lib/admin/reports_hub_page.dart').readAsStringSync();
    expect(hub.contains('الغرف والرسائل'), isTrue);
    expect(hub.contains('الأشخاص'), isTrue);
    expect(hub.contains('يومياتي والتعليقات'), isTrue);
    expect(hub.contains('widget.allowGeneral'), isTrue);
    expect(hub.contains('widget.allowDiary'), isTrue);
    expect(hub.contains("scope: 'rooms_messages'"), isTrue);
    expect(hub.contains("scope: 'people'"), isTrue);
    expect(hub.contains('embedded: true'), isTrue);
    expect(hub.contains('Expanded('), isTrue);
    expect(hub.contains('child: _currentSection()'), isTrue);
    expect(hub.contains('IndexedStack('), isFalse);
    expect(hub.contains('Timer.periodic('), isFalse);
    expect(hub.contains('snapshots()'), isFalse);
    expect(hub.contains('تحديث البلاغات'), isTrue);
    expect(hub.contains('GeneralReportsHistoryPage('), isTrue);
    expect(hub.contains('_historyOpen'), isTrue);
    expect(hub.contains('initialReportId: focused'), isTrue);
    expect(hub.contains('widget.initialSection'), isTrue);
    final inbox = File('lib/admin/reports_hub_inbox_route.dart')
        .readAsStringSync();
    expect(inbox.contains("'user_report' || 'room_message_report'"), isTrue);
    expect(inbox.contains("'account_report' => ReportsHubSection.people"), isTrue);
    expect(inbox.contains("'diary_report' => ReportsHubSection.diaries"), isTrue);
    expect(inbox.contains('controlFirestore.collection'), isTrue);
  });

  test('existing reports support embedded mode and scoped bounded fetches', () {
    final general = File('lib/admin/general_reports_control_page.dart')
        .readAsStringSync();
    final diary = File('lib/admin/diary_reports_control_page.dart')
        .readAsStringSync();
    final worker = File('cloudflare-worker/src/general-reports.js')
        .readAsStringSync();
    expect(general.contains('this.embedded = false'), isTrue);
    expect(diary.contains('this.embedded = false'), isTrue);
    expect(general.contains('scope: widget.scope'), isTrue);
    expect(worker.contains('includePeople'), isTrue);
    expect(worker.contains('includeRooms'), isTrue);
    expect(worker.contains('invalid_report_scope'), isTrue);
    expect(worker.contains('limit: 30'), isTrue);
    expect(worker.contains('runQuery("reports"'), isTrue);
  });
}
