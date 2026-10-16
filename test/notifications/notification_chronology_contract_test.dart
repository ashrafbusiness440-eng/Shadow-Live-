import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/notifications/services/notification_service.dart';

void main() {
  test('legacy selector includes only notifications missing createdAt', () {
    expect(notificationHasMissingCreatedAt({'title': 'old'}), isTrue);
    expect(notificationHasMissingCreatedAt({'createdAt': null}), isFalse);
    expect(notificationHasMissingCreatedAt({'createdAt': 1}), isFalse);
  });

  test('notification feed uses ordered, bounded pages and a legacy cursor', () {
    final service = File(
      'lib/features/notifications/services/notification_service.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    expect(service.contains(".where('userId', isEqualTo: uid)"), isTrue);
    expect(service.contains(".orderBy('createdAt', descending: true)"), isTrue);
    expect(
      service.contains('.orderBy(FieldPath.documentId, descending: true)'),
      isTrue,
    );
    expect(service.contains('.orderBy(FieldPath.documentId)'), isTrue);
    expect(service.contains('legacyCursor'), isTrue);
    expect(service.contains('legacyPhase'), isTrue);
    expect(service.contains('startAfterDocument(after!.legacyCursor!)'), isTrue);
    expect(service.contains('.limit(pageLimit)'), isTrue);
    expect(service.contains('static const int pageLimit = 50;'), isTrue);
    expect(screen.contains('_items.sort('), isFalse);
    expect(screen.contains('_items.addAll(next.items.where'), isTrue);
    expect(screen.contains('تحميل الإشعارات الأقدم'), isTrue);
  });

  test('the READY notifications index is defined for server order', () {
    final indexes = jsonDecode(
      File('firestore.indexes.json').readAsStringSync(),
    ) as Map<String, dynamic>;
    final entries = indexes['indexes'] as List<dynamic>;
    final matching = entries.where((item) =>
        item is Map &&
        item['collectionGroup'] == 'notifications' &&
        item['queryScope'] == 'COLLECTION').toList();
    expect(matching, hasLength(1));
    expect(matching.single['fields'], equals([
      {'fieldPath': 'userId', 'order': 'ASCENDING'},
      {'fieldPath': 'createdAt', 'order': 'DESCENDING'},
      {'fieldPath': '__name__', 'order': 'DESCENDING'},
    ]));
  });
}
