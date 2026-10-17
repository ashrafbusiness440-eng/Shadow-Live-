import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('private call microphone prevents voice-note record, stop and send', () {
    final source = File(
      'lib/features/chat/widgets/private_voice_note_controls.dart',
    ).readAsStringSync();
    final controller = File(
      'lib/features/voice/services/voice_room_session_controller.dart',
    ).readAsStringSync();
    expect(controller, contains('bool get privateCallMediaActive'));
    expect(source, contains(
      'if (VoiceRoomSessionController.instance.privateCallMediaActive) {',
    ));
    expect(source, contains('لا يمكن تسجيل رسالة صوتية أثناء مكالمة خاصة.'));
    expect(source, contains('تم إلغاء التسجيل لأنك في مكالمة خاصة.'));
    expect(source, contains('Future<bool> _eligibleToRecord() async'));
    expect(source, contains('if (!await _eligibleToRecord() || !_sameAccount) return;'));
    expect(source, contains('await _recorder.cancel();'));
  });

  test('voice-note uploads use one server policy and block an occupied call slot', () {
    final eligibility = File(
      'cloudflare-worker/src/private-voice-eligibility.js',
    ).readAsStringSync();
    final media = File(
      'cloudflare-worker/src/private-voice-media.js',
    ).readAsStringSync();
    expect(eligibility, contains('voice_note_during_private_call'));
    expect(eligibility, contains('private_call_slots/'));
    expect(eligibility, contains('params.allowReadDuringCall !== true'));
    expect(media, contains('await eligibility(db,uid,otherUid,conversationId,tx);'));
    expect(media, contains('await eligibility(db,uid,peer,raw.conversationId,null,true);'));
  });
}
