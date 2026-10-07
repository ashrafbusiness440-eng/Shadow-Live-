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
    expect(roomChat.contains('ProfileAvatarWithFrame('), isTrue);
    expect(roomChat.contains('userId: message.senderUid'), isTrue);
    expect(roomChat.contains("'profileImageUrl': message.profileImageUrl"), isTrue);
    expect(roomChat.contains('fallbackIsVisualSnapshot: true'), isTrue);
  });
  test('own profile reuses existing user data for levels mood and interests', () {
    final ownProfile = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();

    expect(ownProfile.contains('UserLevelBadges.fromLevels('), isTrue);
    expect(ownProfile.contains("wealthLevel: _num(profile, ['wealthLevel'])"), isTrue);
    expect(ownProfile.contains("attractionLevel: _num(profile, ['attractionLevel'])"), isTrue);
    expect(ownProfile.contains("gameLevel: _num(profile, ['gameLevel'])"), isTrue);
    expect(ownProfile.contains("final moodEmoji = _text(profile, 'moodEmoji', '').trim();"), isTrue);
    expect(ownProfile.contains("final interests = profile['interests'] is List"), isTrue);
    expect(ownProfile.contains('UserLevelService()'), isFalse);
    expect(
      ownProfile.contains("_num(profile, ['effectiveVipLevel'])"),
      isTrue,
    );
    expect(
      ownProfile.contains("_num(profile, ['effectiveVipLevel', 'vipLevel'])"),
      isFalse,
    );
  });

}
