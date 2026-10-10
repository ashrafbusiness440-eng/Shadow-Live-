import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  test('pinned official rooms first, other rooms by true presence count', () {
    const rooms = <DiscoveryRoom>[
      DiscoveryRoom(
        id: 'popular',
        data: {'name': 'Popular', 'onlineCount': 90},
      ),
      DiscoveryRoom(
        id: 'plain-official',
        data: {
          'name': 'Ordinary official',
          'roomType': 'official',
          'onlineCount': 60,
        },
      ),
      DiscoveryRoom(
        id: 'featured-normal',
        data: {
          'name': 'Featured normal',
          'isFeatured': true,
          'onlineCount': 25,
        },
      ),
      DiscoveryRoom(
        id: 'pinned-official',
        data: {
          'name': 'Pinned official',
          'systemOwned': true,
          'isFeatured': true,
          'onlineCount': 2,
        },
      ),
      DiscoveryRoom(
        id: 'pinned-flag',
        data: {
          'name': 'Pinned by explicit flag',
          'officialRoom': true,
          'isPinned': true,
          'onlineCount': 1,
        },
      ),
    ];
    final sorted = [...rooms]..sort(comparePublicDiscoveryRooms);
    expect(sorted.take(2).map((e) => e.id).toSet(), {
      'pinned-official',
      'pinned-flag',
    });
    expect(sorted.skip(2).map((e) => e.id).toList(), [
      'popular',
      'plain-official',
      'featured-normal',
    ]);
    expect(isPinnedOfficialDiscoveryRoom(rooms[1]), isFalse);
    expect(isPinnedOfficialDiscoveryRoom(rooms[2]), isFalse);
    expect(isPinnedOfficialDiscoveryRoom(rooms[3]), isTrue);
  });

  test('room ranking is stable on ties and keeps only metadata checks', () {
    const a = DiscoveryRoom(id: 'a', data: {'onlineCount': 5});
    const z = DiscoveryRoom(id: 'z', data: {'onlineCount': 5});
    expect(comparePublicDiscoveryRooms(a, z), lessThan(0));
    expect(comparePublicDiscoveryRooms(z, a), greaterThan(0));
  });

  testWidgets('RTL compact room card fits narrow widths with long text',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 750));
      var openings = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          backgroundColor: const Color(0xFF05060D),
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: Center(
              child: SizedBox(
                width: width - 24,
                child: RoomListTile(
                  room: const DiscoveryRoom(
                    id: 'long-room',
                    data: {
                      'name': 'غرفة رسمية ذات اسم طويل لا ينبغي أن يتجاوز حدود الشاشة مهما طال الاسم',
                      'description': 'وصف طويل للغرفة للعرض بشكل مختصر دون خروج عن حدود البطاقة',
                      'visibility': 'password',
                      'onlineCount': 125,
                    },
                  ),
                  category: 'دردشة',
                  onTap: () => openings++,
                ),
              ),
            ),
          ),
        ),
      ));
      expect(find.textContaining('غرفة رسمية ذات اسم طويل'), findsOneWidget);
      expect(find.text('125 متصل'), findsOneWidget);
      expect(find.text('بكلمة مرور'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byType(RoomListTile));
      await tester.pump();
      expect(openings, 1);
    }
  });

  testWidgets('regular compact card preserves a large tap target',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(360, 740));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Center(
          child: RoomListTile(
            room: const DiscoveryRoom(
              id: 'compact-room',
              data: {'name': 'غرفة المحادثة', 'onlineCount': 8},
            ),
            category: 'دردشة',
            onTap: () {},
          ),
        ),
      ),
    ));
    final height = tester.getSize(find.byType(RoomListTile)).height;
    expect(height, greaterThanOrEqualTo(48));
    expect(height, lessThan(100), reason: 'Compact tiles should not revert to the old 100px card');
    expect(tester.takeException(), isNull);
  });

  test('room card uses existing shared image and bounded source only', () {
    final source = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();
    expect(source.contains('..sort(comparePublicDiscoveryRooms)'), isTrue);
    expect(source.contains('roomSurfaceImageUrl(room.data)'), isTrue);
    expect(source.contains('_service.loadRooms('), isTrue);
    expect(source.contains('StreamBuilder('), isFalse);
    expect(source.contains('FirebaseFirestore.instance'), isFalse);
  });
}
