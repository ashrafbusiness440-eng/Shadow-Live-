import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/services/profile_visual_identity_service.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';

void main() {
  test('public name travels with the existing batched visual identity', () {
    final identity = ProfileVisualIdentity.fromMap('other-user', {
      'displayName': 'صديق شادو',
      'profileAvatarAsset': 'assets/mock/avatar.png',
      'effectiveVipLevel': 4,
      'vipExpiresAt': DateTime(2030),
    });
    final data = identity.toProfileMap();
    expect(data['displayName'], 'صديق شادو');
    expect(data['profileAvatarAsset'], 'assets/mock/avatar.png');
    expect(data['effectiveVipLevel'], 4);

    final legacy = ProfileVisualIdentity.fromMap(
      'legacy-user',
      {'username': 'اسم الحساب'},
    );
    expect(legacy.displayName, 'اسم الحساب');
  });

  testWidgets('empty visual snapshot renders on a narrow screen without reads',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: ProfileAvatarWithFrame(
          diameter: 40,
          userId: 'other-user',
          snapshotOnly: true,
          fallbackProfile: {'displayName': 'صديق شادو'},
        ),
      ),
    ));
    expect(find.byType(CircleAvatar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('chat list uses one bounded batched read per unique user', () {
    final chat = File('lib/features/chat/screens/chat_list_screen.dart')
        .readAsStringSync();
    final shared =
        File('lib/features/profile/services/profile_visual_identity_service.dart')
            .readAsStringSync();

    expect(chat.contains('ProfileVisualIdentityService.instance.load('), isTrue);
    expect(chat.contains('requirePublicRecord: true'), isTrue);
    expect(chat.contains('_identityReads[id]'), isTrue);
    expect(chat.contains('_identityReads.length > 80'), isTrue);
    expect(chat.contains('_identityOwnerUid != me'), isTrue);
    expect(chat.contains('_identityInvalidations?.cancel()'), isTrue);
    expect(chat.contains('identityFuture: _identityFor(other)'), isTrue);
    expect(chat.contains('FutureBuilder<ProfileVisualIdentity>('), isTrue);
    expect(chat.contains('snapshotOnly: true'), isTrue);

    // No extra public_profiles/users GET per rebuilt message-row.
    expect(chat.contains('Future<Map<String, dynamic>> _loadUser()'), isFalse);
    expect(chat.contains("collection('users').doc(otherUid).get()"), isFalse);
    expect(chat.contains('future: otherUid.isEmpty ? null : _loadUser()'), isFalse);

    // A room-primed image does not count as a full public profile record.
    expect(shared.contains('fromPublicRecord: true'), isTrue);
    expect(shared.contains('cached.fromPublicRecord'), isTrue);
    expect(shared.contains('_maxCacheEntries = 160'), isTrue);
    expect(shared.contains('whereIn: batch'), isTrue);
    expect(shared.contains('_batchSize = 10'), isTrue);
  });
}
