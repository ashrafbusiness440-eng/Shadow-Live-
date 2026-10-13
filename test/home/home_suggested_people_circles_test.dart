import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/home_screen.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';

void main() {
  const person = DiscoveryPerson(
    id: 'circular-person',
    data: {
      'displayName': 'اسم عربي لمستخدم مقترح',
      'effectiveVipLevel': 3,
      'vipExpiresAt': '2099-01-01T00:00:00Z',
    },
  );

  testWidgets('circular suggestion and corner follow work at phone widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      var opens = 0;
      var follows = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: SizedBox(
              height: 110,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  HomeCompactPersonCard(
                    person: person,
                    isFollowing: false,
                    onTap: () => opens++,
                    onFollow: () => follows++,
                  ),
                ],
              ),
            ),
          ),
        ),
      ));

      final card = find.byType(HomeCompactPersonCard);
      final follow = find.byKey(const Key('home-follow-circular-person'));
      final avatar = find.byType(ProfileAvatarWithFrame);
      expect(card, findsOneWidget);
      expect(avatar, findsOneWidget);
      expect(follow, findsOneWidget);
      expect(tester.getSize(card).width, lessThanOrEqualTo(110));
      expect(tester.getSize(follow), const Size(44, 44));
      expect(tester.getCenter(follow).dy, lessThan(tester.getCenter(avatar).dy));
      expect(find.text('VIP 3'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.tap(follow);
      expect(follows, 1);
      expect(opens, 0);
      await tester.tap(find.text('اسم عربي لمستخدم مقترح'));
      expect(opens, 1);
    }
  });

  test('card reuses cached visual identity and has no extra follow listener',
      () {
    final src = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    expect(src.contains('PositionedDirectional('), isTrue);
    expect(src.contains('diameter: 64,'), isTrue);
    expect(src.contains('frameScale: 1.08,'), isTrue);
    expect(src.contains('snapshotOnly: true,'), isTrue);
    expect(src.contains('_followService.followingAmong('), isTrue);
    expect(src.contains('_followService.isFollowing('), isFalse);
    expect(src.contains('RoomRealtimeQueryService('), isFalse);
    expect(src.contains('Timer.periodic'), isFalse);
  });
}
