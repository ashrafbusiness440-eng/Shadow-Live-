import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/room/widgets/discovery_room_password_dialog.dart';

void main() {
  testWidgets('protected room prompt is RTL and returns entered password',
      (tester) async {
    Future<String?>? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () =>
                result = showDiscoveryRoomPasswordPrompt(context, 'غرفة خاصة'),
            child: const Text('فتح'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('فتح'));
    await tester.pumpAndSettle();
    expect(find.text('غرفة خاصة'), findsOneWidget);
    expect(find.text('كلمة مرور الغرفة'), findsOneWidget);
    expect(tester.widget<TextField>(find.byType(TextField)).obscureText, isTrue);
    expect(
      tester.widget<Directionality>(find.ancestor(
        of: find.byType(AlertDialog),
        matching: find.byType(Directionality),
      ).first).textDirection,
      TextDirection.rtl,
    );
    await tester.enterText(find.byType(TextField), 'room-secret');
    await tester.tap(find.text('دخول'));
    await tester.pumpAndSettle();
    expect(await result, 'room-secret');
    expect(tester.takeException(), isNull);
  });

  testWidgets('empty passwords stay in the dialog and cancel returns null',
      (tester) async {
    Future<String?>? result;
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Builder(
          builder: (context) => ElevatedButton(
            onPressed: () =>
                result = showDiscoveryRoomPasswordPrompt(context, 'غرفة'),
            child: const Text('فتح'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('فتح'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('دخول'));
    await tester.pump();
    expect(find.byType(AlertDialog), findsOneWidget);
    await tester.tap(find.text('إلغاء'));
    await tester.pumpAndSettle();
    expect(await result, isNull);
  });

  test('Home, room list and discovery search share the exact dialog', () {
    final home = File('lib/features/home/screens/home_screen.dart').readAsStringSync();
    final roomList = File('lib/screens/room/room_list_screen.dart').readAsStringSync();
    final search = File('lib/features/home/screens/discovery_search_screen.dart').readAsStringSync();
    for (final source in [home, roomList, search]) {
      expect(source.contains('showDiscoveryRoomPasswordPrompt('), isTrue);
      expect(source.contains("args['roomPassword'] = password;"), isTrue);
      expect(source.contains('if (!mounted || password == null) return;'), isTrue);
      expect(source.contains('_askRoomPassword('), isFalse);
    }
    expect(home.contains('room.isPasswordProtected && !isOwner'), isTrue);
    expect(home.contains('final currentUid = FirebaseAuth.instance.currentUser?.uid;'), isTrue);
    expect(home.contains('NavigationService.navigateTo('), isTrue);
    expect(home.contains('RoomRealtimeQueryService('), isFalse);
  });
}
