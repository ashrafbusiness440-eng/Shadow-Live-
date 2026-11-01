import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final app = File('lib/main.dart').readAsStringSync();
  final manager = File(
    'lib/features/room/widgets/room_moderator_manager_sheet.dart',
  ).readAsStringSync();
  final info = app.substring(
    app.indexOf('Future<void> _showRoomInfoSheet()'),
    app.indexOf('Future<void> _showRoomSettingsSheet()'),
  );

  test('room info shows framed owner and a quick-profile action', () {
    expect(info, contains("'مالك الغرفة'"));
    expect(info, contains('ProfileAvatarWithFrame('));
    expect(info, contains('userId: ownerUid,'));
    expect(info, contains('showQuickProfileSheet(context,'));
  });

  test('room facts are two-column, accurate and unknown-friendly', () {
    expect(info, contains('GridView.count('));
    expect(info, contains('crossAxisCount: 2,'));
    for (final fact in [
      "'ID'", "'النوع'", "'الدولة'", "'التصنيف'",
      "'الوقت'", "'المستوى'", "'الحضور'", "'كلمة المرور'",
    ]) {
      expect(info, contains(fact));
    }
    expect(info, contains('final online = _roomAudienceCountLabel;'));
    expect(info, contains("sessionMinutes == null"));
  });

  test('moderators are visible to everyone, edits remain owner-only', () {
    expect(info, contains("label: const Text('مشرفو الغرفة')"));
    expect(info, contains('_showRoomModeratorsSheet()'));
    expect(manager, contains('state?.isOwner == true && !_busy'));
    expect(manager, contains('state.isOwner && !_busy'));
  });

  test('moderator candidate can be selected from live participants or friends', () {
    expect(manager, contains('final List<RoomPresenceUser> participants;'));
    expect(manager, contains('widget.participants'));
    expect(manager, contains('tooltip: \'من الأصدقاء\''));
    expect(manager, contains('tooltip: \'من الحضور\''));
    expect(manager, contains('_friendsService.loadFriends()'));
    expect(manager, contains('targetUid: existing?.uid ?? pickedUid'));
    expect(manager, contains("labelText: 'معرّف المستخدم (ID)'"));
    expect(manager, isNot(contains('maxLength: 6')));
    expect(manager, isNot(contains("'manageIds': 'تغيير ID الغرفة'")));
    expect(app, contains('participants: _voiceSession.roomParticipants,'));
  });

  test('rapid taps cannot stack moderator editor and people pickers', () {
    expect(manager, contains('if (_busy || _editorOpen) return;'));
    expect(manager, contains('_editorOpen = true;'));
    expect(manager, contains('_editorOpen = false;'));
    expect(manager, contains('if (pickerOpen || _busy) return;'));
    expect(manager, contains('pickerOpen = true;'));
    expect(manager, contains('pickerOpen = false;'));
    expect(manager, contains('publicIdController.dispose();'));
    expect(manager, isNot(contains('Timer.periodic')));
  });

  test('sharing does not claim unverified friends are online', () {
    expect(app, isNot(contains("friend.online\n                                        ? 'متصل الآن'")));
    expect(app, contains("subtitle: const Text(\n                                    'صديق'"));
    final sharing = app.substring(
      app.indexOf('Future<void> _showShareRoomSheet()'),
      app.indexOf('Future<void> _showRoomInfoSheet()'),
    );
    expect(sharing, contains('final friendsFuture = _roomInvites.loadFriends();'));
    expect(sharing, contains('future: friendsFuture,'));
    expect(sharing, isNot(contains('future: _roomInvites.loadFriends(),')));
  });
}
