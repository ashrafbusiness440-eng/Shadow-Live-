import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/reports_hub_inbox_route.dart';
import 'package:voice_chat_room/admin/reports_hub_page.dart';

void main() {
  test('notification routes select the correct report section', () {
    expect(reportSectionForInboxType('user_report'),
        ReportsHubSection.roomsAndMessages);
    expect(reportSectionForInboxType('room_message_report'),
        ReportsHubSection.roomsAndMessages);
    expect(reportSectionForInboxType('room_report'),
        ReportsHubSection.roomsAndMessages);
    expect(reportSectionForInboxType('account_report'),
        ReportsHubSection.people);
    expect(reportSectionForInboxType('diary_report'),
        ReportsHubSection.diaries);
  });

  test('history stays inside selected permitted hub section', () {
    final hub = File('lib/admin/reports_hub_page.dart').readAsStringSync();
    final history = File('lib/admin/general_reports_history_page.dart')
        .readAsStringSync();
    final notices = File('lib/admin/admin_notifications_page.dart')
        .readAsStringSync();
    expect(hub.contains('_historyOpen'), isTrue);
    expect(hub.contains('GeneralReportsHistoryPage('), isTrue);
    expect(hub.contains('scope: _section == ReportsHubSection.people'), isTrue);
    expect(history.contains("this.embedded = false"), isTrue);
    expect(history.contains("widget.scope == 'people'"), isTrue);
    expect(history.contains("'account_report'"), isTrue);
    expect(history.contains("'user_report'"), isTrue);
    expect(notices.contains('ReportsHubInboxRoute('), isTrue);
    expect(notices.contains('reportId: item.targetId'), isTrue);
    expect(notices.contains('reportType: item.type'), isTrue);
    expect(notices.contains('GeneralReportsControlPage(initialReportId:'), isFalse);
    expect(notices.contains('DiaryReportsControlPage(initialReportId:'), isFalse);
  });
}
