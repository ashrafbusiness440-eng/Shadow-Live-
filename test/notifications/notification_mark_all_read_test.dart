import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/notifications/services/notification_service.dart';

void main() {
  test('mark-all keeps newly created notifications unread and includes legacy', () {
    final cutoff = Timestamp.fromMillisecondsSinceEpoch(100000);
    expect(notificationEligibleForBulkRead({
      'read': false,
      'createdAt': Timestamp.fromMillisecondsSinceEpoch(99999),
    }, cutoff), isTrue);
    expect(notificationEligibleForBulkRead({
      'read': false,
      'createdAt': Timestamp.fromMillisecondsSinceEpoch(100001),
    }, cutoff), isFalse);
    expect(notificationEligibleForBulkRead({
      'read': false,
      'createdAt': DateTime.fromMillisecondsSinceEpoch(100001),
    }, cutoff), isFalse);
    expect(notificationEligibleForBulkRead({
      'read': false,
      'title': 'historical without timestamp',
    }, cutoff), isTrue);
    expect(notificationEligibleForBulkRead({
      'read': true,
      'createdAt': Timestamp.fromMillisecondsSinceEpoch(99999),
    }, cutoff), isFalse);
  });

  test('mark-all reuses owner-scoped unread index with finite batches', () {
    final source = File(
      'lib/features/notifications/services/notification_service.dart',
    ).readAsStringSync();
    expect(source, contains('Future<MarkAllNotificationsResult> markAllRead() async'));
    expect(source, contains(".where('userId', isEqualTo: uid)"));
    expect(source, contains(".where('read', isEqualTo: false)"));
    expect(source, contains('const batchSize = 100;'));
    expect(source, contains('const maxBatches = 30;'));
    expect(source, contains('await batch.commit();'));
    expect(source, contains("throw StateError('account_changed')"));
    expect(source, contains('complete: false'));
  });

  test('notification page only acknowledges after confirmation', () {
    final source = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    expect(source, contains("Text('تعليم الكل كمقروء')"));
    expect(source, contains('final result = await _service.markAllRead();'));
    expect(source, contains('await _reload();'));
    expect(source, contains('_markingAllRead = false;'));
    expect(source, contains('some nonexistent per-item listener'), isFalse);
  });
}
