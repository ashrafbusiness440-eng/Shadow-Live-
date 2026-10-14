import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/admin_account_identity_tile.dart';
import 'package:voice_chat_room/admin/general_reports_control_page.dart';

void main() {
  test('general report labels show sources and localized moderation statuses', () {
    final report = GeneralReportItem(<String, dynamic>{
      'reportId': 'room_msg_1',
      'type': 'room_message_report',
      'status': 'under_review',
      'reporterUid': 'reporter',
      'targetUid': 'target',
      'reason': 'harassment',
      'evidence': <String, dynamic>{'message': <String, dynamic>{'text': 'رسالة'}},
    });
    expect(report.title, 'بلاغ عن رسالة داخل غرفة');
    expect(report.statusLabel, 'قيد المراجعة');
    expect(report.reasonLabel, 'مضايقة أو إساءة');
    expect(report.mapField('evidence')['message'], isNotNull);
    expect(GeneralReportItem(<String, dynamic>{
      'moderationAction': 'private_messages_restricted',
    }).actionLabel, contains('تقييد الرسائل الخاصة'));
    expect(generalReportErrorMessage(StateError('invalid_restriction_duration')),
        contains('مدة صحيحة'));
    expect(GeneralReportItem(<String, dynamic>{
      'moderationAction': 'room_chat_restricted',
    }).actionLabel, contains('الكتابة في الغرف'));
    expect(GeneralReportItem(<String, dynamic>{
      'moderationAction': 'room_entry_restricted',
    }).actionLabel, contains('منع دخول الغرف'));
    expect(GeneralReportItem(<String, dynamic>{
      'moderationAction': 'room_mic_restricted',
    }).actionLabel, contains('كتم المايكروفون'));
    expect(generalReportErrorMessage(StateError('invalid_report_transition')),
        contains('حالة البلاغ'));
  });

  testWidgets('authorized identity tile displays and opens reporter details RTL',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.binding.setSurfaceSize(const Size(360, 740));
    const identity = AdminAccountIdentity(
      uid: 'real_auth_uid_123',
      displayName: 'صاحب البلاغ الشخص الذي يقدم البلاغ',
      publicId: '12345678',
      profile: <String, dynamic>{},
    );
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: EdgeInsets.all(16),
            child: AdminAccountIdentityTile(
              roleLabel: 'مقدّم البلاغ',
              identity: identity,
            ),
          ),
        ),
      ),
    ));
    expect(find.text('مقدّم البلاغ'), findsOneWidget);
    expect(find.text('ID: 12345678'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.tap(find.byType(AdminAccountIdentityTile));
    await tester.pumpAndSettle();
    expect(find.text('نسخ معرّف الحساب'), findsOneWidget);
    expect(find.text('نسخ ID'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('admin report screens use one permission-gated Worker source', () {
    final main = File('lib/main_control.dart').readAsStringSync();
    final inbox =
        File('lib/admin/admin_notifications_page.dart').readAsStringSync();
    final screen = File('lib/admin/general_reports_control_page.dart')
        .readAsStringSync();
    final room = File('lib/main.dart').readAsStringSync();
    final client = File('lib/features/room/services/room_action_service.dart')
        .readAsStringSync();

    expect(main.contains("ControlItem('البلاغات'"), isTrue);
    expect(main.contains("ControlItem('بلاغات المستخدمين والغرف'"), isFalse);
    expect(inbox.contains("item.route == 'general_reports'"), isTrue);
    expect(inbox.contains('ReportsHubInboxRoute('), isTrue);
    expect(inbox.contains('reportId: item.targetId'), isTrue);
    expect(inbox.contains('reportType: item.type'), isTrue);
    expect(screen.contains("shadowApiEndpoint('general-reports')"), isTrue);
    expect(screen.contains("shadowApiEndpoint('manage-user-account')"), isTrue);
    expect(screen.contains("'liftPrivateMessagesRestriction'"), isTrue);
    expect(screen.contains("'liftRoomChatRestriction'"), isTrue);
    expect(screen.contains("'liftRoomEntryRestriction'"), isTrue);
    expect(screen.contains("'liftRoomMicRestriction'"), isTrue);
    expect(screen.contains("'restrictRoomMic'"), isTrue);
    expect(screen.contains("'setReportPriority'"), isTrue);
    expect(screen.contains("'getReporterContext'"), isTrue);
    expect(screen.contains('سياق البلاغات السابقة'), isTrue);
    expect(screen.contains('رفض بلاغ سابق لا يعني أنه بلاغ كيدي'), isTrue);
    expect(screen.contains('تعديل الأولوية'), isTrue);
    expect(screen.contains('سبب تغيير الأولوية — مطلوب'), isTrue);
    expect(GeneralReportItem(<String, dynamic>{
      'priority': 'urgent',
    }).priorityLabel, 'عاجل');
    expect(screen.contains('لقطة موثقة لحالة الغرفة وقت البلاغ'), isTrue);
    expect(screen.contains('ليست تسجيلًا صوتيًا'), isTrue);
    expect(screen.contains('AdminAccountIdentityTile('), isTrue);
    expect(screen.contains("'reviewReport'"), isTrue);
    expect(screen.contains('FirebaseFirestore'), isFalse);
    expect(screen.contains('.snapshots()'), isFalse);
    expect(screen.contains('Timer.periodic'), isFalse);
    expect(client.contains("'action': 'reportRoom'"), isTrue);
    expect(room.contains("'إبلاغ عن الغرفة'"), isTrue);
    expect(room.contains('_roomActions.reportRoom('), isTrue);
  });
}
