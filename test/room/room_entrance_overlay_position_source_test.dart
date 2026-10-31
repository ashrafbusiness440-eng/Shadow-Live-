import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final effect = File(
    'lib/features/room/widgets/room_effect_coordinator.dart',
  ).readAsStringSync();
  final room = File('lib/main.dart').readAsStringSync();

  test('entrance bar uses the existing effect queue and left-to-right motion', () {
    expect(effect, contains('class _AnimatedEntranceBanner extends StatelessWidget'));
    expect(effect, contains("ValueKey('room-entry-banner-motion-"));
    expect(effect, contains('offset: Offset((progress - .5) * travel, 0)'));
    expect(effect, contains('event.durationMs'));
    expect(effect, contains('disableAnimations ?? false'));
    expect(effect, contains('if (reduceMotion) return Center(child: visual);'));
    expect(effect, contains('!event.isVehicleEntrance'));
    expect(effect, contains('RoomEffectCoordinatorHost('));
    expect(effect, contains('IgnorePointer('));
  });

  test('room join bar is pinned to chat-feed top without moving mics', () {
    expect(effect, contains('final double? joinTop;'));
    expect(effect, contains('top: joinTop,'));
    expect(effect, contains('bottom: joinTop == null ? joinBottom : null,'));
    expect(room, contains('joinTop: (feedTop + 6)'));
    expect(room, contains('NeverScrollableScrollPhysics()'));
    expect(effect, contains('roomJoin != null'));
  });

  test('existing cinematic gift and vehicle visuals remain separate', () {
    expect(effect, contains('class _AnimatedVehicleEntrance'));
    expect(effect, contains('LegendaryGiftVisual('));
    expect(effect, contains('maxCinematicQueue = 8'));
    expect(effect, contains('maxParallelSeatEffects = 8'));
    expect(effect, isNot(contains('Timer.periodic(')));
  });
}
