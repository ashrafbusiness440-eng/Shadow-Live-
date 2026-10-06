import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('remaining VIP runtime surfaces reuse existing room and gift paths', () {
    final composer = File(
      'lib/features/room/widgets/room_chat_panel.dart',
    ).readAsStringSync();
    final presence = File(
      'lib/features/room/services/room_presence_service.dart',
    ).readAsStringSync();
    final giftCatalog = File(
      'lib/features/gift/services/gift_catalog_service.dart',
    ).readAsStringSync();
    final giftControl = File(
      'lib/admin/gift_catalog_control_page.dart',
    ).readAsStringSync();
    final control = File('lib/main_control.dart').readAsStringSync();
    final roomGift = File(
      'lib/features/gift/widgets/room_gift_sheet.dart',
    ).readAsStringSync();
    final directGift = File(
      'lib/features/gift/widgets/direct_gift_sheet.dart',
    ).readAsStringSync();

    expect(presence, contains('vipOnlinePriority'));
    expect(presence, contains('vipEmojiToken'));

    expect(composer, contains('إيموجي VIP الحصري'));
    expect(composer, contains('vipEmojiToken'));
    expect(composer, contains('VIP Emoji'));
    expect(composer, isNot(contains('Timer.periodic')));

    expect(giftCatalog, contains('minVipLevel'));
    expect(giftCatalog, contains('effectiveMinVipLevel'));
    expect(giftControl, contains('الحد الأدنى VIP'));
    expect(giftControl, contains("value:4"));
    expect(roomGift, contains('vip_gift_requires_level'));
    expect(directGift, contains('vip_gift_requires_level'));

    expect(control, contains('VIP1+ — خدمة عملاء VIP'));
    expect(control, contains('VIP4+ — قناة حصرية 1-to-1'));
    expect(control, contains('setCustomerServiceVipMode'));
  });

  test('VIP room bootstrap remains bounded and carries entitlement snapshot', () {
    final session = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final chat = File(
      'lib/features/room/services/room_chat_service.dart',
    ).readAsStringSync();

    expect(session, contains('vipEmojiToken'));
    expect(chat, contains('vipEmojiToken'));
    expect(session, isNot(contains('Timer.periodic')));
    expect(chat, isNot(contains('FirebaseFirestore')));
  });
}
