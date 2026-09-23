import 'dart:async';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import '../../room/services/room_presence_service.dart';
import 'voice_service.dart';
import 'zego_voice_service.dart';

class VoiceRoomSessionController extends ChangeNotifier {
  VoiceRoomSessionController._();

  static final VoiceRoomSessionController instance =
      VoiceRoomSessionController._();

  final VoiceService _voiceService = ZegoVoiceService();
  final RoomPresenceService _presenceService = RoomPresenceService();

  StreamSubscription<VoiceConnectionState>? _connectionSubscription;
  StreamSubscription<VoiceMicState>? _micSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
      _roomLifecycleSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
      _roomBanSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
      _roomMusicSubscription;
  Timer? _presenceTimer;
  final Map<String, Uint8List> _localRoomMusic = <String, Uint8List>{};
  Map<String, dynamic>? _lastRoomMusicState;
  String _activeRoomMediaKey = '';

  bool _serviceInitialized = false;
  bool _joining = false;
  bool _active = false;
  bool _minimized = false;
  bool _micMuted = true;
  String? _error;
  VoiceConnectionState _connectionState = VoiceConnectionState.idle;
  Map<String, dynamic> _roomArguments = <String, dynamic>{};

  bool get joining => _joining;
  bool get active => _active;
  bool get minimized => _minimized;
  bool get micMuted => _micMuted;
  String? get error => _error;
  VoiceConnectionState get connectionState => _connectionState;
  Map<String, dynamic> get roomArguments =>
      Map<String, dynamic>.unmodifiable(_roomArguments);

  String get roomId => (_roomArguments['roomId'] ?? '').toString();
  String get roomTitle =>
      (_roomArguments['name'] ??
              _roomArguments['title'] ??
              _roomArguments['roomName'] ??
              'غرفة صوتية')
          .toString();

  bool get isOwner {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) return false;
    final owner = (_roomArguments['ownerUid'] ??
            _roomArguments['ownerId'] ??
            _roomArguments['hostId'] ??
            '')
        .toString();
    return owner == uid;
  }

  Future<void> _ensureService() async {
    if (_serviceInitialized) return;
    _connectionSubscription =
        _voiceService.connectionStates.listen((state) {
      _connectionState = state;
      if (state == VoiceConnectionState.connected) {
        _active = true;
        _joining = false;
        _error = null;
      } else if (state == VoiceConnectionState.failed) {
        _joining = false;
      } else if (state == VoiceConnectionState.disconnected) {
        _active = false;
        _joining = false;
      }
      notifyListeners();
    });
    _micSubscription = _voiceService.micStates.listen((state) {
      _micMuted = state == VoiceMicState.muted;
      notifyListeners();
    });
    await _voiceService.initialize();
    _serviceInitialized = true;
  }

  void registerRoomMusicTrack(
    String trackId,
    Uint8List mediaData,
  ) {
    if (trackId.trim().isEmpty || mediaData.isEmpty) return;
    _localRoomMusic[trackId] = mediaData;
    final state = _lastRoomMusicState;
    if (state != null) unawaited(_applyRoomMusicState(state));
  }

  void unregisterRoomMusicTrack(String trackId) {
    _localRoomMusic.remove(trackId);
  }

  bool hasLocalRoomMusicTrack(String trackId) =>
      _localRoomMusic.containsKey(trackId);

  Future<void> _applyRoomMusicState(
    Map<String, dynamic> state,
  ) async {
    if (!_active) return;
    final status = (state['status'] ?? 'stopped').toString();
    final trackId = (state['currentTrackId'] ?? '').toString();
    final sourceOwnerUid =
        (state['sourceOwnerUid'] ?? '').toString();
    final revision = (state['commandRevision'] as num?)?.toInt() ?? 0;
    final me = FirebaseAuth.instance.currentUser?.uid ?? '';
    final shouldPlay =
        status == 'playing' && sourceOwnerUid == me && trackId.isNotEmpty;
    final key = trackId + ':' + revision.toString();

    if (shouldPlay) {
      final bytes = _localRoomMusic[trackId];
      if (bytes == null) {
        if (_activeRoomMediaKey.isNotEmpty) {
          _activeRoomMediaKey = '';
          await _voiceService.stopRoomMedia();
        }
        return;
      }
      if (_activeRoomMediaKey == key) return;
      _activeRoomMediaKey = key;
      try {
        await _voiceService.playRoomMedia(bytes);
      } catch (_) {
        _activeRoomMediaKey = '';
      }
      return;
    }

    if (_activeRoomMediaKey.isNotEmpty) {
      _activeRoomMediaKey = '';
      try {
        await _voiceService.stopRoomMedia();
      } catch (_) {}
    }
  }

  void _watchRoomMusic(String targetRoomId) {
    unawaited(_roomMusicSubscription?.cancel());
    _roomMusicSubscription = FirebaseFirestore.instance
        .collection('rooms')
        .doc(targetRoomId)
        .snapshots()
        .listen((snapshot) {
      if (!_active || roomId != targetRoomId) return;
      final data = snapshot.data();
      final raw = data?['musicState'];
      final state = raw is Map
          ? Map<String, dynamic>.from(raw)
          : <String, dynamic>{
              'status': 'stopped',
              'currentTrackId': '',
              'sourceOwnerUid': '',
              'commandRevision': 0,
            };
      _lastRoomMusicState = state;
      unawaited(_applyRoomMusicState(state));
    });
  }

  Future<void> _stopRoomMusicWatch() async {
    await _roomMusicSubscription?.cancel();
    _roomMusicSubscription = null;
    _lastRoomMusicState = null;
    _activeRoomMediaKey = '';
    try {
      await _voiceService.stopRoomMedia();
    } catch (_) {}
    _localRoomMusic.clear();
  }

  Future<void> _startPresence(String targetRoomId) async {
    _presenceTimer?.cancel();
    try {
      await _presenceService.join(targetRoomId);
    } catch (_) {}
    _presenceTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) {
        if (!_active || roomId != targetRoomId) return;
        unawaited(_presenceService.heartbeat(targetRoomId));
      },
    );
  }

  Future<void> _stopPresence([String? targetRoomId]) async {
    _presenceTimer?.cancel();
    _presenceTimer = null;
    final id = (targetRoomId ?? roomId).trim();
    if (id.isEmpty) return;
    try {
      await _presenceService.leave(id);
    } catch (_) {}
  }

  void _watchRoomBan(String targetRoomId) {
    unawaited(_roomBanSubscription?.cancel());
    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (uid.isEmpty) return;

    _roomBanSubscription = FirebaseFirestore.instance
        .collection('room_bans')
        .doc(targetRoomId)
        .collection('users')
        .doc(uid)
        .snapshots()
        .listen((snapshot) {
      if (!snapshot.exists || !_active || roomId != targetRoomId) return;
      final data = snapshot.data() ?? <String, dynamic>{};
      final permanent = data['permanent'] == true;
      final expires = data['expiresAt'];
      final expiresAt =
          expires is Timestamp ? expires.millisecondsSinceEpoch : 0;
      if (permanent || expiresAt > DateTime.now().millisecondsSinceEpoch) {
        unawaited(_leaveBannedRoom());
      }
    });
  }

  Future<void> _leaveBannedRoom() async {
    final activeRoomId = roomId;
    await _stopPresence(activeRoomId);
    await _stopRoomMusicWatch();
    if (_serviceInitialized) {
      try {
        await _voiceService.leaveRoom();
      } catch (_) {}
    }
    _active = false;
    _joining = false;
    _minimized = false;
    _micMuted = true;
    _error = 'room_banned';
    _connectionState = VoiceConnectionState.disconnected;
    notifyListeners();
  }

  void _watchRoomLifecycle(String targetRoomId) {
    unawaited(_roomLifecycleSubscription?.cancel());
    _roomLifecycleSubscription = FirebaseFirestore.instance
        .collection('rooms')
        .doc(targetRoomId)
        .snapshots()
        .listen((snapshot) {
      final data = snapshot.data();
      final unavailable = !snapshot.exists || data?['isActive'] == false;
      if (unavailable && _active && roomId == targetRoomId) {
        unawaited(_leaveClosedRoom());
        return;
      }

      if (data != null && _active && roomId == targetRoomId) {
        _roomArguments = <String, dynamic>{
          ..._roomArguments,
          'activeRoomBackgroundRewardId':
              data['activeRoomBackgroundRewardId'] ?? '',
          'activeRoomBackgroundImageUrl':
              data['activeRoomBackgroundImageUrl'] ?? '',
          'activeRoomBackgroundAssetKey':
              data['activeRoomBackgroundAssetKey'] ?? '',
          'activeRoomBackgroundExpiresAtMs':
              data['activeRoomBackgroundExpiresAtMs'] ?? 0,
          'recentEntrance': data['recentEntrance'],
        };
        final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
        final ownerUid =
            (data['ownerUid'] ?? data['ownerId'] ?? data['hostId'] ?? '')
                .toString();
        final rawSeats = data['seats'];
        final hasSeat = rawSeats is List &&
            rawSeats.whereType<Map>().any(
                  (seat) => (seat['uid'] ?? '').toString() == uid,
                );
        final isOwner = uid.isNotEmpty && ownerUid == uid;
        if (!isOwner && !hasSeat && !_micMuted) {
          unawaited(setMicMuted(true));
        }
        notifyListeners();
      }
    });
  }

  Future<void> _leaveClosedRoom() async {
    final activeRoomId = roomId;
    await _stopPresence(activeRoomId);
    await _stopRoomMusicWatch();
    if (_serviceInitialized) {
      try {
        await _voiceService.leaveRoom();
      } catch (_) {}
    }
    _active = false;
    _joining = false;
    _minimized = false;
    _micMuted = true;
    _error = 'room_closed';
    _connectionState = VoiceConnectionState.disconnected;
    notifyListeners();
  }

  Future<void> join(Map<String, dynamic> arguments) async {
    final user = FirebaseAuth.instance.currentUser;
    final targetRoomId = (arguments['roomId'] ?? '').toString().trim();
    if (user == null) throw StateError('not_signed_in');
    if (targetRoomId.isEmpty) throw StateError('room_id_missing');

    if (_active && roomId == targetRoomId) {
      _roomArguments = <String, dynamic>{..._roomArguments, ...arguments};
      _minimized = false;
      _error = null;
      notifyListeners();
      return;
    }

    if (_active && roomId != targetRoomId) {
      await leave();
    }

    await _ensureService();
    _roomArguments = Map<String, dynamic>.from(arguments);
    _joining = true;
    _minimized = false;
    _error = null;
    notifyListeners();

    final displayName = (user.displayName ??
            arguments['displayName'] ??
            arguments['hostName'] ??
            'Shadow Live')
        .toString()
        .trim();

    try {
      await _voiceService.joinRoom(
        roomId: targetRoomId,
        userId: user.uid,
        displayName: displayName.isEmpty ? 'Shadow Live' : displayName,
        accessCode: (arguments['roomPassword'] ?? '').toString(),
      );
      _active = true;
      _joining = false;
      _micMuted = true;
      _connectionState = VoiceConnectionState.connected;
      _watchRoomLifecycle(targetRoomId);
      _watchRoomBan(targetRoomId);
      _watchRoomMusic(targetRoomId);
      unawaited(_startPresence(targetRoomId));
    } catch (error) {
      _active = false;
      _joining = false;
      _error = error.toString();
      _connectionState = VoiceConnectionState.failed;
      rethrow;
    } finally {
      notifyListeners();
    }
  }

  Future<void> toggleMic() async {
    if (!_active || _connectionState != VoiceConnectionState.connected) {
      return;
    }
    if (_micMuted) {
      await _voiceService.unmuteMic();
    } else {
      await _voiceService.muteMic();
    }
  }

  Future<void> setRoomAudioEnabled(bool enabled) async {
    if (!_active || _connectionState != VoiceConnectionState.connected) {
      return;
    }
    await _voiceService.setPlaybackEnabled(enabled);
  }

  Future<void> setMicMuted(bool muted) async {
    if (!_active || _connectionState != VoiceConnectionState.connected) {
      return;
    }
    if (muted) {
      await _voiceService.muteMic();
    } else {
      await _voiceService.unmuteMic();
    }
  }

  void minimize() {
    if (!_active) return;
    _minimized = true;
    notifyListeners();
  }

  void restore() {
    if (!_active) return;
    _minimized = false;
    notifyListeners();
  }

  Future<void> leave() async {
    final activeRoomId = roomId;
    await _stopPresence(activeRoomId);
    await _stopRoomMusicWatch();
    await _roomLifecycleSubscription?.cancel();
    _roomLifecycleSubscription = null;
    await _roomBanSubscription?.cancel();
    _roomBanSubscription = null;
    if (_serviceInitialized) {
      try {
        await _voiceService.leaveRoom();
      } catch (_) {}
    }
    _active = false;
    _joining = false;
    _minimized = false;
    _micMuted = true;
    _error = null;
    _connectionState = VoiceConnectionState.disconnected;
    _roomArguments = <String, dynamic>{};
    notifyListeners();
  }

  Future<void> shutdown() async {
    await leave();
    await _connectionSubscription?.cancel();
    await _micSubscription?.cancel();
    await _roomLifecycleSubscription?.cancel();
    await _roomBanSubscription?.cancel();
    await _roomMusicSubscription?.cancel();
    if (_serviceInitialized) {
      await _voiceService.dispose();
    }
    _presenceService.close();
    _serviceInitialized = false;
  }
}
