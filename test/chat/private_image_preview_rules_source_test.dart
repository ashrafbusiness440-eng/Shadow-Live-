import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('both image send paths include the new message ID in the same batch', () {
    final s = File('lib/features/chat/screens/private_chat_screen.dart').readAsStringSync();
    expect(RegExp(r"'lastMessageId': messageRef.id").allMatches(s).length, 2);
    expect(s.contains("'lastMessage': '📷 صورة'"), isTrue);
    expect(s.contains("'lastMessage': '📷 صورة قيد المراجعة'"), isTrue);
    expect(s.contains('batch.set(messageRef, {'), isTrue);
    expect(s.contains('await batch.commit();'), isTrue);
  });
}
