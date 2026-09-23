import 'dart:typed_data';

/// Provider-neutral contract for Shadow Live real-time voice.
///
/// UI and product logic must depend on this interface instead of importing a
/// vendor SDK. ZEGOCLOUD is the first provider, but it can be replaced later
/// without rewriting room screens or Shadow Live business rules.
abstract interface class VoiceService {
  Future<void> initialize();

  Future<void> joinRoom({
    required String roomId,
    required String userId,
    required String displayName,
    String? token,
    String? accessCode,
  });

  Future<void> leaveRoom();

  Future<void> muteMic();
  Future<void> unmuteMic();
  Future<void> setPlaybackEnabled(bool enabled);
  Future<void> playRoomMedia(Uint8List mediaData);
  Future<void> stopRoomMedia();

  Future<void> takeMicSeat(int seatIndex);
  Future<void> leaveMicSeat();
  Future<void> inviteToMic(String userId);
  Future<void> removeFromMic(String userId);
  Future<void> switchSeat(int seatIndex);

  Stream<VoiceConnectionState> get connectionStates;
  Stream<VoiceMicState> get micStates;

  Future<void> dispose();
}

enum VoiceConnectionState {
  idle,
  connecting,
  connected,
  reconnecting,
  disconnected,
  failed,
}

enum VoiceMicState {
  muted,
  unmuted,
}

/// Normalized error type exposed to Shadow Live.
///
/// Provider-specific error codes must be translated before leaving the
/// provider adapter.
class VoiceException implements Exception {
  const VoiceException(this.code, this.message);

  final String code;
  final String message;

  @override
  String toString() => 'VoiceException($code): $message';
}
