import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('VIP4 animated avatar keeps a static fallback and server-only animation', () {
    final edit = File(
      'lib/features/user/screens/edit_profile_screen.dart',
    ).readAsStringSync();
    final storage = File(
      'lib/shared/services/user_storage_service.dart',
    ).readAsStringSync();
    final avatar = File(
      'lib/features/vip/widgets/vip_profile_avatar.dart',
    ).readAsStringSync();
    final rules = File('firestore.rules').readAsStringSync();

    expect(edit.contains("mime=='image/gif'"), isTrue);
    expect(edit.contains("vip<4"), isTrue);
    expect(edit.contains('img.encodeWebP'), isTrue);
    expect(edit.contains("profileAvatarAnimationObjectId"), isTrue);
    expect(edit.contains("animationToDelete"), isTrue);
    expect(edit.contains("_deleteStoredObject(animationToDelete)"), isTrue);
    expect(
      edit.contains("scope:'profile_avatar_animation'"),
      isTrue,
    );

    expect(storage.contains("'profile_avatar_animation'"), isTrue);
    expect(storage.contains("return 'image/gif';"), isTrue);

    expect(avatar.contains('profileAvatarAnimationUrl'), isTrue);
    expect(avatar.contains('vip >= 4'), isTrue);
    expect(avatar.contains('profileImageUrl'), isTrue);

    expect(rules.contains("'profileAvatarAnimationUrl'"), isTrue);
    expect(rules.contains("'profileAvatarAnimationObjectId'"), isTrue);
    expect(edit.contains("vip<4"), isTrue);
    expect(edit.contains("animationToDelete=_storedObjectId"), isTrue);
  });
}
