import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('presence join is session visual notice, never a chat message', () {
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final start = controller.indexOf(
      "event.type == 'room.presence_joined'",
    );
    final end = controller.indexOf(
      'if (changed) notifyListeners();', start,
    );
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final join = controller.substring(start, end);
    expect(join.contains('_appendRoomJoinNotice({'), isTrue);
    expect(join.contains('_appendRoomChat({'), isFalse);
    expect(controller.contains('_roomRecentJoinNotices.length > 8'), isTrue);
    expect(controller.contains('_roomRecentJoinNotices.clear();'), isTrue);
  });

  test('the current single effect coordinator receives the join strip', () {
    final mainSource = File('lib/main.dart').readAsStringSync();
    final effects = File(
      'lib/features/room/widgets/room_effect_coordinator.dart',
    ).readAsStringSync();
    expect(
      mainSource.contains(
        '_voiceSession.roomRecentJoinNotices.take(8)',
      ), isTrue,
    );
    expect(
      mainSource.contains('_roomEffectCoordinator.ingestRoomJoin(notice);'),
      isTrue,
    );
    expect(effects.contains('void ingestRoomJoin('), isTrue);
    expect(effects.contains("badgeLabel: 'دخل الغرفة'"), isTrue);
    expect(effects.contains('durationMs: 2800'), isTrue);
    expect(effects.contains('IgnorePointer('), isTrue);
  });
}
