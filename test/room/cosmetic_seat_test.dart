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
    expect(source.contains('int get _roomAudienceTotalCount {'), isTrue);
    expect(source.contains('return max(reported, activeUids.length);'), isTrue);
    expect(source.contains('for (final seat in _roomSeatState?.seats ?? const <VoiceSeat>[])'), isTrue);
    expect(strip.contains('final total = _roomAudienceTotalCount;'), isTrue);
    expect(source.contains('_roomAudienceTotalCount.toString(),'), isTrue);
    expect(strip.contains('...seatByUid.keys.where((uid) => uid != ownerUid)'), isTrue);
    expect(strip.contains('...profileByUid.keys.where((uid) =>'), isTrue);
    expect(strip.contains("].take(20).toList(growable: false);"), isTrue);
    expect(strip.contains('if (ownerUid.isNotEmpty) ownerUid,'), isTrue);
    expect(strip.contains('final profileUid = visibleUids[index];'), isTrue);
    expect(strip.contains('seat?.profileImageUrl'), isTrue);
    expect(strip.contains('if (isOwnerTile)'), isTrue);
    expect(strip.contains('showQuickProfileSheet('), isTrue);
    expect(strip.contains("Key('room-audience-count')"), isTrue);
    expect(strip.contains('showQuickProfileSheet('), isTrue);
    expect(strip.contains('showMysteriousIdentitySheet('), isTrue);
    expect(strip.contains('FirebaseFirestore'), isFalse);
    expect(strip.contains('Timer.periodic'), isFalse);
    expect(strip.contains('ProfileAvatarWithFrame('), isFalse);
    expect(strip.contains('CosmeticAssetVisual('), isTrue);
    expect(source.contains('_buildRoomAudienceStrip(),'), isTrue);

    final sheetStart = source.indexOf(
        'Future<void> _showRoomParticipantsSheet()');
    final sheetEnd = source.indexOf(
        'Future<void> _showMicRequestsSheet(', sheetStart);
    expect(sheetEnd, greaterThan(sheetStart));
    final sheet = source.substring(sheetStart, sheetEnd);
    expect(sheet.contains('!seatedUids.contains(user.uid)'), isTrue);
  });

  test('locked and muted mic flags roundtrip without affecting normal seats', () {
    final blocked = VoiceSeat.fromJson({
      'index': 2,
      'uid': '',
      'displayName': '',
      'profileImageUrl': '',
      'muted': true,
      'locked': true,
      'muteLocked': true,
    });
    final available = VoiceSeat.fromJson({
      'index': 3,
      'uid': '',
      'displayName': '',
      'profileImageUrl': '',
      'muted': true,
    });
    expect(blocked.locked, isTrue);
    expect(blocked.muteLocked, isTrue);
    expect(available.locked, isFalse);
    expect(available.muteLocked, isFalse);
  });

  test('empty mic opens options instead of moving immediately', () {
    final source = File('lib/main.dart').readAsStringSync();
    final start = source.indexOf('Future<void> _selectVacantRoomSeat(');
    final end = source.indexOf('Future<void> _showKickOptions(', start);
    expect(start, greaterThanOrEqualTo(0));
    expect(end, greaterThan(start));
    final actions = source.substring(start, end);
    expect(actions.contains('await _showVacantRoomSeatOptions(seat);'), isTrue);
    expect(actions.contains("'قفل المايك'"), isTrue);
    expect(actions.contains("'كتم المايك إجباريًا'"), isTrue);
    expect(actions.contains('setSeatLocked('), isTrue);
    expect(actions.contains('setSeatMuteLocked('), isTrue);
    expect(actions.contains('if (seat.locked)'), isTrue);
    expect(actions.contains('Navigator.pop(sheetContext);'), isTrue);
    expect(source.contains('!seat.locked &&'), isTrue);
    expect(source.contains('mySeat.first.muteLocked'), isTrue);
    expect(source.contains("'مايك مقفل'"), isTrue);
    expect(source.contains("'مايك مكتوم'"), isTrue);
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
