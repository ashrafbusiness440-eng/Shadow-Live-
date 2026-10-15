import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('private chat contents are isolated by the account opening the route', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();

    expect(source.contains('_openedByUid = FirebaseAuth.instance.currentUser?.uid;'), isTrue);
    expect(source.contains('expectedUid == _openedByUid'), isTrue);
    expect(source.contains('FirebaseAuth.instance.currentUser?.uid == expectedUid'), isTrue);
    expect(source.contains('StreamBuilder<User?>('), isTrue);
    expect(source.contains('stream: FirebaseAuth.instance.authStateChanges()'), isTrue);
    expect(source.contains('authSnapshot.data?.uid != _openedByUid'), isTrue);

    // Read receipts target the original account, not whoever logs in next.
    expect(source.contains(r"await _conversation.update({'unreadCounts.$ownerUid': 0});"), isTrue);
    expect(source.contains(r"await _conversation.update({'unreadCounts.$_uid': 0});"), isFalse);
  });

  test('text and image sends reject late account changes', () {
    final source = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final text = source.substring(
      source.indexOf('Future<void> _send() async {'),
      source.indexOf('Future<void> _setBlocked(', source.indexOf('Future<void> _send() async {')),
    );
    expect(text.contains('final senderUid = sender?.uid;'), isTrue);
    expect(text.contains('final token = await sender!.getIdToken();'), isTrue);
    expect(
      '_isActiveChatAccount(senderUid)'.allMatches(text).length,
      greaterThanOrEqualTo(4),
    );
    expect(text.contains("final key = [senderUid,"), isTrue);

    final image = source.substring(
      source.indexOf('Future<void> _sendImage() async {'),
      source.indexOf('Future<int> _selfVipLevel()', source.indexOf('Future<void> _sendImage() async {')),
    );
    expect(image.contains('await _sendImageOnce(senderUid!);'), isTrue);
    expect(image.contains('Future<void> _sendImageOnce(String senderUid)'), isTrue);
    expect(
      '_isActiveChatAccount(senderUid)'.allMatches(image).length,
      greaterThanOrEqualTo(8),
    );
    expect(image.contains("throw StateError('account_changed');"), isTrue);
    expect(image.contains("'lastSenderId': senderUid,"), isTrue);
    expect(image.contains("'senderId': senderUid,"), isTrue);
    expect(image.contains("await _deleteUploadedObjectQuietly(pending.objectId);"), isTrue);
    expect(image.contains("'lastSenderId': _uid,"), isFalse);
    expect(image.contains("'senderId': _uid,"), isFalse);
  });
}
