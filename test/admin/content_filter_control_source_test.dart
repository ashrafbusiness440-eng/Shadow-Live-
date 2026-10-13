import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Arabic filter control is reachable from existing More tab', () {
    final shell = File('lib/main_control.dart').readAsStringSync();
    final page = File('lib/admin/content_filter_control_page.dart')
        .readAsStringSync();
    expect(shell.contains("ControlItem('فلترة الكلمات'"), isTrue);
    expect(shell.contains("return const ContentFilterControlPage()"), isTrue);
    for (final label in [
      'تشغيل فلترة الكلمات',
      'الرسائل الخاصة',
      'رسائل الغرف الصوتية',
      'منشورات يومياتي',
      'تعليقات يومياتي',
      'إضافة كلمة',
      'إضافة عدة كلمات',
      'حفظ التغييرات',
      'جرّب الفلترة قبل الحفظ',
      'منع الإرسال',
      'تسجيل مخالفة للمراجعة',
      'إخفاء الكلمة بنجوم',
    ]) {
      expect(page.contains(label), isTrue, reason: label);
    }
  });

  test('safe save and preview with human-readable messages', () {
    final source = File('lib/admin/content_filter_control_page.dart')
        .readAsStringSync();
    expect(source.contains("shadowApiEndpoint('content-filter-control')"), isTrue);
    expect(source.contains("'expectedVersion': _version"), isTrue);
    expect(source.contains("'reason': _reason.text.trim()"), isTrue);
    expect(source.contains("if (response['roomSynced'] != true)"), isTrue);
    expect(source.contains("'action': 'preview'"), isTrue);
    expect(source.contains("'action': 'load'"), isTrue);
    expect(source.contains("'action': 'save'"), isTrue);
    expect(source.contains('Timer.periodic'), isFalse);
    expect(source.contains('.snapshots()'), isFalse);
    expect(source.contains('FirebaseFirestore'), isFalse);
    expect(source.contains("contentFilterFailed"), isFalse);
  });
}
