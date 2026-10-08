import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room chat never opens real profile or level for mysterious messages', () {
    final source = File(
      'lib/features/room/widgets/room_chat_panel.dart',
    ).readAsStringSync();

    expect(source.contains('if (message.mysteriousMode) {'), isTrue);
    expect(source.contains('showMysteriousIdentitySheet('), isTrue);
    expect(
      source.contains(
        'message.mysteriousMode\n                    ? const MysteriousIdentityAvatar',
      ),
      isTrue,
    );
    expect(
      source.contains(
        '!message.mysteriousMode &&\n                        (message.wealthLevel',
      ),
      isTrue,
    );
    expect(source.contains("'mysteriousMode': message.mysteriousMode"), isTrue);
  });

  test('mysterious entrance uses the same room entry effect surface', () {
    final source = File(
      'lib/features/room/widgets/room_chat_panel.dart',
    ).readAsStringSync();

    expect(
      source.contains(
        "message.systemKind == 'room_join' &&\n          message.entryEffectKey.trim().isNotEmpty",
      ),
      isTrue,
    );
    expect(
      source.contains("roomEntry ? message.entryEffectKey : ''"),
      isTrue,
    );
    expect(
      source.contains('latest.entryEffectKey.trim().isNotEmpty'),
      isTrue,
    );
  });
}
