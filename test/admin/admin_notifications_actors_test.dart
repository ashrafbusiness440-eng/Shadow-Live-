import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/admin_notifications_page.dart';
import 'package:voice_chat_room/admin/admin_account_identity_tile.dart';

void main() {
  test('notification actors preserve roles, public account identity, and ordering', () {
    final item = AdminInboxItem.fromMap(<String, dynamic>{
      'key': 'diary_report_test',
      'type': 'diary_report',
      'title': 'بلاغ على تعليق',
      'targetId': 'test',
      'actors': <Map<String, dynamic>>[
        {
          'role': 'مقدّم البلاغ',
          'uid': 'reporter_uid',
          'profile': <String, dynamic>{
            'displayName': 'صاحب البلاغ',
            'publicId': '12345678',
          },
        },
        {
          'role': 'الحساب المبلّغ عليه',
          'uid': 'target_uid',
          'profile': <String, dynamic>{'displayName': 'صاحب التعليق'},
        },
        {'role': 'صاحب اليومية', 'uid': ''},
      ],
    });

    expect(item.actors.length, 2);
    expect(item.actors.first['role'], 'مقدّم البلاغ');
    final reporter = AdminAccountIdentity.fromProfile(
      item.actors.first['uid'] as String,
      Map<String, dynamic>.from(item.actors.first['profile'] as Map),
    );
    expect(reporter.displayName, 'صاحب البلاغ');
    expect(reporter.displayId, '12345678');
  });

  test('legacy inbox items without actor metadata remain readable', () {
    final item = AdminInboxItem.fromMap(<String, dynamic>{
      'key': 'user_report_legacy',
      'type': 'user_report',
      'targetId': 'legacy',
      'meta': <String, dynamic>{'reporterUid': 'legacy_uid'},
    });
    expect(item.actors, isEmpty);
    expect(item.targetId, 'legacy');
  });
}
