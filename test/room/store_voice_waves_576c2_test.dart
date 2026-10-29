import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_seat_service.dart';

void main() {
  test('real voice seat displays a Store wave only when unmuted and active', () {
    final expiration = DateTime.now().millisecondsSinceEpoch + 60000;
    final seat = VoiceSeat.fromJson({
      'index': 1, 'uid': 'member', 'displayName': 'Member',
      'muted': false,
      'voiceWaveAssetKey': 'store.item.200007.visual',
      'voiceWaveImageUrl': 'https://example.test/wave.webp',
      'voiceWaveExpiresAtMs': expiration,
    });
    expect(seat.voiceWaveActive, isTrue);
    expect(seat.voiceWaveAssetKey, 'store.item.200007.visual');
    expect(seat.voiceWaveImageUrl, 'https://example.test/wave.webp');
  });

  test('muted, expired, vacant and legacy seats do not show active Store wave', () {
    final expiration = DateTime.now().millisecondsSinceEpoch + 60000;
    final muted = VoiceSeat.fromJson({
      'index': 0, 'uid': 'user', 'muted': true,
      'voiceWaveAssetKey': 'store.item.200007.visual',
      'voiceWaveExpiresAtMs': expiration,
    });
    final expired = VoiceSeat.fromJson({
      'index': 0, 'uid': 'user', 'muted': false,
      'voiceWaveAssetKey': 'store.item.200007.visual',
      'voiceWaveExpiresAtMs': DateTime.now().millisecondsSinceEpoch - 100,
    });
    final vacant = VoiceSeat.fromJson({
      'index': 0, 'uid': '', 'muted': false,
      'voiceWaveExpiresAtMs': expiration,
    });
    final legacy = VoiceSeat.fromJson({
      'index': 0, 'uid': 'user', 'muted': false,
    });
    expect(muted.voiceWaveActive, isFalse);
    expect(expired.voiceWaveActive, isFalse);
    expect(vacant.voiceWaveActive, isFalse);
    expect(legacy.voiceWaveActive, isFalse);
  });

  test('permanent equipped wave uses a positive non-expiring seat deadline', () {
    final seat = VoiceSeat.fromJson({
      'index': 0, 'uid': 'member', 'muted': false,
      'voiceWaveAssetKey': 'store.item.200007.visual',
      'voiceWaveExpiresAtMs': 9007199254740991,
    });
    expect(seat.voiceWaveActive, isTrue);
  });
}
