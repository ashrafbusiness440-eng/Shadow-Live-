import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/vip/utils/vip_public_state.dart';
import 'package:voice_chat_room/features/vip/widgets/vip_avatar_frame.dart';

void main() {
  test('public VIP uses effective level plus expiry and ignores legacy vipLevel', () {
    final now = DateTime.utc(2026, 10, 4, 12);

    expect(
      effectivePublicVipLevel(
        {
          'effectiveVipLevel': 7,
          'vipLevel': 5,
          'vipExpiresAt': Timestamp.fromDate(now.add(const Duration(days: 1))),
        },
        now: now,
      ),
      7,
    );

    expect(
      effectivePublicVipLevel(
        {
          'effectiveVipLevel': 7,
          'vipLevel': 5,
          'vipExpiresAt': Timestamp.fromDate(now.subtract(const Duration(seconds: 1))),
        },
        now: now,
      ),
      0,
    );

    expect(
      effectivePublicVipLevel(
        {
          'vipLevel': 5,
          'vipExpiresAt': Timestamp.fromDate(now.add(const Duration(days: 1))),
        },
        now: now,
      ),
      0,
    );
  });

  testWidgets('VIP frame and inline badge resolve new Asset Studio keys', (tester) async {
    final requested = <String>{};

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Column(
            children: [
              VipAvatarFrame(
                vipLevel: 6,
                avatarDiameter: 48,
                resolveUri: (key) async {
                  requested.add(key);
                  return null;
                },
                child: const ColoredBox(color: Colors.black),
              ),
              VipInlineBadge(
                vipLevel: 6,
                resolveUri: (key) async {
                  requested.add(key);
                  return null;
                },
              ),
            ],
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(requested, contains('vip.v6.profileFrame'));
    expect(requested, contains('vip.v6.badge'));
    expect(find.text('VIP6'), findsOneWidget);
  });

  test('public quick and room surfaces stay on effective VIP and new assets', () {
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final quickProfile = File(
      'lib/features/profile/widgets/quick_profile_sheet.dart',
    ).readAsStringSync();
    final roomChat = File(
      'lib/features/room/widgets/room_chat_panel.dart',
    ).readAsStringSync();
    final sharedAvatar = File(
      'lib/features/profile/widgets/profile_avatar_with_frame.dart',
    ).readAsStringSync();
    final roomRealtime = File(
      'cloudflare-worker/src/room-realtime.js',
    ).readAsStringSync();

    expect(publicProfile.contains('effectivePublicVipLevel(data)'), isTrue);
    expect(publicProfile.contains('ShadowAssetKeys.vipLevelBadge(vip)'), isTrue);
    expect(publicProfile.contains('ProfileAvatarWithFrame('), isTrue);
    expect(publicProfile.contains('useVipFallback: true'), isTrue);

    expect(quickProfile.contains('effectivePublicVipLevel(data)'), isTrue);
    expect(quickProfile.contains('ShadowAssetKeys.vipLevelBadge(vip)'), isTrue);
    expect(quickProfile.contains('ProfileAvatarWithFrame('), isTrue);
    expect(quickProfile.contains('useVipFallback: true'), isTrue);

    expect(roomChat.contains('VipInlineBadge('), isTrue);
    expect(roomChat.contains('ProfileAvatarWithFrame('), isTrue);
    expect(roomChat.contains('useVipFallback: true'), isTrue);
    expect(sharedAvatar.contains('VipAvatarFrame('), isTrue);

    expect(
      roomRealtime.contains('vipCosmeticsFromUser(profileData, DateTime.now().millisecondsSinceEpoch)') ||
          roomRealtime.contains('vipCosmeticsFromUser(profileData, Date.now())'),
      isTrue,
    );
    expect(roomRealtime.contains('profileData.vipLevel ??'), isFalse);
  });
}
