import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/diary_reports_control_page.dart';

void main() {
  test('old long diary report references are concise in the control list', () {
    const reportId = 'diary_comment_abcdefghijklmnopqrstuvwxyz_1234567890123456';
    expect(shortDiaryReportReference(reportId), '…' + reportId.substring(reportId.length - 12));
    expect(shortDiaryReportReference('short_id'), 'short_id');
  });

  test('legacy history recovery reuses diary moderation API and permission gate', () {
    final screen = File('lib/admin/diary_reports_control_page.dart')
        .readAsStringSync();
    expect(screen.contains("'restoreVerifiedDeletionHistory'"), isTrue);
    expect(screen.contains('استرجاع إجراء الحذف القديم'), isTrue);
    expect(screen.contains("item.status == 'actioned'"), isTrue);
    expect(screen.contains("item.moderationAction"), isTrue);
    expect(screen.contains('Timer.periodic'), isFalse);
    expect(screen.contains('.snapshots()'), isFalse);
    final service = File('cloudflare-worker/src/diary-moderation.js')
        .readAsStringSync();
    expect(service.contains("action === \"restoreVerifiedDeletionHistory\""), isTrue);
    expect(service.contains('recentAuth: true'), isTrue);
    expect(service.contains('history_sample_capped'), isTrue);
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
      diaryReportActionMessage(StateError('warning_target_unavailable')),
      contains('تحذير'),
    );
    expect(
      diaryReportActionMessage(StateError('unverified_account_action')),
      contains('التحقق'),
    );
    expect(diaryReportActionMessage(StateError('history_proof_missing')),
        contains('أدلة تنفيذ كافية'));
    expect(diaryReportActionMessage(StateError('history_sample_capped')),
        contains('سجلات كثيرة'));
    expect(
      diaryReportActionMessage(Exception('private server trace 123')),
      isNot(contains('private server trace')),
    );
  });
}
