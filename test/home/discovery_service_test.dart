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

  test('suggested people rank VIP and level without trusting stale online flags', () {
    const data = HomeDiscoveryData(
      userData: null,
      config: {},
      rooms: [],
      people: [
        DiscoveryPerson(
          id: 'offline-vip',
          data: {'displayName': 'A', 'vipLevel': 9, 'level': 50},
        ),
        DiscoveryPerson(
          id: 'online-basic',
          data: {'displayName': 'B', 'isOnline': true, 'level': 3},
        ),
        DiscoveryPerson(
          id: 'online-vip',
          data: {'displayName': 'C', 'isOnline': true, 'vipLevel': 2, 'level': 1},
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

  test('navigation payload always carries room id', () {
    const room = DiscoveryRoom(
      id: 'room-42',
      data: {'name': 'Shadow Room'},
    );

    expect(room.toNavigationArguments()['roomId'], 'room-42');
    expect(room.toNavigationArguments()['name'], 'Shadow Room');
  });
}
