import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/home_screen.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_avatar_with_frame.dart';

void main() {
  testWidgets('compact room card fits narrow RTL screens and opens only on tap',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 760));
      var opens = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: Align(
              alignment: Alignment.topRight,
              child: SizedBox(
                height: 126,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: [
                    HomeCompactRoomCard(
                      room: const DiscoveryRoom(
                        id: 'room',
                        data: {
                          'name': 'غرفة عربية باسم طويل جداً للاختبار',
                          'presenceState': 'unavailable',
                          'onlineCount': 39,
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
        ),
      ));
      expect(find.text('الحضور غير متاح'), findsOneWidget);
      final card = find.byType(HomeCompactRoomCard);
      expect(card, findsOneWidget);
      expect(tester.getSize(card).width, lessThanOrEqualTo(140));
      expect(tester.takeException(), isNull);
      await tester.tap(card);
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
                          'vipLevel': 4,
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
      expect(find.text('VIP 4 • LV.7'), findsOneWidget);
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
    expect(home.contains('if (suggestedPeople.isNotEmpty) ...['), isTrue);
    expect(home.contains('if (events.isNotEmpty) ...['), isTrue);
    expect(home.contains('if (ranking.isNotEmpty) ...['), isTrue);
    expect(home.contains('childAspectRatio: 2.1'), isTrue);
    expect(home.contains('height: 126,'), isTrue);
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
