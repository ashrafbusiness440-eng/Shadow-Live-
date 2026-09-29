import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/agency/services/agency_room_link.dart';

void main() {
  group('agencyIdForRoom', () {
    test('returns the six-digit Agency id for an Agency room', () {
      expect(
        agencyIdForRoom({
          'roomType': 'agency',
          'agencyId': '123456',
        }),
        '123456',
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
      expect(
        agencyIdForRoom({
          'roomType': 'agency',
          'agencyId': 'agency_123',
        }),
        isEmpty,
      );
      expect(
        agencyIdForRoom({
          'roomType': 'agency',
        }),
        isEmpty,
      );
    });
  });
}
