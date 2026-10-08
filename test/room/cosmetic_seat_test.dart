import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/services/room_seat_service.dart';

void main() {
  test('audience strip uses room presence once and filters mic occupants', () {
    final source = File('lib/main.dart').readAsStringSync();
    final start = source.indexOf('Widget _buildRoomAudienceStrip()');
    final end = source.indexOf('Future<void> _showRoomParticipantsSheet()', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final strip = source.substring(start, end);
    expect(strip.contains('_voiceSession.roomParticipants'), isTrue);
    expect(strip.contains('!seatedUids.contains(user.uid)'), isTrue);
    expect(strip.contains('.take(20)'), isTrue);
    expect(strip.contains("Key('room-audience-count')"), isTrue);
    expect(strip.contains('showQuickProfileSheet('), isTrue);
    expect(strip.contains('showMysteriousIdentitySheet('), isTrue);
    expect(strip.contains('FirebaseFirestore'), isFalse);
    expect(strip.contains('Timer.periodic'), isFalse);
    expect(source.contains('_buildRoomAudienceStrip(),'), isTrue);

    final sheetStart = source.indexOf(
        'Future<void> _showRoomParticipantsSheet()');
    final sheetEnd = source.indexOf('Future<void> _build', sheetStart);
    final sheet = source.substring(
        sheetStart, sheetEnd == -1 ? source.length : sheetEnd);
    expect(sheet.contains('!seatedUids.contains(user.uid)'), isTrue);
  });

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
