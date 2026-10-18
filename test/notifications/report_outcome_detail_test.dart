import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/notifications/services/notification_service.dart';

void main() {
  test('report result parser preserves full server decision, including reason', () {
    const fullReason = 'تم رفض البلاغ. السبب: الأدلة لا تثبت المخالفة.';
    final notice = AppNotification.fromMap('report_result_123', const {
      'type': 'report_status',
      'title': 'نتيجة مراجعة بلاغك',
      'body': fullReason,
      'reportStatus': 'rejected',
      'reportSubject': 'private_chat',
      'read': false,
    });
    expect(notice.type, 'report_status');
    expect(notice.body, fullReason);
    expect(notice.reportStatus, 'rejected');
    expect(notice.reportSubject, 'private_chat');
    expect(notice.read, false);

    final legacy = AppNotification.fromMap('legacy_report', const {
      'type': 'report_status',
      'body': 'بلاغك قيد المراجعة',
    });
    expect(legacy.reportStatus, isNull);
    expect(legacy.reportSubject, isNull);
  });

  test('report decision tap opens a full read-only offline dialog', () {
    final source = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    final openStart = source.indexOf('Future<void> _open(AppNotification item)');
    final openEnd = source.indexOf('Future<void> _openReportOutcome(', openStart);
    final dispatch = source.substring(openStart, openEnd);
    expect(dispatch, contains("item.type == 'report_status'"));
    expect(dispatch, contains('await _openReportOutcome(item);'));
    expect(dispatch, contains('reportStatus: item.reportStatus'));
    expect(dispatch, contains('reportSubject: item.reportSubject'));
    // An offline read receipt may never complete. Both notification paths
    // must have a strict timeout and retain account isolation.
    expect('timeout(const Duration(seconds: 3))'.allMatches(dispatch).length, 2);
    expect(dispatch.indexOf('if (!activeOwner()) return;'),
      lessThan(dispatch.indexOf("item.type == 'report_status'")));

    final detailStart = source.indexOf('Future<void> _openReportOutcome(');
    final detailEnd = source.indexOf('Future<void> _openImageModeration(', detailStart);
    final detail = source.substring(detailStart, detailEnd);
    for (final expected in [
      'FirebaseAuth.instance.currentUser?.uid != ownerUid',
      "'under_review' => 'قيد المراجعة'",
      "'rejected' => 'مرفوض'",
      "'actioned' => 'تم اتخاذ إجراء'",
      "'closed' => 'مغلق'",
      'SingleChildScrollView(',
      'SelectableText(',
      'item.body,',
      "child: const Text('إغلاق')",
    ]) {
      expect(detail, contains(expected), reason: expected);
    }
    expect(detail, isNot(contains('.get(')));
    expect(detail, isNot(contains('.snapshots(')));
    expect(detail, isNot(contains('Timer.periodic(')));
    expect(detail, isNot(contains('targetUserId')));
  });
}
