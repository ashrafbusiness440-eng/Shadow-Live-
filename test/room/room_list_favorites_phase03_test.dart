import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/home/services/discovery_service.dart';
import 'package:voice_chat_room/screens/room/room_list_screen.dart';

void main() {
  const room = DiscoveryRoom(
    id: 'favorite-room',
    data: {
      'name': 'غرفة رسمية باسم طويل لاختبار مساحة الأزرار',
      'isFeatured': true,
      'onlineCount': 42,
      'description': 'وصف طويل يجب أن يبقى داخل البطاقة',
    },
  );

  testWidgets('favorite is an independent compact RTL hit target',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 750));
      var roomOpens = 0;
      var favoriteToggles = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: ListView(children: [
              RoomListTile(
                room: room,
                category: 'رسمية',
                showFavoriteAction: true,
                onFavoriteTap: () => favoriteToggles++,
                onTap: () => roomOpens++,
              ),
            ]),
          ),
        ),
      ));
      expect(find.byTooltip('أضف إلى المفضلة'), findsOneWidget);
      expect(find.byIcon(Icons.favorite_border_rounded), findsOneWidget);
      final size = tester.getSize(find.byType(RoomListTile));
      expect(size.height, lessThan(115));
      expect(tester.takeException(), isNull);
      await tester.tap(find.byTooltip('أضف إلى المفضلة'));
      await tester.pump();
      expect(favoriteToggles, 1);
      expect(roomOpens, 0, reason: 'Tapping favorite must not enter the room');
      await tester.tap(find.byType(RoomListTile));
      await tester.pump();
      expect(roomOpens, 1);
    }
  });

  testWidgets('saved status and busy state are explicit and do not enter room',
      (tester) async {
    var roomOpens = 0;
    var favoriteToggles = 0;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: [
          RoomListTile(
            room: room,
            category: 'رسمية',
            showFavoriteAction: true,
            isFavorite: true,
            onFavoriteTap: () => favoriteToggles++,
            onTap: () => roomOpens++,
          ),
        ]),
      ),
    ));
    expect(find.byIcon(Icons.favorite_rounded), findsOneWidget);
    await tester.tap(find.byTooltip('إزالة من المفضلة'));
    expect(favoriteToggles, 1);
    expect(roomOpens, 0);

    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: ListView(children: [
          RoomListTile(
            room: room,
            category: 'رسمية',
            showFavoriteAction: true,
            favoriteBusy: true,
            isFavorite: true,
            onFavoriteTap: () => favoriteToggles++,
            onTap: () => roomOpens++,
          ),
        ]),
      ),
    ));
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
    await tester.tap(find.byTooltip('إزالة من المفضلة'));
    expect(favoriteToggles, 1);
    expect(roomOpens, 0);
    expect(tester.takeException(), isNull);
  });

  test('favorite mutation reuses existing server action and cached library', () {
    final service = File('lib/features/room/services/room_action_service.dart')
        .readAsStringSync();
    final screen = File('lib/screens/room/room_list_screen.dart')
        .readAsStringSync();

    expect(service.contains("'action': 'setRoomFavorite'"), isTrue);
    expect(service.contains("'roomId': roomId"), isTrue);
    expect(service.contains("'favorite': favorite"), isTrue);
    expect(service.contains("'action': 'roomLibrary'"), isTrue);
    expect(screen.contains('_roomActions.setRoomFavorite('), isTrue);
    expect(screen.contains('if (_libraryLoading || _savingFavoriteIds.contains(room.id)) return;'), isTrue);
    expect(screen.contains('_libraryLoaded && _libraryUid == currentUid'), isTrue);
    expect(screen.contains('if (!forceRefresh && _libraryLoaded && _libraryUid == user.uid) return;'), isTrue);
    expect(screen.contains("content: Text('تعذر تعديل المفضلة."), isTrue);
    expect(screen.contains('showFavoriteAction: true'), isTrue);
    expect(screen.contains('StreamBuilder('), isFalse);
    expect(screen.contains('FirebaseFirestore.instance'), isFalse);
  });
}
