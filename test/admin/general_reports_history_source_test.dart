import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
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
