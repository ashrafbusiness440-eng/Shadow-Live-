import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final source = File('lib/main.dart').readAsStringSync();
  final roomStart = source.indexOf('class _VoiceChatRoomState');
  final roomEnd = source.indexOf('class _RoomToolToggle', roomStart);
  final roomSource = source.substring(roomStart, roomEnd);
  final buildStart = roomSource.lastIndexOf('  Widget build(BuildContext context) {');
  final buildSource = roomSource.substring(buildStart);

  test('opening the keyboard does not resize the room mic stage', () {
    expect(buildSource, contains('resizeToAvoidBottomInset: false,'));
    expect(buildSource, contains('top: micTop,'));
    expect(buildSource, contains('height: micHeight,'));

    // The composer must stay available above the keyboard even when the
    // Scaffold body itself no longer shrinks around the IME.
    expect(
      buildSource,
      contains('bottom: MediaQuery.viewInsetsOf(context).bottom,'),
    );
    expect(buildSource, contains('child: _buildRoomBottomBar(),'));
  });

  test('seats and room audience cannot be dragged vertically', () {
    final micStart = buildSource.indexOf('top: micTop,');
    final chatStart = buildSource.indexOf('// The chat list owns scrolling.', micStart);
    expect(micStart, greaterThanOrEqualTo(0));
    expect(chatStart, greaterThan(micStart));

    final micStage = buildSource.substring(micStart, chatStart);
    expect(micStage, contains('NeverScrollableScrollPhysics()'));
    expect(micStage, isNot(contains('BouncingScrollPhysics()')));
    expect(micStage, contains('_buildVoiceSeats()'));
    expect(micStage, contains('_buildRoomAudienceStrip()'));
    // The dedicated chat feed keeps its independent scrolling.
    expect(buildSource, contains('child: const bool.fromEnvironment'));
    expect(buildSource, contains('RoomChatFeed('));
  });
}
