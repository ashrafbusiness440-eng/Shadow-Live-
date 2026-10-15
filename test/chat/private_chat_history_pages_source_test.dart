import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('private-chat history has bounded cursor reads and a manual trigger', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(source.contains('static const int _historyPageSize = 50;'), isTrue);
    expect(source.contains('.startAfterDocument(cursor)'), isTrue);
    expect(source.contains('.limit(_historyPageSize)'), isTrue);
    expect(source.contains('Future<void> _loadOlderMessages('), isTrue);
    expect(source.contains("label: Text(_historyLoading"), isTrue);
    expect(source.contains("'عرض رسائل أقدم'"), isTrue);
    expect(source.contains('onPressed: _historyLoading'), isTrue);
    expect(source.contains('_historyHasMore = page.docs.length == _historyPageSize'), isTrue);
    expect(source.contains('if (!_isActiveChatAccount(ownerUid)) return;'), isTrue);
    expect(source.contains("Timer.periodic("), isFalse);
  });

  test('live messages stay subscribed once and older pages are deduplicated', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(source.contains('late final Stream<User?> _authChanges;'), isTrue);
    expect(source.contains('late final Stream<QuerySnapshot<Map<String, dynamic>>> _messageChanges;'), isTrue);
    expect(source.contains('stream: _messageChanges,'), isTrue);
    expect(source.contains('stream: _authChanges,'), isTrue);
    expect(source.contains('.limit(100)'), isTrue);
    expect(source.contains('for (final doc in _loadedHistory.values) doc.id: doc,'), isTrue);
    expect(source.contains('for (final doc in recent) doc.id: doc,'), isTrue);
    expect(source.contains('final byTime = bm.compareTo(am);'), isTrue);
    expect(source.contains('b.id.compareTo(a.id)'), isTrue);
    expect(source.contains("itemCount: docs.length + (canLoadOlder ? 1 : 0)"), isTrue);
  });
}
