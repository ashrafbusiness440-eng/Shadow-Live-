import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import '../constants/app_constants.dart';
import '../utils/app_logger.dart';
import '../exceptions/app_exceptions.dart';

class AgoraService {
  static final AgoraService _instance = AgoraService._internal();
  factory AgoraService() => _instance;
  AgoraService._internal();

  late final RtcEngine _engine;
  bool _isInitialized = false;
  bool _isMuted = false;

  // Initialize Agora engine
  Future<void> initialize() async {
    if (_isInitialized) return;

    try {
      _engine = createAgoraRtcEngine();
      await _engine.initialize(RtcEngineContext(
        appId: AppConstants.agoraAppId,
        channelProfile: ChannelProfileType.channelProfileLiveBroadcasting,
      ));

      // Set audio profile and scenario
      await _engine.setAudioProfile(
        profile: AudioProfileType.audioProfileMusicHighQuality,
        scenario: AudioScenarioType.audioScenarioGameStreaming,
      );

      // Enable audio volume indication
      await _engine.enableAudioVolumeIndication(
        interval: 250,
        smooth: 3,
        reportVad: true,
      );

      _isInitialized = true;
      AppLogger.i('Agora engine initialized', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Agora initialization error', tag: 'Agora', error: e);
      throw VoiceChatException('Failed to initialize Agora: ${e.toString()}');
    }
  }

  // Join a voice channel
  Future<void> joinChannel({
    required String channelName,
    required String uid,
    required bool isHost,
  }) async {
    try {
      if (!_isInitialized) await initialize();

      // Set client role
      await _engine.setClientRole(
        role: isHost
            ? ClientRoleType.clientRoleBroadcaster
            : ClientRoleType.clientRoleAudience,
      );

      // Join the channel
      await _engine.joinChannel(
        token: null, // Use token server in production
        channelId: channelName,
        uid: int.parse(uid),
        options: const ChannelMediaOptions(
          clientRoleType: ClientRoleType.clientRoleBroadcaster,
          publishMicrophoneTrack: true,
          autoSubscribeAudio: true,
        ),
      );

      AppLogger.i(
        'Joined channel: $channelName as ${isHost ? "host" : "audience"}',
        tag: 'Agora',
      );
    } catch (e) {
      AppLogger.e('Join channel error', tag: 'Agora', error: e);
      throw VoiceChatException('Failed to join channel: ${e.toString()}');
    }
  }

  // Leave the current channel
  Future<void> leaveChannel() async {
    try {
      await _engine.leaveChannel();
      AppLogger.i('Left channel', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Leave channel error', tag: 'Agora', error: e);
      throw VoiceChatException('Failed to leave channel: ${e.toString()}');
    }
  }

  // Toggle microphone
  Future<void> toggleMicrophone() async {
    try {
      _isMuted = !_isMuted;
      await _engine.enableLocalAudio(!_isMuted);
      AppLogger.i('Microphone ${_isMuted ? "muted" : "unmuted"}', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Toggle microphone error', tag: 'Agora', error: e);
      throw VoiceChatException('Failed to toggle microphone: ${e.toString()}');
    }
  }

  // Set audio profile
  Future<void> setAudioProfile({
    required AudioProfileType profile,
    required AudioScenarioType scenario,
  }) async {
    try {
      await _engine.setAudioProfile(
        profile: profile,
        scenario: scenario,
      );
      AppLogger.i(
        'Audio profile set: $profile, scenario: $scenario',
        tag: 'Agora',
      );
    } catch (e) {
      AppLogger.e('Set audio profile error', tag: 'Agora', error: e);
      throw VoiceChatException('Failed to set audio profile: ${e.toString()}');
    }
  }

  // Adjust recording volume
  Future<void> adjustRecordingVolume(int volume) async {
    try {
      await _engine.adjustRecordingSignalVolume(volume);
      AppLogger.i('Recording volume adjusted: $volume', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Adjust recording volume error', tag: 'Agora', error: e);
      throw VoiceChatException(
        'Failed to adjust recording volume: ${e.toString()}',
      );
    }
  }

  // Adjust playback volume
  Future<void> adjustPlaybackVolume(int volume) async {
    try {
      await _engine.adjustPlaybackSignalVolume(volume);
      AppLogger.i('Playback volume adjusted: $volume', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Adjust playback volume error', tag: 'Agora', error: e);
      throw VoiceChatException(
        'Failed to adjust playback volume: ${e.toString()}',
      );
    }
  }

  // Enable/disable echo cancellation
  Future<void> setEchoCancellation(bool enabled) async {
    try {
      await _engine.setEchoCancellationEnabled(enabled);
      AppLogger.i(
        'Echo cancellation ${enabled ? "enabled" : "disabled"}',
        tag: 'Agora',
      );
    } catch (e) {
      AppLogger.e('Set echo cancellation error', tag: 'Agora', error: e);
      throw VoiceChatException(
        'Failed to set echo cancellation: ${e.toString()}',
      );
    }
  }

  // Enable/disable noise suppression
  Future<void> setNoiseSuppression(bool enabled) async {
    try {
      await _engine.setNoiseSuppression(enabled);
      AppLogger.i(
        'Noise suppression ${enabled ? "enabled" : "disabled"}',
        tag: 'Agora',
      );
    } catch (e) {
      AppLogger.e('Set noise suppression error', tag: 'Agora', error: e);
      throw VoiceChatException(
        'Failed to set noise suppression: ${e.toString()}',
      );
    }
  }

  // Set voice beautifier preset
  Future<void> setVoiceBeautifierPreset(
    VoiceBeautifierPreset preset,
  ) async {
    try {
      await _engine.setVoiceBeautifierPreset(preset);
      AppLogger.i('Voice beautifier preset set: $preset', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Set voice beautifier preset error', tag: 'Agora', error: e);
      throw VoiceChatException(
        'Failed to set voice beautifier preset: ${e.toString()}',
      );
    }
  }

  // Set audio effect preset
  Future<void> setAudioEffectPreset(AudioEffectPreset preset) async {
    try {
      await _engine.setAudioEffectPreset(preset);
      AppLogger.i('Audio effect preset set: $preset', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Set audio effect preset error', tag: 'Agora', error: e);
      throw VoiceChatException(
        'Failed to set audio effect preset: ${e.toString()}',
      );
    }
  }

  // Register event handlers
  void registerEventHandlers({
    void Function(String channel, int uid)? onUserJoined,
    void Function(String channel, int uid)? onUserOffline,
    void Function(String channel)? onJoinChannelSuccess,
    void Function(String channel)? onLeaveChannel,
    void Function(List<AudioVolumeInfo> speakers)? onAudioVolumeIndication,
    void Function(ErrorCodeType err)? onError,
  }) {
    _engine.registerEventHandler(
      RtcEngineEventHandler(
        onJoinChannelSuccess: (connection, elapsed) {
          onJoinChannelSuccess?.call(connection.channelId ?? '');
        },
        onLeaveChannel: (connection, stats) {
          onLeaveChannel?.call(connection.channelId ?? '');
        },
        onUserJoined: (connection, remoteUid, elapsed) {
          onUserJoined?.call(connection.channelId ?? '', remoteUid);
        },
        onUserOffline: (connection, remoteUid, reason) {
          onUserOffline?.call(connection.channelId ?? '', remoteUid);
        },
        onAudioVolumeIndication: (connection, speakers, speakerNumber) {
          onAudioVolumeIndication?.call(speakers);
        },
        onError: (err, msg) {
          onError?.call(err);
        },
      ),
    );
  }

  // Dispose Agora engine
  Future<void> dispose() async {
    try {
      await _engine.release();
      _isInitialized = false;
      AppLogger.i('Agora engine disposed', tag: 'Agora');
    } catch (e) {
      AppLogger.e('Dispose error', tag: 'Agora', error: e);
      throw VoiceChatException('Failed to dispose Agora engine: ${e.toString()}');
    }
  }

  // Get mute status
  bool get isMuted => _isMuted;

  // Get initialization status
  bool get isInitialized => _isInitialized;
}