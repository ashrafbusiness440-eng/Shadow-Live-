import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/notifications/services/notification_service.dart';

void main() {
  test('notification parser preserves system message state', () {
    final createdAt = DateTime.utc(2026, 9, 30, 4, 30);
    final item = AppNotification.fromMap('notice-1', {
      'title': 'تم قبول طلب إنشاء الوكالة',
      'body': 'Shadow Agency — 623001',
      'type': 'agency_application_approved',
      'read': false,
      'createdAt': Timestamp.fromDate(createdAt),
    });

    expect(item.id, 'notice-1');
    expect(item.title, 'تم قبول طلب إنشاء الوكالة');
    expect(item.type, 'agency_application_approved');
    expect(item.read, isFalse);
    expect(item.createdAt?.millisecondsSinceEpoch, createdAt.millisecondsSinceEpoch);
  });

  test('notification parser uses safe defaults', () {
    final item = AppNotification.fromMap('notice-2', const {});
    expect(item.title, 'إشعار من النظام');
    expect(item.body, isEmpty);
    expect(item.type, 'system');
    expect(item.createdAt, isNull);
  });
}
