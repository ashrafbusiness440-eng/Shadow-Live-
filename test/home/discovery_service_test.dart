import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  test('room exposes public ID without replacing internal document ID', () {
    const room = DiscoveryRoom(id: 'firestore-doc', data: {'name': 'Test', 'publicId': '2222'});
    expect(room.id, 'firestore-doc');
    expect(room.publicId, '2222');
    expect(room.toNavigationArguments()['roomId'], 'firestore-doc');
    expect(room.toNavigationArguments()['publicId'], '2222');
  });

  test('suggestions pin only official featured rooms, then rank by activity', () {
    const data = HomeDiscoveryData(
      userData: null,
      config: {},
      people: [],
      rooms: [
        DiscoveryRoom(
          id: 'busy',
          data: {'name': 'Busy', 'onlineCount': 80},
        ),
        DiscoveryRoom(
          id: 'featured',
          data: {'name': 'Featured', 'onlineCount': 12, 'isFeatured': true},
        ),
        DiscoveryRoom(
          id: 'quiet',
          data: {'name': 'Quiet', 'onlineCount': 0},
        ),
        DiscoveryRoom(
          id: 'official-pinned',
          data: {
            'name': 'Pinned official',
            'systemOwned': true,
            'isPinned': true,
            'onlineCount': 1,
          },
        ),
      ],
    );

    expect(data.suggested.map((room) => room.id).toList(), [
      'official-pinned',
      'busy',
      'featured',
      'quiet',
    ]);
    expect(data.mostActive.map((room) => room.id).toList(), [
      'busy',
      'featured',
      'official-pinned',
    ]);
  });

  test('home active rail never repeats any of its four visible square rooms', () {
    final rooms = List<DiscoveryRoom>.generate(
      12,
      (index) => DiscoveryRoom(
        id: 'room-$index',
        data: {
          'name': 'Room $index',
          'onlineCount': 12 - index,
          'presenceState': 'live',
          if (index == 11) ...{
            'systemOwned': true,
            'isPinned': true,
          },
        },
      ),
    );
    final discovery = HomeDiscoveryData(
      userData: null,
      config: const {},
      people: const [],
      rooms: rooms,
    );
    final suggested = discovery.suggested.take(4).map((r) => r.id).toSet();
    expect(suggested, contains('room-11'));
    final other = discovery.otherActiveForHome;
    expect(other.map((r) => r.id), ['room-3', 'room-4', 'room-5', 'room-6', 'room-7', 'room-8', 'room-9', 'room-10']);
    expect(other.every((r) => !suggested.contains(r.id)), isTrue);
    expect(discovery.mostActive.length, 12); // other clients unchanged
  });

  test('home hides an empty duplicated activity rail without extra reads', () {
    const discovery = HomeDiscoveryData(
      userData: null,
      config: {},
      people: [],
      rooms: [
        DiscoveryRoom(id: 'a', data: {'onlineCount': 5}),
        DiscoveryRoom(id: 'b', data: {'onlineCount': 1}),
        DiscoveryRoom(id: 'c', data: {'onlineCount': 0}),
      ],
    );
    expect(discovery.suggested.length, 3);
    expect(discovery.otherActiveForHome, isEmpty);
  });

  test('suggested people rank verified VIP without trusting stale online flags or level', () {
    const data = HomeDiscoveryData(
      userData: null,
      config: {},
      rooms: [],
      people: [
        DiscoveryPerson(
          id: 'offline-vip',
          data: {'displayName': 'A', 'effectiveVipLevel': 9, 'vipExpiresAt': '2099-01-01T00:00:00Z'},
        ),
        DiscoveryPerson(
          id: 'online-basic',
          data: {'displayName': 'B', 'isOnline': true, 'level': 3},
        ),
        DiscoveryPerson(
          id: 'online-vip',
          data: {'displayName': 'C', 'isOnline': true, 'effectiveVipLevel': 2, 'vipExpiresAt': '2099-01-01T00:00:00Z'},
        ),
      ],
    );

    expect(data.suggestedPeople.map((person) => person.id).toList(), [
      'offline-vip',
      'online-vip',
      'online-basic',
    ]);
  });

  test('remote discovery config exposes event and ranking lists safely', () {
    const data = HomeDiscoveryData(
      userData: null,
      rooms: [],
      people: [],
      config: {
        'events': [
          {'title': 'Event A'}
        ],
        'rankingPreview': [
          {'displayName': 'User A', 'value': '10K'}
        ],
      },
    );

    expect(data.events.single['title'], 'Event A');
    expect(data.rankingPreview.single['displayName'], 'User A');
  });

  test('room policy helpers keep hidden and inactive rooms identifiable', () {
    const hidden = DiscoveryRoom(
      id: 'hidden',
      data: {'visibility': 'hidden'},
    );
    const inactive = DiscoveryRoom(
      id: 'inactive',
      data: {'isActive': false},
    );

    expect(hidden.isHidden, isTrue);
    expect(inactive.isActive, isFalse);
  });

  test('home discovery excludes private, hidden and restricted rooms', () {
    const publicRoom = DiscoveryRoom(id: 'public', data: {'visibility': 'public'});
    const password = DiscoveryRoom(id: 'password', data: {'visibility': 'password'});
    const privateRoom = DiscoveryRoom(id: 'private', data: {'isPrivate': true});
    const hidden = DiscoveryRoom(id: 'hidden', data: {'visibility': 'hidden'});
    const friends = DiscoveryRoom(id: 'friends', data: {'visibility': 'friends'});
    const inactive = DiscoveryRoom(id: 'inactive', data: {'isActive': false});
    const unknown = DiscoveryRoom(id: 'unknown', data: {'visibility': 'restricted'});

    expect(publicRoom.isPubliclyDiscoverable, isTrue);
    expect(password.isPubliclyDiscoverable, isTrue);
    for (final room in [privateRoom, hidden, friends, inactive, unknown]) {
      expect(room.isPubliclyDiscoverable, isFalse, reason: room.id);
    }
  });

  test('the bounded home room query applies public discovery policy', () {
    final source = File('lib/features/home/services/discovery_service.dart')
        .readAsStringSync();
    expect(source.contains('.limit(60).get()'), isTrue);
    expect(source.contains('.where((room) => room.isPubliclyDiscoverable)'), isTrue);
  });

  test('navigation payload always carries room id', () {
    const room = DiscoveryRoom(
      id: 'room-42',
      data: {'name': 'Shadow Room'},
    );

    expect(room.toNavigationArguments()['roomId'], 'room-42');
    expect(room.toNavigationArguments()['name'], 'Shadow Room');
  });
}
