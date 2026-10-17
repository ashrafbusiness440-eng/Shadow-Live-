import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('uncertain DM and profile reports reuse the same server operation', () {
    final source = File('lib/features/chat/services/chat_safety_service.dart')
        .readAsStringSync();
    final start = source.indexOf('  Future<String> _submitReport(');
    final request = source.substring(start);
    expect(request, contains('String? _pendingReportFingerprint') == false);
    expect(source, contains('String? _pendingReportFingerprint;'));
    expect(source, contains('String? _pendingReportKey;'));
    expect(request, contains('final fingerprint = jsonEncode(['));
    for (final part in [
      "reporterUid, action, targetUserId, conversationId ?? '', reason, details",
      '_pendingReportFingerprint == fingerprint',
      "'idempotencyKey': key",
      '.timeout(const Duration(seconds: 15))',
      'on TimeoutException',
      'on http.ClientException',
      "throw StateError('report_confirmation_pending')",
    ]) {
      expect(request, contains(part), reason: part);
    }
    expect(request, contains('if (response.statusCode >= 400 && response.statusCode < 500'));
    expect(request, contains('response.statusCode != 408'));
    expect(request, contains('_clearPendingReport();'));
    expect(source, isNot(contains('Timer.periodic')));
  });

  test('reports cannot cross accounts during ID token and network awaits', () {
    final source = File('lib/features/chat/services/chat_safety_service.dart')
        .readAsStringSync();
    final request = source.substring(source.indexOf('Future<String> _submitReport('));
    expect(request, contains('final reporter = FirebaseAuth.instance.currentUser;'));
    expect(request, contains('final reporterUid = reporter?.uid;'));
    expect(request, contains('final token = await reporter!.getIdToken();'));
    expect(
      "FirebaseAuth.instance.currentUser?.uid != reporterUid"
          .allMatches(request).length,
      greaterThanOrEqualTo(3),
    );
    expect(request, contains("throw StateError('report_account_changed')"));
    expect(request, contains('return reportId;'));
  });

  test('DM report UI never labels ambiguous delivery as certain failure', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final start = source.indexOf('Future<void> _reportUser() async');
    final end = source.indexOf('Future<bool> _storageReady()', start);
    final dialog = source.substring(start, end);
    expect(dialog, contains('final reporterUid = _openedByUid;'));
    expect(
      '_isActiveChatAccount(reporterUid)'.allMatches(dialog).length,
      greaterThanOrEqualTo(4),
    );
    expect(dialog, contains("error.message == 'report_confirmation_pending'"));
    expect(dialog, contains('قد يكون وصل للإدارة'));
    expect(dialog, contains('تم إرسال البلاغ للمراجعة بدون الصورة الاختيارية.'));
    expect(dialog, contains('await _reportSnapshots.attach('));
    expect(dialog.indexOf('await _safety.reportUser('),
        lessThan(dialog.indexOf('await _reportSnapshots.attach(')));
  });
}
