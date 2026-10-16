import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/features/chat/services/private_voice_recorder.dart';

void main() {
  test('private voice WAV header is valid and size is bounded', () {
    final pcm = Uint8List(16000 * 2); // exactly 1 second at mono PCM16
    final wav = encodePrivateVoiceWav(pcm);
    expect(wav.length, 32044);
    expect(String.fromCharCodes(wav.sublist(0,4)), 'RIFF');
    expect(String.fromCharCodes(wav.sublist(8,12)), 'WAVE');
    expect(String.fromCharCodes(wav.sublist(36,40)), 'data');
    final header = ByteData.sublistView(wav);
    expect(header.getUint32(24,Endian.little), 16000);
    expect(header.getUint32(40,Endian.little), 32000);
    expect(header.getUint16(22,Endian.little), 1);
    expect(header.getUint16(34,Endian.little), 16);
  });
  test('empty, odd and too-large PCM samples fail closed', () {
    for (final bytes in [
      Uint8List(0), Uint8List(3), Uint8List(privateVoiceMaxBytes),
    ]) {
      expect(() => encodePrivateVoiceWav(bytes), throwsStateError);
    }
  });
}
