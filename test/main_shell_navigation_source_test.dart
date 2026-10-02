import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('bottom navigation keeps the approved RTL order', () {
    final shell = File(
      'lib/features/main/screens/main_shell_screen.dart',
    ).readAsStringSync();

    const labels = [
      "label: 'الرئيسية'",
      "label: 'الغرف'",
      "label: 'الألعاب'",
      "label: 'الرسائل'",
      "label: 'يومياتي'",
      "label: 'الملف الشخصي'",
    ];

    var previous = -1;
    for (final label in labels) {
      final current = shell.indexOf(label);
      expect(current, greaterThan(previous), reason: label);
      previous = current;
    }

    expect(shell.contains("label: 'صوت'"), isFalse);
    expect(shell.contains('index == 3 && unread > 0'), isTrue);
    expect(shell.contains("title: 'يومياتي'"), isTrue);
  });

  test('room messages route to the new messages tab index', () {
    final main = File('lib/main.dart').readAsStringSync();
    expect(
      main.contains('_minimizeVoiceRoom(destinationNavIndex: 3)'),
      isTrue,
    );
    expect(
      main.contains('_minimizeVoiceRoom(destinationNavIndex: 4)'),
      isFalse,
    );
  });

  test('browser E2E follows the approved six-tab order', () {
    final e2e = File('.github/scripts/e2e_tabs.mjs').readAsStringSync();
    for (final name in const [
      "name: 'home'",
      "name: 'rooms'",
      "name: 'games'",
      "name: 'messages'",
      "name: 'diaries'",
      "name: 'profile'",
    ]) {
      expect(e2e.contains(name), isTrue, reason: name);
    }
    expect(e2e.contains("name: 'voice'"), isFalse);
  });
}
