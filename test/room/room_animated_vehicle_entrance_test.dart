import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/widgets/room_effect_coordinator.dart';

void main() {
  test('vehicle entrance detection supports wealth, VIP and store keys', () {
    for (final key in [
      'levels.wealth.lv21_25.vehicle',
      'levels.wealth.lv26_30.vehicle',
      'levels.wealth.lv31_35.vehicle',
      'vip.v9.vehicle',
      'store.royal.vehicle',
      'mysterious.vehicle',
    ]) {
      expect(isVehicleEntranceAsset(assetKey: key), isTrue, reason: key);
    }

    expect(
      isVehicleEntranceAsset(
        assetKey: '',
        imageUrl: 'https://cdn.example.com/assets/gold_vehicle.webp?version=2',
      ),
      isTrue,
    );
    expect(
      isVehicleEntranceAsset(assetKey: 'vip.v10.entryStrip'),
      isFalse,
    );
    expect(
      isVehicleEntranceAsset(
        assetKey: 'levels.wealth.lv21_25.profileFrame',
        imageUrl: 'https://cdn.example.com/wealth_frame.webp',
      ),
      isFalse,
    );
    expect(
      isVehicleEntranceAsset(
        assetKey: 'gifts.vehicle_card',
        imageUrl: 'https://cdn.example.com/royal_banner.webp',
      ),
      isFalse,
    );
  });

  test('vehicle events reuse bounded cinematic entrance queue', () {
    final coordinator = RoomEffectCoordinator();
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    Map<String, dynamic> event(String id, String key) => {
          'eventId': id,
          'eventAtMs': nowMs,
          'rewardExpiresAtMs': nowMs + 20000,
          'assetKey': key,
          'uid': 'test-joiner',
          'displayName': 'Test',
        };
    try {
      coordinator.ingestEntrance(
        event('wealth-vehicle', 'levels.wealth.lv21_25.vehicle'),
      );
      expect(coordinator.currentCinematic?.eventId, 'wealth-vehicle');
      expect(coordinator.currentCinematic?.isVehicleEntrance, isTrue);
      expect(coordinator.currentCinematic?.durationMs, 5000);

      // Duplicate event must not enqueue again.
      coordinator.ingestEntrance(
        event('wealth-vehicle', 'levels.wealth.lv21_25.vehicle'),
      );
      coordinator.ingestEntrance(event('vip-entry', 'vip.v10.entryStrip'));
      expect(coordinator.currentCinematic?.eventId, 'wealth-vehicle');
      expect(RoomEffectCoordinator.maxCinematicQueue, 8);
    } finally {
      coordinator.dispose();
    }
  });
}
