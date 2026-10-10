import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('room audience pictures reuse the canonical snapshot-only renderer', () {
    final room = File('lib/main.dart').readAsStringSync();
    final giftSheet =
        File('lib/features/gift/widgets/room_gift_sheet.dart')
            .readAsStringSync();
    final presence =
        File('lib/features/room/services/room_presence_service.dart')
            .readAsStringSync();
    final identity = File('cloudflare-worker/src/room-realtime.js')
        .readAsStringSync();
    final roomObject = File('cloudflare-worker/src/room-realtime-object.js')
        .readAsStringSync();
    final serverSnapshot =
        File('cloudflare-worker/src/room-realtime-presence.js')
            .readAsStringSync();

    final stripStart = room.indexOf('Widget _buildRoomAudienceStrip()');
    final stripEnd = room.indexOf(
      'Future<void> _showRoomParticipantsSheet()', stripStart);
    expect(stripStart, greaterThan(0));
    expect(stripEnd, greaterThan(stripStart));
    final strip = room.substring(stripStart, stripEnd);
    expect(strip.contains('ProfileAvatarWithFrame('), isTrue);
    expect(strip.contains('snapshotOnly: true'), isTrue);
    expect(strip.contains('fallbackProfile: avatarSnapshot'), isTrue);
    expect(strip.contains("'profileAvatarAsset':"), isTrue);
    expect(strip.contains('NetworkImage(profileImage)'), isFalse);
    expect(strip.contains('CircleAvatar('), isFalse);
    expect(strip.contains('_voiceSession.roomParticipants'), isTrue);

    final sheet = room.substring(stripEnd);
    expect(sheet.contains("'profileAvatarAsset':\n                                            user.profileAvatarAsset"), isTrue);
    expect(presence.contains("data['profileAvatarAsset']"), isTrue);
    expect(giftSheet.contains("'profileAvatarAsset': user.profileAvatarAsset"),
        isTrue);
    expect(giftSheet.contains('snapshotOnly: true'), isTrue);
    expect(serverSnapshot.contains('profileAvatarAsset: clean(item.profileAvatarAsset)'), isTrue);
    expect(identity.contains('publicProfile.profileAvatarAsset || user.profileAvatarAsset'), isTrue);
    expect(roomObject.contains('profileAvatarAsset: String(body.profileAvatarAsset || "").trim()'), isTrue);
    expect(roomObject.contains('profileAvatarAsset = String(record.profileAvatarAsset || "").trim()'), isTrue);
    // The existing ticket/presence socket is still the ONLY audience data source.
    expect(strip.contains('FirebaseFirestore'), isFalse);
    expect(strip.contains('StreamBuilder'), isFalse);
    expect(strip.contains('RoomPresenceService('), isFalse);
  });
}
