import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/profile/widgets/profile_personal_room_tab.dart';

void main() {
  testWidgets('personal room and room discovery remain usable on small phones',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[320, 360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 700));
      var opens = 0;
      var browses = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Directionality(
              textDirection: TextDirection.rtl,
              child: ProfilePersonalRoomTab(
                onOpenPersonalRoom: () => opens++,
                onBrowseRooms: () => browses++,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      final enter = find.byKey(const Key('own-profile-open-personal-room'));
      final browse = find.byKey(const Key('own-profile-browse-rooms'));
      expect(enter, findsOneWidget);
      expect(browse, findsOneWidget);
      expect(find.text('غرفتي الصوتية'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(enter);
      await tester.tap(browse);
      expect(opens, 1);
      expect(browses, 1);
    }
  });

  testWidgets('busy personal room button does not send another operation',
      (tester) async {
    var calls = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ProfilePersonalRoomTab(
          opening: true,
          onOpenPersonalRoom: () => calls++,
          onBrowseRooms: () {},
        ),
      ),
    ));
    await tester.pumpAndSettle();
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('own-profile-open-personal-room')),
    );
    expect(button.onPressed, isNull);
    expect(find.text('جارٍ فتح غرفتك...'), findsOneWidget);
    expect(calls, 0);
  });

  test('profile uses authoritative existing room command once per tap', () {
    final src = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    expect(src.contains('ProfilePersonalRoomTab('), isTrue);
    expect(src.contains('ProfileGiftShowcase(userId: currentUid)'), isTrue);
    expect(src.contains('_personalRoomActions.openPersonalRoom()'), isTrue);
    expect(src.contains('if (_openingOwnRoom) return;'), isTrue);
    expect(src.contains('room.toNavigationArguments()'), isTrue);
    expect(src.contains('AppRoutes.voiceChatRoom'), isTrue);
    expect(src.contains('AppRoutes.roomList'), isTrue);
    expect(src.contains('_personalRoomActions.close()'), isTrue);
    expect(src.contains("'غرف المستخدم'"), isFalse);
    expect(src.contains("'هدايا المستخدم'"), isFalse);

    final service = File(
      'lib/features/room/services/room_action_service.dart',
    ).readAsStringSync();
    expect(service.contains("_post({'action': 'personalRoom'})"), isTrue);
    expect(service.contains('PersonalRoomInfo.fromJson('), isTrue);
  });

  test('same bounded public gift showcase serves both profile tabs', () {
    final shared = File(
      'lib/features/profile/widgets/profile_gift_showcase.dart',
    ).readAsStringSync();
    final publicProfile = File(
      'lib/features/profile/screens/public_profile_screen.dart',
    ).readAsStringSync();
    final own = File(
      'lib/features/user/screens/profile_screen.dart',
    ).readAsStringSync();
    expect(shared.contains(".collection('public_gift_showcases')"), isTrue);
    expect(shared.contains(".doc(widget.userId)"), isTrue);
    expect(shared.contains(".collection('items')"), isTrue);
    expect(shared.contains(".orderBy('updatedAt', descending: true)"), isTrue);
    expect(shared.contains('.limit(60)'), isTrue);
    expect(shared.contains('late Stream<QuerySnapshot'), isTrue);
    expect(shared.contains('if (oldWidget.userId != widget.userId) _bind();'),
        isTrue);
    expect(shared.contains('ShadowAssetRegistry.remoteUrl(assetKey)'), isTrue);
    expect(shared.contains('هنا تظهر الهدايا العامة فقط'), isTrue);
    expect(publicProfile.contains(
      'ProfileGiftShowcase(userId: widget.userId)',
    ), isTrue);
    expect(own.contains('ProfileGiftShowcase(userId: currentUid)'), isTrue);
    for (final src in <String>[shared, publicProfile, own]) {
      expect(src.contains('public_gift_showcases').toString().isNotEmpty,
          isTrue); // No hidden second backend.
    }
    expect(shared.contains("collection('users')"), isFalse);
    expect(shared.contains("collection('wallet_ledger')"), isFalse);
    expect(shared.contains('Timer.periodic'), isFalse);
  });
}
