import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('self profile hides follow chat and relationship while keeping gift', () {
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quickProfile = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();

    expect(
      publicProfile.contains(
        "bool get _isSelf => FirebaseAuth.instance.currentUser?.uid == widget.userId",
      ),
      isTrue,
    );
    expect(publicProfile.contains('if (!isSelf) ...['), isTrue);
    expect(publicProfile.contains("label: const Text('طلب علاقة')"), isTrue);
    expect(publicProfile.contains("key: const Key('public-profile-copy-id')"), isTrue);
    expect(publicProfile.contains("label: const FittedBox(fit: BoxFit.scaleDown, child: Text('هدية'"), isTrue);

    expect(
      quickProfile.contains(
        "bool get _isSelf => FirebaseAuth.instance.currentUser?.uid == widget.userId",
      ),
      isTrue,
    );
    expect(quickProfile.contains('if (!isSelf) ...['), isTrue);
    expect(quickProfile.contains("key: const Key('quick-profile-copy-id')"), isTrue);
    expect(quickProfile.contains("key: const Key('quick-profile-gift')"), isTrue);
  });

  test('room chat avatar stays bound to sender and has image fallback', () {
    final roomChat = File(
      'lib/features/room/widgets/room_chat_panel.dart',
    ).readAsStringSync();

    expect(roomChat.contains('final uid = message.senderUid.trim();'), isTrue);
    expect(roomChat.contains('showQuickProfileSheet(context, userId: uid)'), isTrue);
    expect(roomChat.contains('Widget _senderAvatar(RoomChatMessage message)'), isTrue);
    expect(roomChat.contains('errorBuilder: (_, __, ___)'), isTrue);
    expect(roomChat.contains('child: _senderAvatar(message)'), isTrue);
  });
}
