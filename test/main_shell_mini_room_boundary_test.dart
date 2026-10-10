import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/main/screens/main_shell_screen.dart';

void main() {
  test('mini room keeps the protruding close button inside 360/390/430 screens',
      () {
    for (final width in <double>[360, 390, 430]) {
      expect(clampMiniRoomInset(-900, extent: width), 10);
      expect(clampMiniRoomInset(900, extent: width), width - 72 - 10);
      expect(clampMiniRoomInset(14, extent: width), 14);
    }
  });

  test('mini room keeps clear of bottom and top safe areas', () {
    const height = 740.0;
    const topSystemInset = 26.0;
    expect(
      clampMiniRoomInset(-300, extent: height, farMargin: topSystemInset + 10),
      10,
    );
    expect(
      clampMiniRoomInset(3000, extent: height, farMargin: topSystemInset + 10),
      height - 72 - topSystemInset - 10,
    );
  });

  test('mini room handles unusually small bounds without invalid clamping', () {
    expect(clampMiniRoomInset(-40, extent: 80), 0);
    expect(clampMiniRoomInset(999, extent: 80), 0);
    expect(clampMiniRoomInset(999, extent: 98), 16);
  });

  test('mini room preserves drag, restore, close and the shared room image',
      () {
    final shell = File('lib/features/main/screens/main_shell_screen.dart')
        .readAsStringSync();
    expect(shell.contains('MediaQuery.paddingOf(context).top'), isTrue);
    expect(shell.contains('onPanUpdate: (details)'), isTrue);
    expect(shell.contains('clampMiniRoomInset('), isTrue);
    expect(shell.contains('onTap: _restoreMiniRoom'), isTrue);
    expect(shell.contains('MiniRoomCloseControl(onLeave: _leaveMiniRoom)'), isTrue);
    expect(shell.contains('width: 44,'), isTrue);
    expect(shell.contains('height: 44,'), isTrue);
    expect(shell.contains("key: const Key('mini-room-close')"), isTrue);
    expect(shell.contains('roomSurfaceImageUrl(_voiceSession.roomArguments)'), isTrue);
    expect(shell.contains("top: 0,"), isTrue);
    expect(shell.contains("right: 0,"), isTrue);
    expect(shell.contains('FirebaseFirestore.instance'), isTrue,
        reason: 'Existing chat unread stream must remain intact');
  });
}
