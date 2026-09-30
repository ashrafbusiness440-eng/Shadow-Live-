import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/agency/services/agency_room_link.dart';

void main() {
  group('agencyIdForRoom', () {
    test('returns Agency room IDs from 3 to 8 digits', () {
      for (final id in const ['123', '1234', '12345', '123456', '1234567', '12345678']) {
        expect(
          agencyIdForRoom({
            'roomType': 'agency',
            'agencyId': id,
          }),
          id,
        );
      }
    });

    test('prefers the explicit Agency / Room public ID', () {
      expect(
        agencyIdForRoom({
          'roomType': 'agency',
          'agencyRoomId': '7777',
          'agencyId': '123456',
        }),
        '7777',
      );
    });

    test('supports the legacy type fallback without any lookup', () {
      expect(
        agencyIdForRoom({
          'type': 'agency',
          'agencyId': '654321',
        }),
        '654321',
      );
    });

    test('fails closed outside Agency rooms', () {
      expect(
        agencyIdForRoom({
          'roomType': 'personal',
          'agencyId': '123456',
        }),
        isEmpty,
      );
    });

    test('fails closed for malformed Agency ids', () {
      for (final id in const ['12', '123456789', 'agency_123']) {
        expect(
          agencyIdForRoom({
            'roomType': 'agency',
            'agencyId': id,
          }),
          isEmpty,
        );
      }
      expect(
        agencyIdForRoom({
          'roomType': 'agency',
        }),
        isEmpty,
      );
    });
  });
}
