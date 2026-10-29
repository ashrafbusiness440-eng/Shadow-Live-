import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/widgets/room_chat_panel.dart';
import 'package:voice_chat_room/features/room/services/room_chat_service.dart';

void main() {
  test('verified Store key is accepted only while valid and enabled', () {
    const key = 'store.item.200004.visual';
    expect(verifiedStoreChatVisualKey(
      key, 2000, effectsEnabled: true,
      mysteriousMode: false, nowMs: 1000), key);
    expect(verifiedStoreChatVisualKey(
      key, 1000, effectsEnabled: true,
      mysteriousMode: false, nowMs: 1000), '');
    expect(verifiedStoreChatVisualKey(
      key, 0, effectsEnabled: false,
      mysteriousMode: false, nowMs: 1000), '');
    expect(verifiedStoreChatVisualKey(
      key, 0, effectsEnabled: true,
      mysteriousMode: true, nowMs: 1000), '');
    expect(verifiedStoreChatVisualKey(
      'store.item.200004.icon', 0, effectsEnabled: true,
      mysteriousMode: false, nowMs: 1000), '');
    expect(verifiedStoreChatVisualKey(
      'store.item.abcdef.visual', 0, effectsEnabled: true,
      mysteriousMode: false, nowMs: 1000), '');
  });

  test('room chat model carries exactly server-projected cosmetics', () {
    final message = RoomChatMessage.fromMap(<String,dynamic>{
      'id': 'a', 'senderUid': 'u', 'text': 'مرحبا',
      'storeChatBubbleKey': 'store.item.200004.visual',
      'storeChatBubbleExpiresAtMs': 2000,
      'storeNameEffectKey': 'store.item.200005.visual',
      'storeNameEffectExpiresAtMs': 0,
    });
    expect(message.storeChatBubbleKey, 'store.item.200004.visual');
    expect(message.storeNameEffectKey, 'store.item.200005.visual');
    expect(message.storeChatBubbleExpiresAtMs, 2000);
    expect(message.storeNameEffectExpiresAtMs, 0);
    final legacy = RoomChatMessage.fromMap(<String,dynamic>{
      'id': 'b', 'senderUid': 'u', 'text': 'old',
    });
    expect(legacy.storeChatBubbleKey, isEmpty);
    expect(legacy.storeNameEffectKey, isEmpty);
  });
}
