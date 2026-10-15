import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('inbox stays bounded and sorted with manual document cursors', () {
    final source = File('lib/features/chat/screens/chat_list_screen.dart')
        .readAsStringSync();
    expect(source.contains('static const int _inboxPageSize = 40;'), isTrue);
    expect(source.contains(".where('participants', arrayContains: ownerUid)"),
        isTrue);
    expect(source.contains(".orderBy('updatedAt', descending: true)"), isTrue);
    expect(source.contains('.limit(_inboxPageSize)'), isTrue);
    expect(source.contains('.startAfterDocument(cursor)'), isTrue);
    expect(source.contains('Future<void> _loadOlderInbox('), isTrue);
    expect(source.contains("'عرض محادثات أقدم'"), isTrue);
    expect(source.contains('stream: _watchInbox(me)'), isTrue);
    expect(source.contains('Timer.periodic('), isFalse);
  });

  test('hide visibility never uses an unbounded listener or reveals unchecked rows', () {
    final source = File('lib/features/chat/screens/chat_list_screen.dart')
        .readAsStringSync();
    expect(source.contains('.where(FieldPath.documentId, whereIn: chunk)'),
        isTrue);
    expect(source.contains('start += 30'), isTrue);
    expect(source.contains('_checkedHideIds.contains(doc.id)'), isTrue);
    expect(source.contains('if (unchecked) {'), isTrue);
    expect(source.contains('if (_hideReadFailed) {'), isTrue);
    expect(source.contains("'تعذر التأكد من خصوصية قائمة المحادثات.'"),
        isTrue);
    expect(source.contains(".collection('items')\n                          .snapshots()"),
        isFalse);
  });

  test('inbox rejects account swaps and late retry results', () {
    final source = File('lib/features/chat/screens/chat_list_screen.dart')
        .readAsStringSync();
    expect(source.contains('_inboxGeneration++'), isTrue);
    expect(source.contains('generation != _inboxGeneration'), isTrue);
    expect(source.contains('ownerUid == _pagedOwnerUid'), isTrue);
    expect(source.contains('FirebaseAuth.instance.currentUser?.uid == ownerUid'),
        isTrue);
    expect(source.contains('_resetInboxState();'), isTrue);
    expect(source.contains('for (final doc in live) doc.id: doc'), isTrue);
  });
}
