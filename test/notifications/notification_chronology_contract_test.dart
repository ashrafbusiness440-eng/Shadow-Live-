import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('notification pages are ordered at Firestore, not after the limit', () {
    final service = File(
      'lib/features/notifications/services/notification_service.dart',
    ).readAsStringSync();
    final page = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();

    expect(service.contains("where('userId', isEqualTo: uid)"), isTrue);
    expect(service.contains("orderBy('createdAt', descending: true)"), isTrue);
    expect(
      service.contains(
        'orderBy(FieldPath.documentId, descending: true)',
      ),
      isTrue,
    );
    expect(service.contains('.limit(pageLimit)'), isTrue);
    expect(service.contains('startAfterDocument(after)'), isTrue);
    expect(service.contains('static const int pageLimit = 50;'), isTrue);
    expect(service.contains("orderBy(FieldPath.documentId)"), isFalse);

    // Page snapshots must retain Firestore's deterministic cursor order.
    expect(service.contains('items.sort('), isFalse);
    expect(page.contains('_items.sort('), isFalse);
    expect(page.contains('_items.addAll(next.items)'), isTrue);
  });

  test('Firestore composite index matches notification pagination order', () {
    final indexes = jsonDecode(File('firestore.indexes.json').readAsStringSync())
        as Map<String, dynamic>;
    final entries = (indexes['indexes'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    final matches = entries.where(
      (index) => index['collectionGroup'] == 'notifications' &&
          index['queryScope'] == 'COLLECTION',
    );
    expect(matches, hasLength(1));
    final fields = (matches.single['fields'] as List<dynamic>)
        .cast<Map<String, dynamic>>();
    expect(
      fields,
      equals([
        {'fieldPath': 'userId', 'order': 'ASCENDING'},
        {'fieldPath': 'createdAt', 'order': 'DESCENDING'},
        {'fieldPath': '__name__', 'order': 'DESCENDING'},
      ]),
    );
  });
}
