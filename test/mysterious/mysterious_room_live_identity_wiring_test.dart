import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room participants and seats protect mysterious identity surfaces', () {
    final room = File('lib/main.dart').readAsStringSync();
    final presence = File(
      'lib/features/room/services/room_presence_service.dart',
    ).readAsStringSync();
    final seats = File(
      'lib/features/room/services/room_seat_service.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final mystery = File(
      'lib/features/mysterious/widgets/mysterious_identity_widgets.dart',
    ).readAsStringSync();

    expect(presence.contains('mysteriousMode'), isTrue);
    expect(presence.contains('mysteriousId'), isTrue);
    expect(seats.contains('mysteriousMode'), isTrue);
    expect(seats.contains('mysteriousId'), isTrue);
    expect(room.contains('if (seat.mysteriousMode)'), isTrue);
    expect(room.contains('if (user.mysteriousMode)'), isTrue);
    expect(
      room.contains('MysteriousIdentityAvatar(diameter: micSize)'),
      isTrue,
    );
    expect(mystery.contains('class MysteriousIdentityAction'), isTrue);
    expect(
      controller.contains("event.type == 'room.presence_updated'"),
      isTrue,
    );
    expect(controller.contains('refreshMysteriousRoomIdentity'), isTrue);
  });

  test('identity refresh is one-shot on existing services without polling', () {
    final presence = File(
      'lib/features/room/services/room_presence_service.dart',
    ).readAsStringSync();
    final seats = File(
      'lib/features/room/services/room_seat_service.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();

    expect(presence.contains("'action': 'refreshIdentity'"), isTrue);
    expect(
      seats.contains("'action': 'syncMysteriousRoomIdentity'"),
      isTrue,
    );
    expect(controller.contains('Future.wait<void>'), isTrue);
    expect(controller.contains('Timer.periodic'), isFalse);
  });

  test('normal profile visual identity remains real outside room scope', () {
    final profileIdentity = File(
      'lib/features/profile/services/profile_visual_identity_service.dart',
    ).readAsStringSync();
    expect(profileIdentity.contains('mysteriousMode'), isFalse);
    expect(profileIdentity.contains('mysteriousId'), isFalse);
  });
}
