import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_seat_service.dart';

void main() {
  test('active frame is visible only before expiry', () {
    final now = DateTime.now().millisecondsSinceEpoch;
    final active = VoiceSeat.fromJson({
      'index': 0,
      'uid': 'user-1',
      'displayName': 'User',
      'profileImageUrl': '',
      'muted': true,
      'frameRewardId': 'gold_frame',
      'frameAssetKey': 'cosmetics.frame.gold_frame',
      'frameExpiresAtMs': now + 60000,
    });
    final expired = VoiceSeat.fromJson({
      'index': 1,
      'uid': 'user-2',
      'displayName': 'User 2',
      'profileImageUrl': '',
      'muted': true,
      'frameRewardId': 'old_frame',
      'frameAssetKey': 'cosmetics.frame.old_frame',
      'frameExpiresAtMs': now - 1000,
    });

    expect(active.frameActive, isTrue);
    expect(expired.frameActive, isFalse);
  });

  test('voice wave is visible only while reward is valid and mic is open', () {
    final now = DateTime.now().millisecondsSinceEpoch;
    final openMic = VoiceSeat.fromJson({
      'index': 0,
      'uid': 'user-1',
      'displayName': 'User',
      'profileImageUrl': '',
      'muted': false,
      'voiceWaveRewardId': 'violet_wave',
      'voiceWaveAssetKey': 'cosmetics.voice_wave.violet_wave',
      'voiceWaveExpiresAtMs': now + 60000,
    });
    final muted = VoiceSeat.fromJson({
      'index': 1,
      'uid': 'user-2',
      'displayName': 'User 2',
      'profileImageUrl': '',
      'muted': true,
      'voiceWaveRewardId': 'violet_wave',
      'voiceWaveAssetKey': 'cosmetics.voice_wave.violet_wave',
      'voiceWaveExpiresAtMs': now + 60000,
    });
    final expired = VoiceSeat.fromJson({
      'index': 2,
      'uid': 'user-3',
      'displayName': 'User 3',
      'profileImageUrl': '',
      'muted': false,
      'voiceWaveRewardId': 'violet_wave',
      'voiceWaveAssetKey': 'cosmetics.voice_wave.violet_wave',
      'voiceWaveExpiresAtMs': now - 1000,
    });

    expect(openMic.voiceWaveActive, isTrue);
    expect(muted.voiceWaveActive, isFalse);
    expect(expired.voiceWaveActive, isFalse);
  });
}
