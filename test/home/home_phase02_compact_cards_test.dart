import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/home_screen.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';

void main() {
  testWidgets('four square rooms fit a 2x2 RTL grid without stale counts',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 900));
      var opens = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 1,
                children: [
                  for (var i = 0; i < 4; i++)
                    HomeCompactRoomCard(
                      room: DiscoveryRoom(
                        id: 'room-$i',
                        data: {
                          'name': 'غرفة عربية باسم طويل جداً للاختبار',
                          'roomType': 'agency',
                          'country': 'الإمارات',
                          'presenceState': i == 0 ? 'unavailable' : 'live',
                          'onlineCount': i == 0 ? 39 : i,
                          'isFeatured': true,
                        },
                      ),
                      onTap: () => opens++,
                    ),
                ],
              ),
            ),
          ),
        ),
      ));
      final cards = find.byType(HomeCompactRoomCard);
      expect(cards, findsNWidgets(4));
      final size = tester.getSize(cards.first);
      expect((size.width - size.height).abs(), lessThan(1));
      expect(find.textContaining('وكالة'), findsNWidgets(4));
      expect(find.text('الإمارات العربية المتحدة'), findsNWidgets(4));
      // The first room has no verified presence, so its stale 39 is hidden.
      expect(find.text('39'), findsNothing);
      expect(find.text('—'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(cards.first);
      expect(opens, 1);
    }
  });

  testWidgets('compact person card uses profile snapshot and preserves VIP',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 760));
      var profiles = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: Align(
              alignment: Alignment.topRight,
              child: SizedBox(
                height: 110,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    HomeCompactPersonCard(
                      person: const DiscoveryPerson(
                        id: 'person',
                        data: {
                          'displayName': 'مستخدم عربي باسم طويل جداً',
                          'level': 7,
                          'effectiveVipLevel': 4,
                          'vipExpiresAt': '2099-01-01T00:00:00Z',
                          'isOnline': true,
                        },
                      ),
                      onTap: () => profiles++,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ));
      final card = find.byType(HomeCompactPersonCard);
      expect(card, findsOneWidget);
      expect(find.byType(ProfileAvatarWithFrame), findsOneWidget);
      expect(
        tester.widget<ProfileAvatarWithFrame>(
          find.byType(ProfileAvatarWithFrame),
        ).snapshotOnly,
        isTrue,
      );
      expect(find.text('VIP 4'), findsOneWidget);
      expect(find.text('LV.7'), findsNothing);
      expect(tester.getSize(card).width, lessThanOrEqualTo(120));
      expect(tester.takeException(), isNull);
      await tester.tap(card);
      expect(profiles, 1);
    }
  });

  test('home only displays populated sections and their linked shortcuts', () {
    final home = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    expect(home.contains('if (activeRooms.isNotEmpty) ...['), isTrue);
    // Do not display the same verified room in both discovery rails.
    expect(home.contains('discovery?.otherActiveForHome'), isTrue);
    // On narrow devices the search hint cannot overflow the RTL row.
    expect(home.contains("maxLines: 1,\n                overflow: TextOverflow.ellipsis,\n                style: TextStyle(color: Colors.white54, fontSize: 13),"), isTrue);
    // No disabled fake Games feature if its real tab callback was omitted.
    expect(home.contains('if (widget.onOpenGames != null)'), isTrue);
    // The hero's real room CTA remains a full-size mobile tap target.
    expect(home.contains('height: 44,\n                        child: OutlinedButton.icon('), isTrue);

    expect(home.contains('if (suggestedPeople.isNotEmpty) ...['), isTrue);
    expect(home.contains('if (events.isNotEmpty) ...['), isTrue);
    expect(home.contains('if (ranking.isNotEmpty) ...['), isTrue);
    expect(home.contains('childAspectRatio: 2.1'), isTrue);
    expect(home.contains('GridView.count('), isTrue);
    expect(home.contains('rooms.take(4)'), isTrue);
    expect(home.contains('height: 110,'), isTrue);
    expect(home.contains('roomSurfaceImageUrl(room.data)'), isTrue);
    expect(home.contains('snapshotOnly: true,'), isTrue);
    expect(home.contains('if (person.isOnline)'), isFalse);
    expect(home.contains('Timer.periodic'), isFalse);
    expect(home.contains('RoomRealtimeQueryService('), isFalse);

    const discovery = HomeDiscoveryData(
      userData: null,
      rooms: [],
      people: [],
      config: {},
    );
    expect(discovery.mostActive, isEmpty);
    expect(discovery.suggestedPeople, isEmpty);
    expect(discovery.events, isEmpty);
    expect(discovery.rankingPreview, isEmpty);
  });
}
