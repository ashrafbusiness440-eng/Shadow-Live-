import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('chat header uses one shared verified resolver, never generic online state', () {
    final src = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(src.contains('RoomRealtimeQueryService _followQuery'), isTrue);
    expect(src.contains('Future<void> _refreshFollowIndicator()'), isTrue);
    expect(src.contains("Key('chat-follow-to-room')"), isTrue);
    expect(src.contains("Text('في غرفة'"), isTrue);
    expect(src.contains('RoomFollowNavigation.open('), isTrue);
    expect(src.contains('public_profiles.isOnline'), isTrue);
  });

  test('shared navigation rechecks presence and password after each await', () {
    final src = File('lib/features/room/services/room_follow_navigation.dart')
        .readAsStringSync();
    expect(RegExp(r'resolveRoomFollows').allMatches(src).length, 2);
    expect(src.contains('showDiscoveryRoomPasswordPrompt('), isTrue);
    expect(src.contains('AppRoutes.voiceChatRoom'), isTrue);
    expect(src.contains("roomArgs['roomPassword'] = password;"), isTrue);
    expect(src.contains('FirebaseAuth.instance.currentUser?.uid == viewerUid'),
        isTrue);
    expect(src.contains("after[targetUid]?.roomId != found.roomId"), isTrue);
    expect(src.contains("room['isHidden'] == true"), isTrue);
    expect(src.contains("room['visibility'] == 'private'"), isTrue);
  });

  test('badge expiry stays local, no polling or per-avatar listeners', () {
    final src = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(src.contains('_followBadgeExpiry?.cancel();'), isTrue);
    expect(src.contains('Timer.periodic('), isFalse);
  });
}
