import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/chat/screens/chat_list_screen.dart';

void main() {
  testWidgets('messages owns the only active notification bell and unread dot',
      (tester) async {
    addTearDown(() => tester.binding.setSurfaceSize(null));
    for (final width in <double>[360, 390, 430]) {
      await tester.binding.setSurfaceSize(Size(width, 740));
      var opens = 0;
      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Directionality(
            textDirection: TextDirection.rtl,
            child: Row(
              children: [
                ChatNotificationBell(
                  hasUnread: true,
                  onPressed: () => opens++,
                ),
              ],
            ),
          ),
        ),
      ));
      expect(find.byKey(const Key('messages-notifications')), findsOneWidget);
      expect(find.byKey(const Key('messages-notifications-unread')),
          findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const Key('messages-notifications')));
      expect(opens, 1);

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: ChatNotificationBell(
            hasUnread: false,
            onPressed: () => opens++,
          ),
        ),
      ));
      expect(find.byKey(const Key('messages-notifications-unread')),
          findsNothing);
      await tester.tap(find.byKey(const Key('messages-notifications')));
      expect(opens, 2);
    }
  });

  test('home shortcuts and hero reuse the main shell navigation', () {
    final home =
        File('lib/features/home/screens/home_screen.dart').readAsStringSync();
    final shell = File('lib/features/main/screens/main_shell_screen.dart')
        .readAsStringSync();
    expect(home.contains('this.onOpenGames'), isTrue);
    expect(home.contains('this.onOpenRooms'), isTrue);
    expect(home.contains('widget.onOpenGames)'), isTrue);
    expect(home.contains("_Feature('الألعاب', 'العب واربح'"), isTrue);
    expect(home.contains('onPressed: widget.onOpenRooms,'), isTrue);
    expect(home.contains("label: const Text('استكشف الغرف')"), isTrue);
    expect(home.contains("() => _soon('الألعاب')"), isFalse);
    expect(home.contains('AppRoutes.notifications'), isFalse);
    expect(home.contains('Icons.notifications_none_rounded'), isFalse);
    expect(home.contains('Icons.task_alt_rounded'), isTrue);
    expect(home.contains('onPressed: null,'), isTrue);
    expect(shell.contains('onOpenGames: () => _changePage(2),'), isTrue);
    expect(shell.contains('onOpenRooms: () => _changePage(1),'), isTrue);
    expect(shell.contains('if (_guest && (navIndex == 2 || navIndex == 3))'),
        isTrue);
  });

  test('unread indication is bounded, user scoped, and reuses notification data',
      () {
    final chat =
        File('lib/features/chat/screens/chat_list_screen.dart')
            .readAsStringSync();
    final notifications =
        File('lib/features/notifications/services/notification_service.dart')
            .readAsStringSync();
    expect(chat.contains('StreamBuilder<bool>('), isTrue);
    expect(chat.contains('if (_notificationOwnerUid != me)'), isTrue);
    expect(chat.contains('_notificationService.watchHasUnread(me)'), isTrue);
    expect(chat.contains('hasUnread: snapshot.data == true'), isTrue);
    expect(chat.contains('pushNamed(AppRoutes.notifications)'), isTrue);
    expect(notifications.contains("collection('notifications')"), isTrue);
    expect(notifications.contains(".where('userId', isEqualTo: userId)"),
        isTrue);
    expect(notifications.contains(".where('read', isEqualTo: false)"), isTrue);
    expect(notifications.contains('.limit(1)'), isTrue);
    expect(notifications.contains('.snapshots()'), isTrue);
    expect(notifications.contains('Timer.periodic'), isFalse);
    expect(chat.contains('Timer.periodic'), isFalse);
  });
}
