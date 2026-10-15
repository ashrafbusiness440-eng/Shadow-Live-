import 'dart:io';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('chat header uses shared verified room follow, never generic online state', () {
    final src = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    expect(src.contains('RoomRealtimeQueryService _followQuery'), isTrue);
    expect(src.contains('Future<void> _refreshFollowIndicator()'), isTrue);
    expect(src.contains('Key(\'chat-follow-to-room\')'), isTrue);
    expect(src.contains("Text('في غرفة'"), isTrue);
    expect(src.contains('widget.otherUid'), isTrue);
    expect(src.contains('public_profiles.isOnline'), isTrue);
  });

  test('follow tap rechecks presence after password prompt and guards account', () {
    final src = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final begin = src.indexOf('Future<void> _followToRoom()');
    final end = src.indexOf('void _openProfile()', begin);
    expect(begin, greaterThan(0));
    expect(end, greaterThan(begin));
    final method = src.substring(begin, end);
    expect(RegExp(r'resolveRoomFollows').allMatches(method).length, 2);
    expect(method.contains('showDiscoveryRoomPasswordPrompt('), isTrue);
    expect(method.contains('AppRoutes.voiceChatRoom'), isTrue);
    expect(method.contains('roomArgs[\'roomPassword\'] = password;'), isTrue);
    expect(method.contains('_isActiveChatAccount(ownerUid)'), isTrue);
    expect(method.contains("checked[widget.otherUid]?.roomId != target.roomId"),
        isTrue);
    expect(src.contains('_followBadgeExpiry?.cancel();'), isTrue);
    expect(src.contains('Timer.periodic('), isFalse);
  });
}
