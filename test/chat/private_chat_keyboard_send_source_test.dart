import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('keyboard send action reuses guarded private-chat send handler', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final composerStart = source.indexOf('Widget _composer()');
    final composerEnd = source.indexOf('Widget _blockedComposer()', composerStart);
    expect(composerStart, greaterThan(0));
    expect(composerEnd, greaterThan(composerStart));
    final composer = source.substring(composerStart, composerEnd);
    expect(composer.contains('textInputAction: TextInputAction.send,'), isTrue);
    expect(composer.contains('onSubmitted: (_) => _send(),'), isTrue);
    expect(composer.contains('onPressed: _sending ? null : _send,'), isTrue);

    final sendStart = source.indexOf('Future<void> _send() async {');
    final sendEnd = source.indexOf('Future<void> _setBlocked(', sendStart);
    final send = source.substring(sendStart, sendEnd);
    expect(send.contains('text.isEmpty || _sending || text.length > 2000'), isTrue);
    expect(send.contains('_isActiveChatAccount(senderUid)'), isTrue);
    expect(send.contains('setState(() => _sending = true);'), isTrue);
  });
}
