import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('anonymous guest is gated even when the chat list is opened directly', () {
    final list = File('lib/features/chat/screens/chat_list_screen.dart')
        .readAsStringSync();
    expect(list.contains(
      'FirebaseAuth.instance.currentUser?.isAnonymous == true',
    ), isTrue);
    expect(list.contains('سجّل الدخول لعرض الرسائل'), isTrue);
  });

  test('direct conversation creation and chat routes reject guests', () {
    final actions = File(
      'lib/features/profile/services/profile_action_service.dart',
    ).readAsStringSync();
    expect(actions.contains('user == null || user.isAnonymous'), isTrue);
    final chat = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(chat.contains(
      'if (FirebaseAuth.instance.currentUser?.isAnonymous ?? true) return;',
    ), isTrue);
    expect(chat.contains(
      '(FirebaseAuth.instance.currentUser?.isAnonymous ?? true)',
    ), isTrue);
  });
}
