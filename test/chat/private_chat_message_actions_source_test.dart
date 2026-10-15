import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('message bubble exposes copy and per-user hide on long-press', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(source.contains('Widget _messageBubble(QueryDocumentSnapshot'), isTrue);
    expect(source.contains('onLongPress: () => _showMessageActions(doc)'), isTrue);
    expect(source.contains('Clipboard.setData(ClipboardData(text: copyText))'), isTrue);
    expect(source.contains("'hideMessageForMe'"), isTrue);
    expect(source.contains("'حذف من عندي'"), isTrue);
    expect(source.contains('return _messageBubble(docs[index]);'), isTrue);
  });

  test('sender-only five minute delete for both is guarded by the worker', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(source.contains('elapsed <= const Duration(minutes: 5)'), isTrue);
    expect(source.contains("'deleteMessageForEveryone'"), isTrue);
    expect(source.contains("'حذف من الطرفين'"), isTrue);
    expect(source.contains("body['code'] == 'delete_window_expired'"), isTrue);
    expect(source.contains(r"Uri.parse('$_apiBase/chat-actions')"), isTrue);
    expect(source.contains("final accountUid = _openedByUid;"), isTrue);
    expect(source.contains("_isActiveChatAccount(accountUid)"), isTrue);
  });

  test('private-chat tombstones and individual hides use one existing listener', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(source.contains("data['deletedForEveryone'] == true"), isTrue);
    expect(source.contains("'تم حذف هذه الرسالة'"), isTrue);
    expect(source.contains("doc.data()['hiddenForUids']"), isTrue);
    expect(source.contains('_locallyHiddenMessageIds.add(messageId)'), isTrue);
    expect(source.contains('_locallyDeletedMessageIds.add(messageId)'), isTrue);
    expect(source.contains('hidden.contains(_openedByUid)'), isTrue);
    expect(source.contains('stream: _messageChanges,'), isTrue);
  });
}
