import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_reports.dart';

void main() {
  test('Stage 07 registers diary report targets and transitions', () {
    expect(ReportPolicy.targets.contains('diary'), isTrue);
    expect(ReportPolicy.targets.contains('diary_comment'), isTrue);
    expect(ReportPolicy.canTransition('new', 'under_review'), isTrue);
    expect(ReportPolicy.canTransition('under_review', 'actioned'), isTrue);
    expect(ReportPolicy.canTransition('actioned', 'under_review'), isFalse);
  });

  test('Shadow Control diary reports use bounded Worker API only', () {
    final page = File(
      'lib/admin/diary_reports_control_page.dart',
    ).readAsStringSync();
    final mainControl = File('lib/main_control.dart').readAsStringSync();

    expect(page.contains("shadowApiEndpoint('diary-moderation')"), isTrue);
    expect(page.contains("'listReports'"), isTrue);
    expect(page.contains("'reviewReport'"), isTrue);
    expect(page.contains("'deleteDiaryComment'"), isTrue);
    expect(page.contains("'deleteDiary'"), isTrue);
    expect(page.contains("'limit': 20"), isTrue);
    expect(page.contains("collection('reports')"), isFalse);
    expect(page.contains('Load More'), isFalse);
    expect(page.contains('تحميل المزيد'), isTrue);

    expect(mainControl.contains('DiaryReportsControlPage'), isTrue);
    expect(
      mainControl.contains(
        "capabilities.contains('manageDiaries')",
      ),
      isTrue,
    );
    expect(
      mainControl.contains(
        "capabilities.contains('deleteDiaryComment')",
      ),
      isTrue,
    );
  });

  test('Stage 07 Worker enforces capabilities audit and bounded queue', () {
    final moderation = File(
      'cloudflare-worker/src/diary-moderation.js',
    ).readAsStringSync();
    final diaries = File(
      'cloudflare-worker/src/diaries.js',
    ).readAsStringSync();
    final access = File(
      'cloudflare-worker/src/manage-user-access.js',
    ).readAsStringSync();

    expect(moderation.contains('"manageDiaries"'), isTrue);
    expect(moderation.contains('"deleteDiaryComment"'), isTrue);
    expect(moderation.contains('"reviewReports"'), isTrue);
    expect(moderation.contains('Math.min(30'), isTrue);
    expect(moderation.contains('admin_audit_logs/diary_delete_'), isTrue);
    expect(
      moderation.contains('admin_audit_logs/diary_comment_delete_'),
      isTrue,
    );
    expect(moderation.contains('admin_audit_logs/diary_report_'), isTrue);

    expect(diaries.contains('cannot_report_own_content'), isTrue);
    expect(diaries.contains('diary_reports/${reportId}'), isTrue);
    expect(diaries.contains('createdAtMs: nowMs'), isTrue);
    expect(access.contains('"manageDiaries"'), isTrue);
    expect(access.contains('"deleteDiaryComment"'), isTrue);
  });

  test('Stage 07 keeps approved diary report reasons', () {
    final sheet = File(
      'lib/features/diaries/widgets/diary_report_sheet.dart',
    ).readAsStringSync();

    expect(sheet.contains("'abusive_content'"), isTrue);
    expect(sheet.contains("'harassment_bullying'"), isTrue);
    expect(sheet.contains("'spam'"), isTrue);
    expect(sheet.contains("'inappropriate_image'"), isTrue);
    expect(sheet.contains("'impersonation'"), isTrue);
    expect(sheet.contains("'other_violation'"), isTrue);
  });
}
