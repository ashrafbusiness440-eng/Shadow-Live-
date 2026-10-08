import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room UI suppresses management while mysterious mode is active', () {
    final moderator = File(
      'lib/features/room/services/room_moderator_service.dart',
    ).readAsStringSync();
    final bootstrap = File(
      'lib/features/room/services/room_bootstrap_service.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final room = File('lib/main.dart').readAsStringSync();
    final mysterious = File(
      'lib/features/mysterious/screens/mysterious_person_screen.dart',
    ).readAsStringSync();

    expect(moderator.contains('authoritySuppressed'), isTrue);
    expect(
      moderator.contains('!authoritySuppressed &&'),
      isTrue,
    );
    expect(
      bootstrap.contains("moderator['authoritySuppressed'] == true"),
      isTrue,
    );
    expect(controller.contains('applyMysteriousVoice'), isTrue);
    expect(room.contains('_roomAuthoritySuppressed'), isTrue);
    expect(
      mysterious.contains('applyMysteriousVoice('),
      isTrue,
    );
  });
}
