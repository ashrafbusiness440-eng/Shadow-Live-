import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/diary_reports_control_page.dart';

void main() {
  test('old long diary report references are concise in the control list', () {
    const reportId = 'diary_comment_abcdefghijklmnopqrstuvwxyz_1234567890123456';
    expect(shortDiaryReportReference(reportId), '…' + reportId.substring(reportId.length - 12));
    expect(shortDiaryReportReference('short_id'), 'short_id');
  });

  test('moderation failure messages are safe and actionable in Arabic', () {
    expect(
      diaryReportActionMessage(StateError('invalid_report_id')),
      contains('حدّث القائمة'),
    );
    expect(
      diaryReportActionMessage(StateError('invalid_idempotency_key')),
      contains('أعد المحاولة'),
    );
    expect(
      diaryReportActionMessage(StateError('invalid_report_transition')),
      contains('حالة'),
    );
    expect(
      diaryReportActionMessage(StateError('forbidden')),
      contains('صلاحية'),
    );
    expect(
      diaryReportActionMessage(Exception('private server trace 123')),
      isNot(contains('private server trace')),
    );
  });
}
