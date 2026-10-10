import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  const saved = DiscoveryRoom(
    id: 'saved-room',
    data: {
      'name': 'غرفتي المفضلة',
      'onlineCount': 67,
      'participantsCount': 67,
    },
  );

  test('favorites use the verified public count, including a live zero', () {
    final publicRoom = roomWithVerifiedPresence(
      const DiscoveryRoom(id: 'saved-room', data: {'onlineCount': 9}),
      3,
    );
    final result = roomLibraryWithVerifiedPresence([saved], [publicRoom]);
    expect(result.single.hasAvailablePresence, isTrue);
    expect(result.single.onlineCount, 3);
    expect(result.single.data['presenceState'], 'live');
    expect(saved.onlineCount, 67, reason: 'do not mutate the saved metadata');

    final zero = roomLibraryWithVerifiedPresence(
      [saved],
      [roomWithVerifiedPresence(publicRoom, 0)],
    );
    expect(zero.single.hasAvailablePresence, isTrue);
    expect(zero.single.onlineCount, 0);
  });

  test('unavailable public presence never falls back to stale library count', () {
    final publicUnknown = roomWithVerifiedPresence(
      const DiscoveryRoom(id: 'saved-room', data: {'onlineCount': 99}),
      null,
    );
    final result = roomLibraryWithVerifiedPresence([saved], [publicUnknown]);
    expect(result.single.hasAvailablePresence, isFalse);
    expect(result.single.data['presenceState'], 'unavailable');
    expect(result.single.onlineCount, 0);
    expect(result.single.data['onlineCount'], 67,
        reason: 'keep saved metadata but never present it as live');
  });

  test('rooms absent from public discovery have no verified count', () {
    const hiddenOrUnlisted = DiscoveryRoom(
      id: 'hidden-room',
      data: {'onlineCount': 12, 'presenceState': 'live'},
    );
    final result = roomLibraryWithVerifiedPresence(
      [saved, hiddenOrUnlisted],
      [roomWithVerifiedPresence(
        const DiscoveryRoom(id: 'different-room', data: {}),
        5,
      )],
    );
    expect(result.every((room) => !room.hasAvailablePresence), isTrue);
    expect(result.map((room) => room.id).toList(),
        ['saved-room', 'hidden-room']);
  });

  test('both saved tabs reuse the existing discovery snapshot', () {
    final screen = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();
    expect(screen.contains(
      'roomLibraryWithVerifiedPresence(_favoriteRooms, _rooms)'), isTrue);
    expect(screen.contains(
      'roomLibraryWithVerifiedPresence(_historyRooms, _rooms)'), isTrue);
    expect(screen.contains("room.data['presenceState'] == 'live'"), isTrue);
    expect(screen.contains('roomWithVerifiedPresence(room, liveCounts[room.id])'),
        isTrue);
    expect(screen.contains('Timer.periodic'), isFalse);
    expect(screen.contains('FirebaseFirestore.instance'), isFalse);
  });
}
