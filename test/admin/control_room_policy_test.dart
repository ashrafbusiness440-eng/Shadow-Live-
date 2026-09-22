import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_room_policy.dart';

void main() {
  group('RoomPolicy', () {
    test('normal room level table is stable', () {
      expect(RoomPolicy.seats(level: 1, agency: false), 8);
      expect(RoomPolicy.seats(level: 6, agency: false), 20);
      expect(RoomPolicy.moderators(level: 1, agency: false), 3);
      expect(RoomPolicy.moderators(level: 6, agency: false), 12);
    });

    test('agency room level table is stable', () {
      expect(RoomPolicy.seats(level: 1, agency: true), 10);
      expect(RoomPolicy.seats(level: 6, agency: true), 22);
      expect(RoomPolicy.moderators(level: 1, agency: true), 5);
      expect(RoomPolicy.moderators(level: 6, agency: true), 14);
    });

    test('normal room ignores manual values until bypass is enabled', () {
      const overrides = RoomControlOverrides(
        seats: 30,
        moderators: 15,
      );
      expect(
        RoomPolicy.effectiveSeats(
          level: 2,
          agency: false,
          official: false,
          overrides: overrides,
        ),
        10,
      );
      expect(
        RoomPolicy.effectiveModerators(
          level: 2,
          agency: false,
          official: false,
          overrides: overrides,
        ),
        4,
      );
    });

    test('bypass activates manual seat and moderator overrides', () {
      const overrides = RoomControlOverrides(
        seats: 30,
        moderators: 15,
        bypassLevelCapacity: true,
      );
      expect(
        RoomPolicy.effectiveSeats(
          level: 2,
          agency: false,
          official: false,
          overrides: overrides,
        ),
        30,
      );
      expect(
        RoomPolicy.effectiveModerators(
          level: 2,
          agency: false,
          official: false,
          overrides: overrides,
        ),
        15,
      );
    });

    test('official room can use manual capacity without bypass flag', () {
      const overrides = RoomControlOverrides(
        seats: 5,
        moderators: 2,
      );
      expect(
        RoomPolicy.effectiveSeats(
          level: 1,
          agency: false,
          official: true,
          overrides: overrides,
        ),
        5,
      );
      expect(
        RoomPolicy.effectiveModerators(
          level: 1,
          agency: false,
          official: true,
          overrides: overrides,
        ),
        2,
      );
    });

    test('override parser rejects out-of-range values', () {
      final overrides = RoomControlOverrides.fromMap({
        'seats': 99,
        'moderators': -1,
        'bypassLevelCapacity': true,
      });
      expect(overrides.seats, isNull);
      expect(overrides.moderators, isNull);
      expect(overrides.bypassLevelCapacity, isTrue);
    });

    test('official room classification includes admin and customer service', () {
      expect(
        RoomPolicy.isOfficial(
          roomType: 'administrative',
          systemOwned: false,
          officialRoom: false,
        ),
        isTrue,
      );
      expect(
        RoomPolicy.isOfficial(
          roomType: 'customer_service',
          systemOwned: false,
          officialRoom: false,
        ),
        isTrue,
      );
      expect(
        RoomPolicy.isOfficial(
          roomType: 'personal',
          systemOwned: false,
          officialRoom: false,
        ),
        isFalse,
      );
    });
  });
}
