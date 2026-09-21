import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/voice/services/voice_service.dart';
import 'package:voice_chat_room/features/voice/services/zego_voice_service.dart';

void main() {
  test('ZegoVoiceService is exposed through provider-neutral VoiceService', () {
    final VoiceService service = ZegoVoiceService();
    expect(service, isA<VoiceService>());
    service.dispose();
  });
}
