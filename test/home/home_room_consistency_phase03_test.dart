import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  const pinned = DiscoveryRoom(
    id: 'pinned-official',
    data: {
      'name': 'Pinned system room',
      'systemOwned': true,
      'isPinned': true,
      'onlineCount': 1,
    },
  );
  const busy = DiscoveryRoom(
    id: 'busy',
    data: {'name': 'Busy chat', 'onlineCount': 80},
  );
  const ordinaryFeatured = DiscoveryRoom(
    id: 'featured-ordinary',
    data: {'name': 'Featured public', 'isFeatured': true, 'onlineCount': 5},
  );
  const officialNotPinned = DiscoveryRoom(
    id: 'official-not-pinned',
    data: {'name': 'Official without pin', 'roomType': 'official', 'onlineCount': 20},
  );

  test('Home and room list share the exact priority for official pinned rooms', () {
    final home = HomeDiscoveryData(
      userData: null,
      rooms: [ordinaryFeatured, officialNotPinned, busy, pinned],
      people: const [],
      config: const {},
    );
    expect(
      home.suggested.map((room) => room.id).toList(),
      ['pinned-official', 'busy', 'official-not-pinned', 'featured-ordinary'],
    );
    expect(isPinnedOfficialDiscoveryRoom(pinned), isTrue);
    expect(isPinnedOfficialDiscoveryRoom(ordinaryFeatured), isFalse);
    expect(isPinnedOfficialDiscoveryRoom(officialNotPinned), isFalse);
    expect(comparePublicDiscoveryRooms(pinned, busy), lessThan(0));
    expect(comparePublicDiscoveryRooms(busy, officialNotPinned),
        compareRoomsByDiscoveryPriority(busy, officialNotPinned));
  });

  test('activity rail does not let pins override current live count', () {
    final home = HomeDiscoveryData(
      userData: null,
      rooms: [pinned, ordinaryFeatured, busy, officialNotPinned],
      people: const [],
      config: const {},
    );
    expect(home.mostActive.map((room) => room.id).toList(), [
      'busy',
      'official-not-pinned',
      'featured-ordinary',
      'pinned-official',
    ]);
  });

  test('activity and discovery tie ordering is deterministic', () {
    const a = DiscoveryRoom(id: 'a', data: {'onlineCount': 6});
    const z = DiscoveryRoom(id: 'z', data: {'onlineCount': 6});
    final home = HomeDiscoveryData(
      userData: null,
      rooms: [z, a],
      people: const [],
      config: const {},
    );
    expect(home.mostActive.map((e) => e.id).toList(), ['a', 'z']);
    expect(home.suggested.map((e) => e.id).toList(), ['a', 'z']);
  });

  test('Home rails share the canonical image source and do not add queries', () {
    final home = File('lib/features/home/screens/home_screen.dart').readAsStringSync();
    final rooms = File('lib/screens/room/room_list_screen.dart').readAsStringSync();
    final discovery = File('lib/features/home/services/discovery_service.dart').readAsStringSync();
    expect(home.contains('roomSurfaceImageUrl(room.data)'), isTrue);
    expect(home.contains('_RoomPreviewAvatar('), isTrue);
    expect(home.split('_RoomPreviewAvatar(').length - 1, 3,
        reason: 'one shared widget definition plus two rail placements');
    expect(home.contains('CachedNetworkImage('), isTrue);
    expect(rooms.contains('compareRoomsByDiscoveryPriority(a, b)'), isTrue);
    expect(discovery.contains('..sort(compareRoomsByDiscoveryPriority)'), isTrue);
    expect(home.contains('RoomRealtimeQueryService('), isFalse);
  });
}
