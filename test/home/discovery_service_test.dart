import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  test('suggested rooms prefer featured rooms then activity', () {
    const data = HomeDiscoveryData(
      userData: null,
      config: {},
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
      ],
    );

    expect(data.suggested.map((room) => room.id).toList(), [
      'featured',
      'busy',
      'quiet',
    ]);
    expect(data.mostActive.map((room) => room.id).toList(), [
      'busy',
      'featured',
    ]);
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
