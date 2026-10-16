import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Messages renders room-active people above the existing inbox', () {
    final source = File('lib/features/chat/screens/chat_list_screen.dart')
        .readAsStringSync();
    final strip = source.indexOf('VerifiedRoomPeopleStrip(');
    final inbox = source.indexOf(
        'StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(');
    expect(strip, greaterThan(0));
    expect(inbox, greaterThan(strip));
    expect(source.contains("ValueKey('messages-room-people-\$me')"), isTrue);
    expect(source.contains('ownerUid: me,'), isTrue);
  });

  test('strip verifies room membership, controls navigation and privacy', () {
    final source = File(
      'lib/features/chat/widgets/verified_room_people_strip.dart',
    ).readAsStringSync();
    expect(source.contains('DiscoveryService()'), isTrue);
    expect(source.contains('RoomRealtimeQueryService()'), isTrue);
    expect(source.contains('resolveRoomFollows('), isTrue);
    expect(source.contains('RoomFollowNavigation.open('), isTrue);
    expect(source.contains('showQuickProfileSheet('), isTrue);
    expect(source.contains('ProfileAvatarWithFrame('), isTrue);
    expect(source.contains('snapshotOnly: true,'), isTrue);
    expect(source.contains('Icons.graphic_eq_rounded'), isTrue);
    expect(source.contains("scrollDirection: Axis.horizontal,"), isTrue);
    expect(source.contains("Key('messages-verified-room-people')"), isTrue);
  });

  test('bounded reads and account isolation without avatar listeners', () {
    final source = File(
      'lib/features/chat/widgets/verified_room_people_strip.dart',
    ).readAsStringSync();
    expect(source.contains('page < 3'), isTrue);
    expect(source.contains('pageSize: 10'), isTrue);
    expect(source.contains('offset += 8'), isTrue);
    expect(source.contains('found.length < 10'), isTrue);
    expect(source.contains('generation == _generation'), isTrue);
    expect(source.contains('FirebaseAuth.instance.currentUser?.uid == uid'),
        isTrue);
    expect(source.contains('Timer(const Duration(seconds: 35)'), isTrue);
    expect(source.contains('_expiry?.cancel()'), isTrue);
    expect(source.contains('Timer.periodic('), isFalse);
    expect(source.contains('.snapshots()'), isFalse);
    expect(source.contains('where(\'isOnline\''), isFalse);
  });
}
