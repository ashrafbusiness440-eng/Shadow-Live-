import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final source = File(
    'lib/features/room/widgets/room_effect_coordinator.dart',
  ).readAsStringSync();
  final room = File('lib/main.dart').readAsStringSync();

  test('entry banner and moving artwork occupy separate mic and chat layers', () {
    expect(source, contains("key: ValueKey('entrance-banner-"));
    expect(source, contains("key: ValueKey('entrance-chat-effect-"));
    expect(source, contains('top: entranceTop,'));
    expect(source, contains('top: effectTop,'));
    expect(source, contains('class _AnimatedEntranceChatEffect'));
    expect(source, contains('class _AnimatedEntranceBanner'));
    expect(source, contains('event.profileImageUrl'));
    expect(room, contains('effectTop: (feedTop + 44).clamp('));
    expect(room, contains('entranceTop: (micTop - 20)'));
  });

  test('chat artwork travels left to right using existing event and stays nonblocking', () {
    expect(source, contains("ValueKey('room-entry-chat-motion-"));
    expect(source, contains('Offset((progress - .5) * travel, 0)'));
    expect(source, contains('duration: Duration(milliseconds: event.durationMs)'));
    expect(source, contains('if (reduceMotion) return Center(child: artwork);'));
    expect(source, contains('IgnorePointer('));
    expect(source, contains('maxCinematicQueue = 8'));
    expect(source, contains('maxParallelSeatEffects = 8'));
    expect(source, isNot(contains('Timer.periodic(')));
  });

  test('same visitor does not stack a redundant join welcome with entry effect', () {
    expect(source, contains('final duplicateEntrance = event != null'));
    expect(source, contains('event.recipientUids.any(roomJoin.recipientUids.contains)'));
    expect(source, contains('if (roomJoin != null && !duplicateEntrance)'));
    expect(source, contains('class _AnimatedVehicleEntrance'));
    expect(source, contains('LegendaryGiftVisual('));
  });
}
