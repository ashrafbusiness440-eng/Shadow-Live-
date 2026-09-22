import 'dart:async';
import 'dart:typed_data';

import 'package:zego_express_engine/zego_express_engine.dart';

import 'voice_service.dart';
import 'voice_token_client.dart';

/// ZEGOCLOUD implementation hidden behind the provider-neutral [VoiceService].
///
/// The ServerSecret never reaches this class. A short-lived token is requested
/// from Shadow Live's authenticated backend for every room join.
class ZegoVoiceService implements VoiceService {
  ZegoVoiceService({VoiceTokenClient? tokenClient})
      : _tokenClient = tokenClient ?? VoiceTokenClient();

  final VoiceTokenClient _tokenClient;
  final _connectionController =
      StreamController<VoiceConnectionState>.broadcast();
  final _micController = StreamController<VoiceMicState>.broadcast();
  final Set<String> _playingStreams = <String>{};

  bool _engineCreated = false;
  bool _joined = false;
  bool _publishing = false;
  int? _appId;
  String? _roomId;
  String? _zegoUserId;
  String? _streamId;
  String? _accessCode;
  int? _seatIndex;
  bool _tokenRenewalInFlight = false;
  ZegoMediaPlayer? _roomMediaPlayer;
  bool _publishingForRoomMedia = false;

  @override
  Stream<VoiceConnectionState> get connectionStates =>
      _connectionController.stream;

  @override
  Stream<VoiceMicState> get micStates => _micController.stream;

  @override
  Future<void> initialize() async {
    _connectionController.add(VoiceConnectionState.idle);
    _micController.add(VoiceMicState.muted);
  }

  Future<void> _ensureEngine(int appId) async {
    if (_engineCreated) {
      if (_appId != appId) {
        throw const VoiceException(
          'app_id_changed',
          'Voice provider AppID changed while the engine is running.',
        );
      }
      return;
    }

    await ZegoExpressEngine.createEngineWithProfile(
      ZegoEngineProfile(appId, ZegoScenario.StandardVoiceCall),
    );
    _engineCreated = true;
    _appId = appId;
    await ZegoExpressEngine.instance.enableCamera(false);

    ZegoExpressEngine.onRoomStreamUpdate = (
      String roomID,
      ZegoUpdateType updateType,
      List<ZegoStream> streamList,
      Map<String, dynamic> extendedData,
    ) {
      if (roomID != _roomId) return;
      if (updateType == ZegoUpdateType.Add) {
        for (final stream in streamList) {
          _playingStreams.add(stream.streamID);
          unawaited(
            ZegoExpressEngine.instance.startPlayingStream(stream.streamID),
          );
        }
      } else {
        for (final stream in streamList) {
          _playingStreams.remove(stream.streamID);
          unawaited(
            ZegoExpressEngine.instance.stopPlayingStream(stream.streamID),
          );
        }
      }
    };

    ZegoExpressEngine.onRoomStateChanged = (
      String roomID,
      ZegoRoomStateChangedReason reason,
      int errorCode,
      Map<String, dynamic> extendedData,
    ) {
      if (roomID != _roomId) return;

      switch (reason) {
        case ZegoRoomStateChangedReason.Logining:
          _connectionController.add(VoiceConnectionState.connecting);
          break;
        case ZegoRoomStateChangedReason.Logined:
          _connectionController.add(VoiceConnectionState.connected);
          break;
        case ZegoRoomStateChangedReason.LoginFailed:
          _connectionController.add(VoiceConnectionState.failed);
          break;
        case ZegoRoomStateChangedReason.Reconnecting:
          _connectionController.add(VoiceConnectionState.reconnecting);
          break;
        case ZegoRoomStateChangedReason.Reconnected:
          _connectionController.add(VoiceConnectionState.connected);
          unawaited(_renewRoomToken(roomID));
          break;
        case ZegoRoomStateChangedReason.ReconnectFailed:
          _connectionController.add(VoiceConnectionState.failed);
          break;
        case ZegoRoomStateChangedReason.KickOut:
          _joined = false;
          _publishing = false;
          _micController.add(VoiceMicState.muted);
          _connectionController.add(VoiceConnectionState.disconnected);
          break;
        case ZegoRoomStateChangedReason.Logout:
          _connectionController.add(VoiceConnectionState.disconnected);
          break;
        case ZegoRoomStateChangedReason.LogoutFailed:
          _connectionController.add(VoiceConnectionState.failed);
          break;
      }
    };

    ZegoExpressEngine.onRoomTokenWillExpire = (
      String roomID,
      int remainTimeInSecond,
    ) {
      if (roomID != _roomId || !_joined) return;
      unawaited(_renewRoomToken(roomID));
    };
  }


  Future<void> _renewRoomToken(String roomId) async {
    if (_tokenRenewalInFlight || !_joined || _roomId != roomId) return;

    _tokenRenewalInFlight = true;
    try {
      for (var attempt = 0; attempt < 3; attempt++) {
        if (!_joined || _roomId != roomId) return;
        if (attempt > 0) {
          await Future<void>.delayed(Duration(seconds: attempt * 2));
          if (!_joined || _roomId != roomId) return;
        }

        try {
          final session = await _tokenClient.createSession(
            roomId,
            roomPassword: _accessCode,
          );
          if (!_joined || _roomId != roomId) return;
          if (session.appId != _appId || session.roomId != roomId) {
            throw const VoiceException(
              'token_session_mismatch',
              'Voice token session does not match the active room.',
            );
          }

          await ZegoExpressEngine.instance.renewToken(roomId, session.token);
          return;
        } catch (_) {
          if (attempt == 2 && _joined && _roomId == roomId) {
            _connectionController.add(VoiceConnectionState.failed);
          }
        }
      }
    } finally {
      _tokenRenewalInFlight = false;
    }
  }

  @override
  Future<void> joinRoom({
    required String roomId,
    required String userId,
    required String displayName,
    String? token,
    String? accessCode,
  }) async {
    if (_joined && _roomId == roomId) return;
    if (_joined) await leaveRoom();

    _connectionController.add(VoiceConnectionState.connecting);
    try {
      _accessCode = accessCode?.trim();
      final session = await _tokenClient.createSession(
        roomId,
        roomPassword: _accessCode,
      );
      await _ensureEngine(session.appId);

      _roomId = roomId;
      _zegoUserId = session.userId;
      _streamId = '${roomId}_${session.userId}';
      final roomToken = token != null && token.isNotEmpty ? token : session.token;
      final result = await ZegoExpressEngine.instance.loginRoom(
        roomId,
        ZegoUser(session.userId, displayName),
        config: ZegoRoomConfig(0, true, roomToken),
      );
      if (result.errorCode != 0) {
        _connectionController.add(VoiceConnectionState.failed);
        throw VoiceException(
          'zego_login_failed',
          'ZEGO room login failed with code ${result.errorCode}.',
        );
      }

      _joined = true;
      _publishing = false;
      _seatIndex = null;
      _connectionController.add(VoiceConnectionState.connected);
      _micController.add(VoiceMicState.muted);
    } catch (error) {
      if (error is VoiceException) rethrow;
      _connectionController.add(VoiceConnectionState.failed);
      throw VoiceException('join_failed', error.toString());
    }
  }

  void _requireJoined() {
    if (!_joined || _roomId == null || _zegoUserId == null) {
      throw const VoiceException('not_in_room', 'Join a voice room first.');
    }
  }

  @override
  Future<void> leaveRoom() async {
    if (!_joined) {
      _connectionController.add(VoiceConnectionState.disconnected);
      return;
    }
    try {
      await stopRoomMedia();
      if (_publishing) {
        await ZegoExpressEngine.instance.stopPublishingStream();
      }
      for (final streamId in List<String>.from(_playingStreams)) {
        await ZegoExpressEngine.instance.stopPlayingStream(streamId);
      }
      _playingStreams.clear();
      await ZegoExpressEngine.instance.logoutRoom(_roomId);
    } finally {
      _joined = false;
      _publishing = false;
      _roomId = null;
      _zegoUserId = null;
      _streamId = null;
      _accessCode = null;
      _seatIndex = null;
      _micController.add(VoiceMicState.muted);
      _connectionController.add(VoiceConnectionState.disconnected);
    }
  }

  @override
  Future<void> muteMic() async {
    _requireJoined();
    await ZegoExpressEngine.instance.muteMicrophone(true);
    _micController.add(VoiceMicState.muted);
  }

  @override
  Future<void> setPlaybackEnabled(bool enabled) async {
    _requireJoined();
    await ZegoExpressEngine.instance.muteAllPlayStreamAudio(!enabled);
  }

  @override
  Future<void> unmuteMic() async {
    _requireJoined();
    final streamId = _streamId;
    if (streamId == null) {
      throw const VoiceException('stream_not_ready', 'Voice stream is not ready.');
    }
    if (!_publishing) {
      await ZegoExpressEngine.instance.enableCamera(false);
      await ZegoExpressEngine.instance.startPublishingStream(streamId);
      _publishing = true;
    }
    _publishingForRoomMedia = false;
    await ZegoExpressEngine.instance.mutePublishStreamAudio(false);
    await ZegoExpressEngine.instance.muteMicrophone(false);
    _micController.add(VoiceMicState.unmuted);
  }

  @override
  Future<void> playRoomMedia(Uint8List mediaData) async {
    _requireJoined();
    if (mediaData.isEmpty) {
      throw const VoiceException(
        'room_media_empty',
        'Room media resource is empty.',
      );
    }
    final streamId = _streamId;
    if (streamId == null) {
      throw const VoiceException(
        'stream_not_ready',
        'Voice stream is not ready.',
      );
    }

    if (!_publishing) {
      await ZegoExpressEngine.instance.enableCamera(false);
      await ZegoExpressEngine.instance.startPublishingStream(streamId);
      _publishing = true;
      _publishingForRoomMedia = true;
      await ZegoExpressEngine.instance.mutePublishStreamAudio(false);
      await ZegoExpressEngine.instance.muteMicrophone(true);
    }

    _roomMediaPlayer ??=
        await ZegoExpressEngine.instance.createMediaPlayer();
    final player = _roomMediaPlayer;
    if (player == null) {
      throw const VoiceException(
        'room_media_player_unavailable',
        'Unable to create room media player.',
      );
    }

    try {
      await player.stop();
    } catch (_) {}
    final loaded =
        await player.loadResourceFromMediaData(mediaData, 0);
    if (loaded.errorCode != 0) {
      throw VoiceException(
        'room_media_load_failed',
        'ZEGO media load failed with code ' +
            loaded.errorCode.toString() +
            '.',
      );
    }
    await player.enableAux(true);
    await player.muteLocal(false);
    await player.start();
  }

  @override
  Future<void> stopRoomMedia() async {
    final player = _roomMediaPlayer;
    if (player != null) {
      try {
        await player.stop();
      } catch (_) {}
      try {
        await player.enableAux(false);
      } catch (_) {}
    }

    if (_publishingForRoomMedia && _publishing) {
      try {
        await ZegoExpressEngine.instance.stopPublishingStream();
      } catch (_) {}
      _publishing = false;
      _publishingForRoomMedia = false;
    }
  }

  @override
  Future<void> takeMicSeat(int seatIndex) async {
    _requireJoined();
    if (seatIndex < 0) {
      throw const VoiceException('invalid_seat', 'Seat index must be non-negative.');
    }
    _seatIndex = seatIndex;
  }

  @override
  Future<void> leaveMicSeat() async {
    _requireJoined();
    _seatIndex = null;
    if (_publishing) {
      await ZegoExpressEngine.instance.stopPublishingStream();
      _publishing = false;
    }
    _micController.add(VoiceMicState.muted);
  }

  @override
  Future<void> inviteToMic(String userId) async {
    _requireJoined();
    // Seat invitations are Shadow Live business state, not a ZEGO primitive.
  }

  @override
  Future<void> removeFromMic(String userId) async {
    _requireJoined();
    // Remote seat removal is enforced by Shadow Live room state/token policy.
  }

  @override
  Future<void> switchSeat(int seatIndex) async {
    await takeMicSeat(seatIndex);
  }

  @override
  Future<void> dispose() async {
    if (_joined) await leaveRoom();
    if (_roomMediaPlayer != null) {
      try {
        await ZegoExpressEngine.instance
            .destroyMediaPlayer(_roomMediaPlayer!);
      } catch (_) {}
      _roomMediaPlayer = null;
    }
    if (_engineCreated) {
      ZegoExpressEngine.onRoomStreamUpdate = null;
      ZegoExpressEngine.onRoomStateChanged = null;
      ZegoExpressEngine.onRoomTokenWillExpire = null;
      await ZegoExpressEngine.destroyEngine();
      _engineCreated = false;
      _appId = null;
    }
    _tokenClient.close();
    await _connectionController.close();
    await _micController.close();
  }
}
