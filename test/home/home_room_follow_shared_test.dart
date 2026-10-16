import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/home_screen.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  const person = DiscoveryPerson(
    id: 'room-follower',
    data: {'displayName': 'مستخدم في غرفة'},
  );

  testWidgets('room follow badge does not interfere with profile/follow',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      var roomTaps = 0;
      var profileTaps = 0;
      var followTaps = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: SizedBox(
              height: 110,
              child: HomeCompactPersonCard(
                person: person,
                onTap: () => profileTaps++,
                onFollow: () => followTaps++,
                onRoomFollow: () => roomTaps++,
              ),
            ),
          ),
        ),
      ));
      final room = find.byKey(const Key('home-room-follow-room-follower'));
      expect(room, findsOneWidget);
      expect(find.byKey(const Key('home-follow-room-follower')), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(room);
      expect(roomTaps, greaterThan(0));
      expect(profileTaps, 0);
      expect(followTaps, 0);
      await tester.tap(find.byKey(const Key('home-follow-room-follower')));
      expect(followTaps, greaterThan(0));
      await tester.tap(find.text('مستخدم في غرفة'));
      expect(profileTaps, greaterThan(0));
    }
  });

  testWidgets('room entry action only appears with a verified callback',
      (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: HomePersonActionsSheet(
          person: person,
          onOpenProfile: () {},
        ),
      ),
    ));
    expect(find.byKey(const Key('home-person-room-follow')), findsNothing);
    var actions = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: HomePersonActionsSheet(
          person: person,
          onOpenProfile: () {},
          onRoomFollow: () => actions++,
        ),
      ),
    ));
    await tester.tap(find.byKey(const Key('home-person-room-follow')));
    expect(actions, 1);
  });

  test('one shared batch lookup and reusable password navigation for all surfaces',
      () {
    final home = File('lib/features/home/screens/home_screen.dart')
        .readAsStringSync();
    final chat = File('lib/features/chat/screens/private_chat_screen.dart')
        .readAsStringSync();
    final nav = File('lib/features/room/services/room_follow_navigation.dart')
        .readAsStringSync();
    expect(home.contains('offset += 8'), isTrue);
    expect(home.contains('_roomFollowQuery.resolveRoomFollows('), isTrue);
    expect(home.contains('_roomFollowLocations = {}'), isTrue);
    expect(home.contains('generation != _roomFollowRevision'), isTrue);
    expect(home.contains('RoomFollowNavigation.open('), isTrue);
    expect(chat.contains('RoomFollowNavigation.open('), isTrue);
    expect(RegExp(r'resolveRoomFollows').allMatches(nav).length, 2);
    expect(nav.contains('showDiscoveryRoomPasswordPrompt('), isTrue);
    expect(nav.contains("roomArgs['roomPassword'] = password;"), isTrue);
    expect(nav.contains('Timer.periodic('), isFalse);
    expect(home.contains('Timer.periodic('), isFalse);
  });
}
