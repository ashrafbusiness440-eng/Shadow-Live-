import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:permission_handler/permission_handler.dart';

class AgoraService {
  static const String appId = 'YOUR_AGORA_APP_ID'; // Replace with your Agora App ID
  RtcEngine? _engine;
  bool _isInitialized = false;

  // Callbacks
  Function(int uid)? onUserJoined;
  Function(int uid, UserOfflineReasonType reason)? onUserOffline;
  Function(ConnectionStateType state, ConnectionChangedReasonType reason)? onConnectionStateChanged;
  Function(ErrorCodeType err, String msg)? onError;
  Function(String channelId, RtcStats stats)? onLeaveChannel;

  Future<void> initialize() async {
    if (_isInitialized) return;

    // Request microphone permission
    final status = await Permission.microphone.request();
    if (status != PermissionStatus.granted) {
      throw Exception('Microphone permission denied');
    }

    // Create RTC engine instance
    _engine = createAgoraRtcEngine();
    await _engine!.initialize(const RtcEngineContext(
      appId: appId,
      channelProfile: ChannelProfileType.channelProfileLiveBroadcasting,
    ));

    // Set up event handlers
    _engine!.registerEventHandler(RtcEngineEventHandler(
      onJoinChannelSuccess: (RtcConnection connection, int elapsed) {
        print('Successfully joined channel: ${connection.channelId}');
      },
      onUserJoined: (RtcConnection connection, int remoteUid, int elapsed) {
        onUserJoined?.call(remoteUid);
      },
      onUserOffline: (RtcConnection connection, int remoteUid, UserOfflineReasonType reason) {
        onUserOffline?.call(remoteUid, reason);
      },
      onConnectionStateChanged: (RtcConnection connection, ConnectionStateType state, ConnectionChangedReasonType reason) {
        onConnectionStateChanged?.call(state, reason);
      },
      onError: (ErrorCodeType err, String msg) {
        onError?.call(err, msg);
      },
      onLeaveChannel: (RtcConnection connection, RtcStats stats) {
        onLeaveChannel?.call(connection.channelId, stats);
      },
    ));

    _isInitialized = true;
  }

  Future<void> joinChannel(String channelName, int uid, {bool asHost = false}) async {
    if (!_isInitialized) await initialize();

    // Set client role
    await _engine!.setClientRole(
      role: asHost ? ClientRoleType.clientRoleBroadcaster : ClientRoleType.clientRoleAudience,
    );

    // Enable audio
    await _engine!.enableAudio();
    await _engine!.setAudioProfile(
      profile: AudioProfileType.audioProfileMusicHighQuality,
      scenario: AudioScenarioType.audioScenarioGameStreaming,
    );

    // Join the channel
    await _engine!.joinChannel(
      token: null, // Use token if security is enabled
      channelId: channelName,
      uid: uid,
      options: const ChannelMediaOptions(
        clientRoleType: ClientRoleType.clientRoleBroadcaster,
        channelProfile: ChannelProfileType.channelProfileLiveBroadcasting,
      ),
    );
  }

  Future<void> leaveChannel() async {
    if (!_isInitialized) return;

    await _engine!.leaveChannel();
  }

  Future<void> toggleMicrophone(bool enabled) async {
    if (!_isInitialized) return;

    await _engine!.enableLocalAudio(enabled);
  }

  Future<void> setAudioProfile(AudioProfileType profile, AudioScenarioType scenario) async {
    if (!_isInitialized) return;

    await _engine!.setAudioProfile(
      profile: profile,
      scenario: scenario,
    );
  }

  Future<void> adjustRecordingVolume(int volume) async {
    if (!_isInitialized) return;

    await _engine!.adjustRecordingSignalVolume(volume);
  }

  Future<void> muteRemoteAudio(int uid, bool muted) async {
    if (!_isInitialized) return;

    await _engine!.muteRemoteAudioStream(uid: uid, mute: muted);
  }

  Future<void> dispose() async {
    if (!_isInitialized) return;

    await _engine!.leaveChannel();
    await _engine!.release();
    _engine = null;
    _isInitialized = false;
  }
}