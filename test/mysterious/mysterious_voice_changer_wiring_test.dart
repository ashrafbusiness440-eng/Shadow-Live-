import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('mysterious voice changer uses provider-neutral ZEGO preset path', () {
    final contract = File(
      'lib/features/voice/services/voice_service.dart',
    ).readAsStringSync();
    final zego = File(
      'lib/features/voice/services/zego_voice_service.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    final screen = File(
      'lib/features/mysterious/screens/mysterious_person_screen.dart',
    ).readAsStringSync();

    expect(contract.contains('Future<void> setVoiceChanger('), isTrue);
    expect(zego.contains('setVoiceChangerPreset('), isTrue);
    expect(zego.contains('ZegoVoiceChangerPreset.Autobot'), isFalse);
    expect(zego.contains('ZegoVoiceChangerPreset.OutOfPower'), isFalse);
    expect(controller.contains('applyMysteriousVoice'), isTrue);
    expect(controller.contains('VoiceChangerPreset.original'), isTrue);
    expect(screen.contains("Key('mysterious-voice-options')"), isTrue);
    expect(screen.contains('_service.setVoice(option.id)'), isTrue);
  });
}
