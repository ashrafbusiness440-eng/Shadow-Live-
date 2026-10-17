import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('voice-note playback shows bounded event-driven progress without polling', () {
    final code = File('lib/features/chat/widgets/private_voice_note_controls.dart')
        .readAsStringSync();
    final playback = code.substring(
      code.indexOf('class _PrivateVoicePlaybackTileState'),
    );
    expect(playback, contains('LinearProgressIndicator('));
    expect(playback, contains('onPositionChanged.listen('));
    expect(playback, contains('onPlayerComplete.listen('));
    expect(playback, contains("label: 'تقدم الرسالة الصوتية'"));
    expect(playback, contains('.clamp(0.0, 1.0).toDouble()'));
    expect(playback, contains('Future<void> _clearListeners() async'));
    expect(playback, contains('FirebaseAuth.instance.authStateChanges().listen('));
    expect(playback, contains('void _listenWhilePlaying(AudioPlayer player, int generation)'));
    expect(playback, isNot(contains('Timer.periodic')));
    expect(playback, isNot(contains('setInterval')));
  });
}
