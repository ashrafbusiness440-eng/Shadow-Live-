import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Android system back preserves live room as a draggable mini room', () {
    final room = File('lib/main.dart').readAsStringSync();
    final shell = File('lib/features/main/screens/main_shell_screen.dart')
        .readAsStringSync();
    final session =
        File('lib/features/voice/services/voice_room_session_controller.dart')
            .readAsStringSync();

    expect(room.contains('return PopScope<Object?>('), isTrue);
    expect(room.contains('canPop: false,'), isTrue);
    expect(room.contains('onPopInvokedWithResult: (didPop, result)'), isTrue);
    expect(room.contains('if (!didPop) unawaited(_minimizeVoiceRoom());'),
        isTrue);
    expect(room.contains('if (_roomNavigationInFlight || !mounted) return;'),
        isTrue);
    expect(room.contains('_voiceSession.minimize();'), isTrue);
    expect(room.contains('_minimizeAfterJoin = true;'), isTrue);
    expect(room.contains('if (_minimizeAfterJoin) {'), isTrue);
    expect(room.contains('initialNavIndex: destinationNavIndex'), isTrue);

    final minimizeStart = room.indexOf(
      'Future<void> _minimizeVoiceRoom({int destinationNavIndex = 1})');
    final minimizeEnd = room.indexOf(
      'Future<void> _closePersonalRoom()', minimizeStart);
    expect(minimizeStart, greaterThan(0));
    final minimize = room.substring(minimizeStart, minimizeEnd);
    expect(minimize.contains('_voiceSession.leave()'), isFalse);
    expect(minimize.contains('leaveSeat('), isFalse);

    expect(shell.contains("const cardSize = 72.0;"), isTrue);
    expect(shell.contains("key: const Key('mini-room-card')"), isTrue);
    expect(shell.contains("key: const Key('mini-room-close')"), isTrue);
    expect(shell.contains('onPanUpdate: (details)'), isTrue);
    expect(shell.contains('onTap: _restoreMiniRoom'), isTrue);
    expect(shell.contains('child: MiniRoomCloseControl('), isTrue);
    expect(shell.contains('onLeave: _leaveMiniRoom,'), isTrue);
    expect(shell.contains('leaving: _miniRoomLeaving,'), isTrue);
    expect(shell.contains('if (_miniRoomLeaving || !_voiceSession.active) return;'),
        isTrue);
    expect(shell.contains('if (!_voiceSession.active || !_voiceSession.minimized)'),
        isTrue);
    expect(session.contains('void minimize() {'), isTrue);
    expect(session.contains('_minimized = true;'), isTrue);
    expect(session.contains('void restore() {'), isTrue);
  });
}
