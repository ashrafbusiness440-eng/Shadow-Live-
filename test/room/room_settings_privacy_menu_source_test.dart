import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final app = File('lib/main.dart').readAsStringSync();
  final worker = File('cloudflare-worker/src/voice-session-legacy.js')
      .readAsStringSync();
  final settings = app.substring(
    app.indexOf('Future<void> _showRoomSettingsSheet()'),
    app.indexOf('Future<void> _reportCurrentRoom('),
  );
  final menu = app.substring(
    app.indexOf('Future<void> _showRoomMenu()'),
    app.indexOf('  @override\n  void dispose()', app.indexOf('Future<void> _showRoomMenu()')),
  );
  final updateSettings = worker.substring(
    worker.indexOf('async function updateRoomSettings('),
    worker.indexOf('async function ', worker.indexOf('async function updateRoomSettings(') + 10),
  );

  test('room category is a selector above the room name', () {
    expect(settings, contains("labelText: 'تصنيف الغرفة'"));
    expect(settings, contains('categoryChoices'));
    expect(settings, contains('DropdownButtonFormField<String>'));
    expect(settings.indexOf("labelText: 'تصنيف الغرفة'"),
        lessThan(settings.indexOf("labelText: 'اسم الغرفة'")));
    expect(settings, contains("subtitle: Text('وكالة',"));
  });

  test('tags are capped at three in both widget and server', () {
    expect(settings, contains("selectedTags.length >= 3"));
    expect(settings, contains("وسوم الغرفة ("));
    expect(settings, contains("tagsController.text = selectedTags.join('، ');"));
    expect(settings, contains(".take(3)"));
    expect(updateSettings, contains('tags.length>3'));
    expect(updateSettings, contains('invalid_room_tags'));
  });

  test('room password validates in field and before saving', () {
    expect(settings, contains('errorText: passwordController.text.isNotEmpty'));
    expect(settings, contains('passwordController.text.length < 4'));
    expect(settings, contains('onChanged: (_) => setSheetState(() {})'));
    expect(settings, contains('minLines: 3,'));
  });

  test('hidden room choice is conditional on privileged authority', () {
    expect(settings, contains('ownerAbsoluteRoomAccess'));
    expect(settings, contains('if (canChooseHidden)'));
    expect(updateSettings, contains('hidden_room_forbidden'));
  });

  test('chat and session actions live in room menu, not settings', () {
    expect(settings, isNot(contains('SwitchListTile(')));
    expect(menu, contains("title: const Text(\n                          'دردشة الغرفة'"));
    expect(menu, contains('if (_canModerateChat)'));
    expect(menu.indexOf("sectionTitle('الجلسة')"),
        lessThan(menu.indexOf("sectionTitle('إدارة الغرفة')")));
    expect(menu.indexOf('إنهاء الجلسة'),
        lessThan(menu.indexOf('مغادرة الغرفة')));
  });

  test('room ID and ghost toggles are absent from normal room UI', () {
    expect(app, isNot(contains('Future<void> _showChangeRoomIdSheet()')));
    expect(menu, isNot(contains('تغيير معرّف الغرفة')));
    expect(menu, isNot(contains('إخفاء الوجود في الغرفة')));
    final changeId = worker.substring(
      worker.indexOf('async function changeRoomPublicId('),
      worker.indexOf('async function updateRoomSettings('),
    );
    expect(changeId, contains('const canManageId=permissions.manageIds'));
    expect(changeId, isNot(contains(
        'canManageRoomAction(room,user,uid,"manageIds")')));
  });
}
