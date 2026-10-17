import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('text send retries use the original key after lost response', () {
    final source =
        File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    final send = source.split('Future<void> _send() async {')[1]
        .split('Future<void> _setBlocked(')[0];
    expect(send, contains('_pendingTextKey != null'));
    expect(send, contains('_pendingTextBody == text'));
    expect(send, contains('_pendingTextEmojiId == emojiId'));
    expect(send, contains("'idempotencyKey': key"));
    expect(send, contains('.timeout(const Duration(seconds: 15))'));
    expect(send, contains("response.statusCode >= 400 && response.statusCode < 500"));
    expect(send, contains("body['code'] != 'rate_limited'"));
  });

  test('old send cannot erase a newer draft or carry stale animated emoji', () {
    final source =
        File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    final send = source.split('Future<void> _send() async {')[1]
        .split('Future<void> _setBlocked(')[0];
    expect(send, contains('final draftRevision = _textDraftRevision;'));
    expect(send, contains('_textDraftRevision == draftRevision'));
    expect(send, contains('_controller.text.trim() == text'));
    expect(send, contains('_animatedEmojiId == emojiId'));
    expect(source, contains('_controller.addListener(_onTextDraftChanged)'));
    expect(source, contains('_controller.removeListener(_onTextDraftChanged)'));
    expect(source, contains('_clearPendingTextOperation();'));
    expect(source, contains('setState(() => _animatedEmojiId = null)'));
  });
}
