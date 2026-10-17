import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/notifications/services/notification_service.dart';

void main() {
  test('call notification retains sender, conversation, and call id', () {
    final call = AppNotification.fromMap('call-alert', {
      'type': 'private_call_incoming',
      'userId': 'bob', 'senderId': 'alice', 'conversationId': 'c1',
      'callId': 'abcdef0123456789abcdef0123456789',
      'createdAt': Timestamp.fromMillisecondsSinceEpoch(12345),
    });
    expect(call.callSenderId, 'alice');
    expect(call.callConversationId, 'c1');
    expect(call.callId, 'abcdef0123456789abcdef0123456789');
  });

  test('existing notifications bell opens incoming call only after a user tap', () {
    final screen = File(
      'lib/features/notifications/screens/notifications_page.dart',
    ).readAsStringSync();
    expect(screen, contains("item.type == 'private_call_incoming'"));
    expect(screen, contains("item.type == 'private_call_missed'"));
    expect(screen, contains('PrivateCallIncomingDialog('));
    expect(screen, contains('accountUid: ownerUid'));
    expect(screen, contains('callId: item.callId!'));
  });

  test('call history events have visible labels and cannot be deleted as text', () {
    final chat = File(
      'lib/features/chat/screens/private_chat_screen.dart',
    ).readAsStringSync();
    expect(chat, contains("type == 'call_event'"));
    expect(chat, contains('مكالمة فائتة'));
    expect(chat, contains('مكالمة صوتية مكتملة'));
    expect(chat, contains("data['durationSeconds']"));
    expect(chat, contains("onLongPress: type == 'call_event' ? null"));
    expect(chat, contains("if (data['type'] == 'call_event') return false;"));
  });

  test('receiver leaves the public room only after accepted status', () {
    final ui = File(
      'lib/features/chat/widgets/private_call_incoming_dialog.dart',
    ).readAsStringSync();
    expect(ui, contains('final state = await _client.respond('));
    expect(ui, contains("if (!accept || state.status != 'active')"));
    expect(ui, contains('await _client.mediaSession('));
    expect(ui, contains('await _voice.enterPrivateCallMedia('));
    expect(ui, contains('const Duration(seconds: 12)'));
    expect(ui, contains('await _client.renew('));
    expect(ui.contains("if (_status == 'active' && !_active)"), isFalse);
    expect(ui, contains("!(_status == 'active' && !_active)"));
    expect(ui, contains('توقف الصوت'));
  });
}
