import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  test('room directory excludes hidden, inactive and private rooms', () {
    const public = DiscoveryRoom(id: 'public', data: {'visibility': 'public'});
    const password = DiscoveryRoom(id: 'password', data: {'visibility': 'password'});
    const hidden = DiscoveryRoom(id: 'hidden', data: {'visibility': 'hidden'});
    const inactive = DiscoveryRoom(id: 'inactive', data: {'isActive': false});
    const private = DiscoveryRoom(id: 'private', data: {'isPrivate': true});
    const restricted = DiscoveryRoom(id: 'restricted', data: {'visibility': 'friends'});
    expect(isDiscoverableRoom(public), isTrue);
    expect(isDiscoverableRoom(password), isTrue,
        reason: 'the existing route still enforces room passwords');
    for (final room in [hidden, inactive, private, restricted]) {
      expect(isDiscoverableRoom(room), isFalse, reason: room.id);
    }
  });

  test('new pages preserve pinned official ordering and verified count policy', () {
    const busy = DiscoveryRoom(id: 'busy', data: {'onlineCount': 88});
    const pinned = DiscoveryRoom(id: 'pinned', data: {
      'systemOwned': true, 'isPinned': true, 'onlineCount': 1,
    });
    const older = DiscoveryRoom(id: 'older', data: {'onlineCount': 300});
    final sorted = [busy, pinned, roomWithVerifiedPresence(older, null)]
      ..sort(compareRoomsByDiscoveryPriority);
    expect(sorted.map((e) => e.id), ['pinned', 'busy', 'older']);
    expect(sorted.last.hasAvailablePresence, isFalse);
  });

  test('additional rooms use a bounded document cursor, not a bigger Home limit', () {
    final service = File('lib/features/home/services/discovery_service.dart')
        .readAsStringSync();
    final screen = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    expect(service.contains('.orderBy(FieldPath.documentId)'), isTrue);
    expect(service.contains('.startAfterDocument(after)'), isTrue);
    expect(service.contains('pageSize > 24 ? 24 : pageSize'), isTrue);
    expect(service.contains('nextCursor: snapshot.docs.isEmpty ? null : snapshot.docs.last'), isTrue);
    expect(service.contains('hydrateRealtimeCounts(candidates)'), isTrue);
    expect(service.contains('findRoomForEntry(String roomId)'), isTrue);
    expect(screen.contains("onMore: _showMoreRooms"), isTrue);
    expect(screen.contains('class HomeMoreRoomsScreen'), isTrue);
    expect(screen.contains('SliverGridDelegateWithFixedCrossAxisCount('), isTrue);
    expect(screen.contains('crossAxisCount: 2'), isTrue);
    expect(screen.contains('HomeCompactRoomCard('), isTrue);
    expect(screen.contains('extentAfter < 450'), isTrue);
    expect(screen.contains('_seenIds.add(room.id)'), isTrue);
    expect(screen.contains("child: const Text('إعادة المحاولة')"), isTrue);
    expect(screen.contains('findRoomForEntry(room.id)'), isTrue);
    expect(screen.contains('RoomRealtimeQueryService('), isFalse);
  });
}
