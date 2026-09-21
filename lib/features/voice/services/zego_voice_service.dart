import 'dart:async';

import 'voice_service.dart';

/// ZEGOCLOUD adapter boundary.
///
/// Phase 6 will implement all ZEGOCLOUD SDK calls here. Keeping this adapter
/// behind [VoiceService] prevents vendor-specific types from leaking into
/// Shadow Live screens, room state, gifts, PK, moderation, or permissions.
class ZegoVoiceService implements VoiceService {
  final _connectionController =
      StreamController<VoiceConnectionState>.broadcast();
  final _micController = StreamController<VoiceMicState>.broadcast();

  @override
  Stream<VoiceConnectionState> get connectionStates =>
      _connectionController.stream;

  @override
  Stream<VoiceMicState> get micStates => _micController.stream;

  @override
  Future<void> initialize() async {
    // ZEGOCLOUD SDK initialization is intentionally isolated here.
    // Credentials/tokens must come from the server; never hard-code secrets.
    _connectionController.add(VoiceConnectionState.idle);
  }

  @override
  Future<void> joinRoom({
    required String roomId,
    required String userId,
    required String displayName,
    String? token,
  }) async {
    _connectionController.add(VoiceConnectionState.connecting);
    throw const VoiceException(
      'provider_not_configured',
      'ZEGOCLOUD credentials and server token endpoint are not configured yet.',
    );
  }

  @override
  Future<void> leaveRoom() async {
    _connectionController.add(VoiceConnectionState.disconnected);
  }

  @override
  Future<void> muteMic() async {
    _micController.add(VoiceMicState.muted);
  }

  @override
  Future<void> unmuteMic() async {
    _micController.add(VoiceMicState.unmuted);
  }

  @override
  Future<void> takeMicSeat(int seatIndex) async {}

  @override
  Future<void> leaveMicSeat() async {}

  @override
  Future<void> inviteToMic(String userId) async {}

  @override
  Future<void> removeFromMic(String userId) async {}

  @override
  Future<void> switchSeat(int seatIndex) async {}

  @override
  Future<void> dispose() async {
    await _connectionController.close();
    await _micController.close();
  }
}
