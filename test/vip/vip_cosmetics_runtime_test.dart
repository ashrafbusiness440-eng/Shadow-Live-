import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP cosmetics are wired to room, chat, and profile consumers', () {
    final room = File(
      'lib/features/room/widgets/room_chat_panel.dart',
    ).readAsStringSync();
    final chat = File(
      'lib/features/chat/screens/private_chat_screen.dart',
    ).readAsStringSync();
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quickProfile = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();
    final ownProfile = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    final identity = File(
      'lib/features/vip/widgets/vip_profile_identity.dart',
    ).readAsStringSync();

    expect(room.contains('vipChatBubble'), isTrue);
    expect(room.contains('vipNameEffect'), isTrue);
    expect(room.contains('vipGiftVisual'), isTrue);
    expect(room.contains("message.vipLevel >= 8"), isTrue);
    expect(room.contains('message.entryEffectKey'), isTrue);

    expect(chat.contains('VipCosmeticSurface'), isTrue);
    expect(chat.contains('VipCosmeticPolicy.chatBubbleKey'), isTrue);
    expect(chat.contains('VipCosmeticPolicy.giftVisualKey'), isTrue);

    expect(publicProfile.contains('VipProfileIdentitySurface'), isTrue);
    expect(publicProfile.contains('VipStyledName'), isTrue);
    expect(quickProfile.contains('VipProfileIdentitySurface'), isTrue);
    expect(quickProfile.contains('VipStyledName'), isTrue);
    expect(ownProfile.contains('VipProfileIdentitySurface'), isTrue);
    expect(ownProfile.contains('VipStyledName'), isTrue);

    expect(identity.contains('profileBackgroundKey'), isTrue);
    expect(identity.contains('dataCardKey'), isTrue);
    expect(identity.contains('profileDecorationKey'), isTrue);
    expect(identity.contains('nameEffectKey'), isTrue);
  });

  test('VIP profile background renders behind profile content', () {
    final identity = File(
      'lib/features/vip/widgets/vip_profile_identity.dart',
    ).readAsStringSync();

    final background = identity.indexOf("if (backgroundKey.isNotEmpty)");
    final child = identity.indexOf("          child,", background);
    final dataCard = identity.indexOf("if (dataCardKey.isNotEmpty)", child);
    expect(background, greaterThanOrEqualTo(0));
    expect(child, greaterThan(background));
    expect(dataCard, greaterThan(child));
  });
}
