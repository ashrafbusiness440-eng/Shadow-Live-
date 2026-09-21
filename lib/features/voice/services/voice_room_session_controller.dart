import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';

import 'voice_service.dart';
import 'zego_voice_service.dart';

class VoiceRoomSessionController extends ChangeNotifier {
  VoiceRoomSessionController._();

  static final VoiceRoomSessionController instance =
      VoiceRoomSessionController._();

  final VoiceService _voiceService = ZegoVoiceService();

  StreamSubscription<VoiceConnectionState>? _connectionSubscription;
  StreamSubscription<VoiceMicState>? _micSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
      _roomLifecycleSubscription;

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
      }
    });
  }

  Future<void> _leaveClosedRoom() async {
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
      );
      _active = true;
      _joining = false;
      _micMuted = true;
      _connectionState = VoiceConnectionState.connected;
      _watchRoomLifecycle(targetRoomId);
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
    await _roomLifecycleSubscription?.cancel();
    _roomLifecycleSubscription = null;
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
    if (_serviceInitialized) {
      await _voiceService.dispose();
    }
    _serviceInitialized = false;
  }
}
