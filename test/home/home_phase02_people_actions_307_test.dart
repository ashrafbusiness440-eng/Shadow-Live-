import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/screens/home_screen.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';

void main() {
  const person = DiscoveryPerson(
    id: 'visible-person',
    data: {
      'displayName': 'مستخدم عربي باسمه طويل',
      'level': 7,
      'vipLevel': 4,
      'isOnline': true, // Legacy flag must not generate a green status.
    },
  );

  testWidgets('follow icon has separate action from person card at RTL widths',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      var profiles = 0;
      var toggles = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: SizedBox(
              height: 110,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  HomeCompactPersonCard(
                    person: person,
                    isFollowing: false,
                    onTap: () => profiles++,
                    onFollow: () => toggles++,
                  ),
                ],
              ),
            ),
          ),
        ),
      ));
      expect(find.byKey(const Key('home-follow-visible-person')),
          findsOneWidget);
      expect(find.byTooltip('متابعة'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('home-follow-visible-person')));
      expect(toggles, 1);
      expect(profiles, 0);
      await tester.tap(find.text('مستخدم عربي باسمه طويل'));
      expect(profiles, 1);
      expect(toggles, 1);
    }
  });

  testWidgets('confirmed following can be undone, pending requests disabled',
      (tester) async {
    var changes = 0;
    Future<void> render({required bool busy}) async {
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: SizedBox(
              height: 110,
              child: HomeCompactPersonCard(
                person: person,
                isFollowing: true,
                followBusy: busy,
                onTap: () {},
                onFollow: () => changes++,
              ),
            ),
          ),
        ),
      ));
    }

    await render(busy: true);
    expect(find.byTooltip('إلغاء المتابعة'), findsOneWidget);
    await tester.tap(find.byKey(const Key('home-follow-visible-person')));
    expect(changes, 0);
    expect(tester.takeException(), isNull);

    await render(busy: false);
    await tester.tap(find.byKey(const Key('home-follow-visible-person')));
    expect(changes, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unknown follow state has no misleading toggle or online badge',
      (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: Directionality(
          textDirection: TextDirection.rtl,
          child: SizedBox(
            height: 110,
            child: HomeCompactPersonCard(
              person: person,
              onTap: _noop,
            ),
          ),
        ),
      ),
    ));
    expect(find.byKey(const Key('home-follow-visible-person')), findsNothing);
    expect(find.byIcon(Icons.circle), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('person choices hide room without verified joinable presence',
      (tester) async {
    var profiles = 0;
    var follows = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Directionality(
          textDirection: TextDirection.rtl,
          child: HomePersonActionsSheet(
            person: person,
            isFollowing: false,
            onOpenProfile: () => profiles++,
            onFollow: () => follows++,
          ),
        ),
      ),
    ));
    expect(find.text('عرض الملف الشخصي'), findsOneWidget);
    expect(find.text('متابعة'), findsOneWidget);
    expect(find.text('الدخول إلى الغرفة'), findsNothing);
    await tester.tap(find.byKey(const Key('home-person-follow')));
    expect(follows, 1);
    await tester.tap(find.byKey(const Key('home-person-view-profile')));
    expect(profiles, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('guest/unknown follow state still exposes a usable profile',
      (tester) async {
    var profiles = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Directionality(
          textDirection: TextDirection.rtl,
          child: HomePersonActionsSheet(
            person: person,
            onOpenProfile: () => profiles++,
          ),
        ),
      ),
    ));
    expect(find.text('عرض الملف الشخصي'), findsOneWidget);
    expect(find.byKey(const Key('home-person-follow')), findsNothing);
    expect(find.text('الدخول إلى الغرفة'), findsNothing);
    await tester.tap(find.byKey(const Key('home-person-view-profile')));
    expect(profiles, 1);
    expect(tester.takeException(), isNull);
  });

  test('Home follow status is bounded and uses existing authenticated path',
      () {
    final home =
        File('lib/features/home/screens/home_screen.dart').readAsStringSync();
    final follow =
        File('lib/features/profile/services/follow_service.dart')
            .readAsStringSync();
    expect(home.contains('_followService.followingAmong('), isTrue);
    expect(home.contains('people.take(10)'), isTrue);
    expect(home.contains('_followService.setFollowing(person.id, !isFollowing)'),
        isTrue);
    expect(home.contains('if (onFollow != null)'), isTrue);
    expect(home.contains('followBusy ? null : onFollow'), isTrue);
    expect(home.contains('_refreshSuggestionFollows('), isTrue);
    expect(home.contains('if (person.isOnline)'), isFalse);
    expect(home.contains("room.data['ownerUid'] == person.id"), isFalse);
    expect(home.contains('Timer.periodic'), isFalse);
    expect(home.contains('_followService.isFollowing('), isFalse);
    expect(follow.contains('whereIn: byRelationId.keys.toList()'), isTrue);
    expect(follow.contains('.take(10)'), isTrue);
    expect(follow.contains("Uri.parse('\\$_baseUrl/chat-actions')"), isTrue);
    expect(follow.contains("'action': 'setFollow'"), isTrue);
  });
}

void _noop() {}
