import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('general report cannot be manually marked actioned in the control', () {
    final current = File('lib/admin/general_reports_control_page.dart')
        .readAsStringSync();
    expect(current.contains("_review(item, 'actioned')"), isFalse);
    expect(current.contains('توثيق إجراء نُفّذ سابقًا'), isFalse);
    expect(current.contains("_takeAccountAction(item, 'suspend')"), isTrue);
    expect(current.contains("_takeAccountAction(item, 'ban')"), isTrue);
    expect(current.contains('action_requires_execution'), isTrue);
  });

  test('historical reports open from the existing reports page', () {
    final current = File('lib/admin/general_reports_control_page.dart')
        .readAsStringSync();
    final history = File('lib/admin/general_reports_history_page.dart')
        .readAsStringSync();
    expect(current.contains('const GeneralReportsHistoryPage()'), isTrue);
    expect(current.contains("'listHistory'"), isTrue);
    for (final word in <String>[
      'سجل البلاغات السابقة',
      'مقدّم البلاغ',
      'الحساب المبلّغ عليه',
      'وقت البلاغ',
      'الصفحة التالية',
      'الصفحة السابقة',
      'الصق الرقم الموجود بالإشعار',
      'الرجوع لسجل البلاغات',
    ]) {
      expect(history.contains(word), isTrue, reason: word);
    }
    expect(history.contains('Timer.periodic'), isFalse);
    expect(history.contains('.snapshots()'), isFalse);
    expect(history.contains('FirebaseFirestore'), isFalse);
  });
}
