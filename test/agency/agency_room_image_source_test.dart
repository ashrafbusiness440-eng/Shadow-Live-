import 'package:flutter_test/flutter_test.dart';
import 'dart:io';

import 'package:voice_chat_room/features/room/services/room_image_source.dart';

void main() {
  group('roomListImageUrl', () {
    test('agency room only uses dedicated room image fields', () {
      expect(
        roomSurfaceImageUrl({
          'roomType': 'agency',
          'agencyRoomImageUrl': 'https://cdn.example/agency-room.webp',
          'roomImageUrl': 'https://cdn.example/room.webp',
          'coverImageUrl': 'https://cdn.example/agency-cover.webp',
          'imageUrl': 'https://cdn.example/owner.webp',
        }),
        'https://cdn.example/agency-room.webp',
      );

      expect(
        roomSurfaceImageUrl({
          'roomType': 'agency',
          'roomImageUrl': 'https://cdn.example/room.webp',
          'coverImageUrl': 'https://cdn.example/agency-cover.webp',
          'imageUrl': 'https://cdn.example/owner.webp',
        }),
        'https://cdn.example/room.webp',
      );

      expect(
        roomSurfaceImageUrl({
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
        roomSurfaceImageUrl({
          'roomType': 'personal',
          'coverImageUrl': 'https://cdn.example/legacy-room-cover.webp',
        }),
        'https://cdn.example/legacy-room-cover.webp',
      );
    });
  });
  test('all active room surfaces reuse the strict room image resolver', () {
    final mainRoom = File('lib/main.dart').readAsStringSync();
    final mainShell = File(
      'lib/features/main/screens/main_shell_screen.dart',
    ).readAsStringSync();
    final roomList = File(
      'lib/screens/room/room_list_screen.dart',
    ).readAsStringSync();

    expect(
      mainRoom.contains(
        'String get _roomHeaderImageUrl =>\n      roomSurfaceImageUrl(_roomArguments);',
      ),
      isTrue,
    );
    expect(
      mainRoom.contains(
        'final initialCoverImageUrl = isAgencyRoom\n        ? roomSurfaceImageUrl(_roomArguments)',
      ),
      isTrue,
    );
    expect(
      mainShell.contains(
        'String get _miniRoomImageUrl =>\n      roomSurfaceImageUrl(_voiceSession.roomArguments);',
      ),
      isTrue,
    );
    expect(
      roomList.contains(
        'final roomImageUrl = roomSurfaceImageUrl(room.data);',
      ),
      isTrue,
    );
  });

}
