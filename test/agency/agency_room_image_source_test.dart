import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  group('roomListImageUrl', () {
    test('agency room only uses dedicated room image fields', () {
      expect(
        roomListImageUrl({
          'roomType': 'agency',
          'agencyRoomImageUrl': 'https://cdn.example/agency-room.webp',
          'roomImageUrl': 'https://cdn.example/room.webp',
          'coverImageUrl': 'https://cdn.example/agency-cover.webp',
          'imageUrl': 'https://cdn.example/owner.webp',
        }),
        'https://cdn.example/agency-room.webp',
      );

      expect(
        roomListImageUrl({
          'roomType': 'agency',
          'roomImageUrl': 'https://cdn.example/room.webp',
          'coverImageUrl': 'https://cdn.example/agency-cover.webp',
          'imageUrl': 'https://cdn.example/owner.webp',
        }),
        'https://cdn.example/room.webp',
      );

      expect(
        roomListImageUrl({
          'roomType': 'agency',
          'coverImageUrl': 'https://cdn.example/agency-cover.webp',
          'imageUrl': 'https://cdn.example/owner.webp',
          'photoUrl': 'https://cdn.example/profile.webp',
        }),
        isEmpty,
      );
    });

    test('non-agency rooms preserve legacy room image fallbacks', () {
      expect(
        roomListImageUrl({
          'roomType': 'personal',
          'coverImageUrl': 'https://cdn.example/legacy-room-cover.webp',
        }),
        'https://cdn.example/legacy-room-cover.webp',
      );
    });
  });
}
