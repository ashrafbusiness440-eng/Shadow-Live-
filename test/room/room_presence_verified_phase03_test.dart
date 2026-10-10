import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  const persisted = DiscoveryRoom(
    id: 'room-a',
    data: {
      'name': 'غرفة الدردشة',
      'onlineCount': 85,
      'participantsCount': 85,
      'category': 'دردشة',
    },
  );

  test('missing realtime count is unknown, not a stale number or verified zero', () {
    final unknown = roomWithVerifiedPresence(persisted, null);
    expect(unknown.hasAvailablePresence, isFalse);
    expect(unknown.onlineCount, 0, reason: 'never sort by the old 85 count');
    expect(unknown.data['presenceState'], 'unavailable');
    expect(unknown.data['onlineCount'], 85, reason: 'preserve source metadata');
    expect(persisted.onlineCount, 85, reason: 'leave original documents untouched');
  });

  test('live zero differs from unknown; negative backend values are clamped', () {
    final zero = roomWithVerifiedPresence(persisted, 0);
    expect(zero.hasAvailablePresence, isTrue);
    expect(zero.data['presenceState'], 'live');
    expect(zero.onlineCount, 0);
    expect(zero.data['participantsCount'], 0);

    final actual = roomWithVerifiedPresence(persisted, 4);
    expect(actual.onlineCount, 4);
    expect(actual.data['participantsCount'], 4);
    expect(actual.hasAvailablePresence, isTrue);

    final broken = roomWithVerifiedPresence(persisted, -2);
    expect(broken.onlineCount, 0);
  });

  test('most-active ranking excludes rooms without verified live counts', () {
    final unknown = roomWithVerifiedPresence(persisted, null);
    final live = roomWithVerifiedPresence(
      const DiscoveryRoom(id: 'room-b', data: {'onlineCount': 0}),
      3,
    );
    final home = HomeDiscoveryData(
      userData: null,
      rooms: [unknown, live],
      people: const [],
      config: const {},
    );
    expect(home.mostActive.map((e) => e.id).toList(), ['room-b']);
    expect(home.suggested.map((e) => e.id).toList(), ['room-b', 'room-a']);
  });

  testWidgets('room tile clearly distinguishes live zero and unknown',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 760));
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ListView(children: [
            RoomListTile(
              room: roomWithVerifiedPresence(persisted, null),
              category: 'دردشة',
              onTap: () {},
            ),
          ]),
        ),
      ));
      expect(find.text('الحضور غير متاح'), findsOneWidget);
      expect(find.text('85 متصل'), findsNothing);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ListView(children: [
            RoomListTile(
              room: roomWithVerifiedPresence(persisted, 0),
              category: 'دردشة',
              onTap: () {},
            ),
          ]),
        ),
      ));
      expect(find.text('0 متصل'), findsOneWidget);
      expect(find.text('الحضور غير متاح'), findsNothing);
      expect(tester.takeException(), isNull);
    }
  });

  test('all discovery surfaces use verified marker without extra reads', () {
    final discovery = File('lib/features/home/services/discovery_service.dart')
        .readAsStringSync();
    final home = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    final search = File('lib/features/home/screens/discovery_search_screen.dart')
        .readAsStringSync();
    final rooms = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();

    expect(discovery.contains('roomWithVerifiedPresence(room, counts[room.id])'), isTrue);
    expect(discovery.contains("'presenceState': liveCount == null ? 'unavailable' : 'live'"), isTrue);
    expect(home.contains('room.hasAvailablePresence'), isTrue);
    expect(rooms.contains('room.hasAvailablePresence'), isTrue);
    expect(search.contains('roomWithVerifiedPresence(room, null)'), isTrue);
    expect(search.contains('cachedRoomsById[room.id]'), isTrue);
    expect(search.contains("room['presenceState'] == 'unavailable'"), isTrue);
    expect(search.contains('_discoveryService.hydrateRealtimeCounts('), isFalse);
    expect(discovery.contains('_realtime.loadCounts('), isTrue);
  });
}
