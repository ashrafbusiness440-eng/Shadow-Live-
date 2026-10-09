import 'dart:async';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../../core/assets/shadow_asset_registry.dart';
import '../../room/services/room_presence_service.dart';
import '../../room/services/room_seat_service.dart';
import '../../room/services/star_battle_score_overlay.dart';
import 'voice_service.dart';
import 'zego_voice_service.dart';

class VoiceRoomSessionController extends ChangeNotifier {
  VoiceRoomSessionController._() {
    _observedAuthUid = FirebaseAuth.instance.currentUser?.uid;
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen((user) {
      final nextUid = user?.uid;
      final changed = _observedAuthUid != nextUid;
      _observedAuthUid = nextUid;
      if (changed) {
        _mysteriousModeEnabled = false;
        if (_active || _joining) unawaited(leave());
      }
    });
    _realtimeSubscription =
        _presenceService.events.listen(_handleRealtimeEvent);
  }

  static final VoiceRoomSessionController instance =
      VoiceRoomSessionController._();

  final VoiceService _voiceService = ZegoVoiceService();
  final RoomPresenceService _presenceService = RoomPresenceService();
  final RoomSeatService _seatService = RoomSeatService();
  final StarBattleScoreOverlay _starBattleScores = StarBattleScoreOverlay();
  Map<String, dynamic> _lastRawRoomState = <String, dynamic>{};
  final http.Client _effectSoundHttp = http.Client();

  StreamSubscription<User?>? _authSubscription;
  StreamSubscription<VoiceConnectionState>? _connectionSubscription;
  StreamSubscription<VoiceMicState>? _micSubscription;
  StreamSubscription<RoomRealtimeEvent>? _realtimeSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
      _roomLifecycleSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>?
      _roomBanSubscription;
  final Map<String, Uint8List> _localRoomMusic = <String, Uint8List>{};
  final Map<String, Uint8List> _effectSoundCache =
      <String, Uint8List>{};
  static const int _maxEffectSoundCacheEntries = 8;
  static const int _maxEffectSoundBytes = 4 * 1024 * 1024;
  final StreamController<Map<String, dynamic>> _roomStateController =
      StreamController<Map<String, dynamic>>.broadcast();
  static const int _maxRoomParticipants = 200;
  final List<Map<String, dynamic>> _roomChatMessages =
      <Map<String, dynamic>>[];
  final List<RoomPresenceUser> _roomParticipants = <RoomPresenceUser>[];
  Map<String, dynamic>? _roomChatReplyTarget;
  Map<String, dynamic>? _roomChatMentionTarget;
  int _roomChatComposerIntentRevision = 0;
  Map<String, dynamic>? _lastRoomMusicState;
  String _activeRoomMediaKey = '';

  bool _serviceInitialized = false;
  Future<void>? _leaveInFlight;
  bool _joining = false;
  bool _active = false;
  bool _minimized = false;
  bool _micMuted = true;
  bool _mysteriousModeEnabled = false;
  String _mysteriousVoiceId = 'original';
  String? _error;
  VoiceConnectionState _connectionState = VoiceConnectionState.idle;
  Map<String, dynamic> _roomArguments = <String, dynamic>{};
  String? _sessionUserUid;
  String? _observedAuthUid;

  bool get joining => _joining;
  bool get active => _active;
  bool get minimized => _minimized;
  bool get micMuted => _micMuted;
  bool get mysteriousModeEnabled => _mysteriousModeEnabled;
  String get mysteriousVoiceId => _mysteriousVoiceId;
  String? get error => _error;
  VoiceConnectionState get connectionState => _connectionState;
  Map<String, dynamic> get roomArguments =>
      Map<String, dynamic>.unmodifiable(_roomArguments);

  Stream<RoomRealtimeEvent> get realtimeEvents => _presenceService.events;
  Stream<Map<String, dynamic>> get roomStateEvents =>
      _roomStateController.stream;
  List<Map<String, dynamic>> get roomChatMessages =>
      List<Map<String, dynamic>>.unmodifiable(
        _roomChatMessages.reversed,
      );
  List<RoomPresenceUser> get roomParticipants =>
      List<RoomPresenceUser>.unmodifiable(_roomParticipants);
  Map<String, dynamic>? get roomChatReplyTarget =>
      _roomChatReplyTarget == null
          ? null
          : Map<String, dynamic>.unmodifiable(_roomChatReplyTarget!);
  Map<String, dynamic>? get roomChatMentionTarget =>
      _roomChatMentionTarget == null
          ? null
          : Map<String, dynamic>.unmodifiable(_roomChatMentionTarget!);
  int get roomChatComposerIntentRevision => _roomChatComposerIntentRevision;

  String get roomId => (_roomArguments['roomId'] ?? '').toString();
  void setMysteriousModeEnabled(bool enabled) {
    if (_mysteriousModeEnabled == enabled) return;
    _mysteriousModeEnabled = enabled;
    notifyListeners();
  }

  VoiceChangerPreset _mysteriousPreset(String voiceId) => switch (voiceId) {
        'men_to_child' => VoiceChangerPreset.menToChild,
        'men_to_women' => VoiceChangerPreset.menToWomen,
        'women_to_child' => VoiceChangerPreset.womenToChild,
        'women_to_men' => VoiceChangerPreset.womenToMen,
        'foreigner' => VoiceChangerPreset.foreigner,
        'android' => VoiceChangerPreset.android,
        'ethereal' => VoiceChangerPreset.ethereal,
        'minions' => VoiceChangerPreset.minions,
        _ => VoiceChangerPreset.original,
      };

  Future<void> refreshMysteriousRoomIdentity() async {
    final id = roomId.trim();
    if (!_active || id.isEmpty) return;
    await Future.wait<void>([
      _presenceService.refreshIdentity(id).catchError((_) {}),
      _seatService.syncMysteriousIdentity(id).catchError((_) {}),
    ]);
  }

  Future<void> applyMysteriousVoice({
    required bool enabled,
    required String voiceId,
  }) async {
    final modeChanged = _mysteriousModeEnabled != enabled;
    _mysteriousModeEnabled = enabled;
    _mysteriousVoiceId = voiceId.trim().isEmpty ? 'original' : voiceId.trim();
    await _voiceService.setVoiceChanger(
      enabled
          ? _mysteriousPreset(_mysteriousVoiceId)
          : VoiceChangerPreset.original,
    );
    if (modeChanged) {
      await refreshMysteriousRoomIdentity();
    }
    notifyListeners();
  }

  String get roomTitle =>
      (_roomArguments['name'] ??
              _roomArguments['title'] ??
              _roomArguments['roomName'] ??
              'غرفة صوتية')
          .toString();

  int get starBattleScoreRevision => _starBattleScores.revision;

  void applyBootstrapRoom(
    Map<String, dynamic> room, {
    int? starBattleStartedAtRevision,
  }) {
    final targetRoomId = (room['roomId'] ?? '').toString().trim();
    if (targetRoomId.isEmpty || targetRoomId != roomId) return;
    _roomArguments = <String, dynamic>{
      ..._roomArguments,
      ...room,
    };
    final battle = room['starBattleState'];
    if (starBattleStartedAtRevision != null && battle is Map &&
        _starBattleScores.installBootstrap(
          Map<String, dynamic>.from(battle),
          startedAtRevision: starBattleStartedAtRevision,
        ) && _lastRawRoomState.isNotEmpty) {
      _roomStateController.add(_starBattleScores.merge(_lastRawRoomState));
    }
    notifyListeners();
  }

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
      // A kick or terminal voice failure must use the same cleanup path as
      // normal leave, otherwise room presence and the seat can remain stale.
      final unexpectedLoss = _active &&
          _leaveInFlight == null &&
          (state == VoiceConnectionState.disconnected ||
              state == VoiceConnectionState.failed);
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
      if (unexpectedLoss) unawaited(leave());
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

  Future<void> _stopRoomMusicWatch() async {
    _lastRoomMusicState = null;
    _activeRoomMediaKey = '';
    try {
      await _voiceService.stopRoomMedia();
    } catch (_) {}
    _localRoomMusic.clear();
  }

  Future<Uint8List?> _loadEffectSound(String assetKey) async {
    final key = assetKey.trim();
    if (key.isEmpty) return null;
    final cached = _effectSoundCache.remove(key);
    if (cached != null) {
      _effectSoundCache[key] = cached;
      return cached;
    }

    final uri = await ShadowAssetRegistry.remoteUrl(key);
    if (uri == null) return null;
    try {
      final response = await _effectSoundHttp
          .get(uri)
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return null;
      final bytes = response.bodyBytes;
      if (bytes.isEmpty || bytes.length > _maxEffectSoundBytes) {
        return null;
      }
      while (_effectSoundCache.length >= _maxEffectSoundCacheEntries) {
        _effectSoundCache.remove(_effectSoundCache.keys.first);
      }
      _effectSoundCache[key] = bytes;
      return bytes;
    } catch (_) {
      return null;
    }
  }

  Future<void> playRoomEffectSound(String assetKey) async {
    if (!_active ||
        _connectionState != VoiceConnectionState.connected) {
      return;
    }
    final bytes = await _loadEffectSound(assetKey);
    if (bytes == null || !_active) return;
    try {
      await _voiceService.playLocalEffect(bytes);
    } catch (_) {}
  }

  Future<void> stopRoomEffectSounds() async {
    try {
      await _voiceService.stopLocalEffect();
    } catch (_) {}
  }

  void _sortRoomParticipants() {
    _roomParticipants.sort((a, b) {
      final priority =
          (b.vipOnlinePriority ? 1 : 0) - (a.vipOnlinePriority ? 1 : 0);
      if (priority != 0) return priority;
      final joined = a.joinedAtMs.compareTo(b.joinedAtMs);
      if (joined != 0) return joined;
      return a.uid.compareTo(b.uid);
    });
    if (_roomParticipants.length > _maxRoomParticipants) {
      _roomParticipants.removeRange(
        _maxRoomParticipants,
        _roomParticipants.length,
      );
    }
  }

  bool _replaceRoomParticipants(dynamic raw) {
    if (raw is! List) return false;
    final next = raw
        .whereType<Map>()
        .map(
          (item) => RoomPresenceUser.fromMap(
            Map<String, dynamic>.from(item),
          ),
        )
        .where((item) => item.uid.isNotEmpty)
        .take(_maxRoomParticipants)
        .toList(growable: false);
    _roomParticipants
      ..clear()
      ..addAll(next);
    _sortRoomParticipants();
    return true;
  }

  bool _upsertRoomParticipant(Map<String, dynamic> raw) {
    final participant = RoomPresenceUser.fromMap(raw);
    if (participant.uid.isEmpty) return false;
    _roomParticipants.removeWhere((item) => item.uid == participant.uid);
    _roomParticipants.add(participant);
    _sortRoomParticipants();
    return true;
  }

  bool _removeRoomParticipant(String uid) {
    final target = uid.trim();
    if (target.isEmpty) return false;
    final before = _roomParticipants.length;
    _roomParticipants.removeWhere((item) => item.uid == target);
    return before != _roomParticipants.length;
  }

  void _appendRoomChat(Map<String, dynamic> message) {
    final id = (message['id'] ?? '').toString().trim();
    if (id.isNotEmpty &&
        _roomChatMessages.any(
          (item) => (item['id'] ?? '').toString() == id,
        )) {
      return;
    }
    _roomChatMessages.add(Map<String, dynamic>.from(message));
    if (_roomChatMessages.length > 60) {
      _roomChatMessages.removeRange(0, _roomChatMessages.length - 60);
    }
  }

  void prepareRoomChatReply(Map<String, dynamic> message) {
    final id = (message['id'] ?? '').toString().trim();
    final senderUid = (message['senderUid'] ?? '').toString().trim();
    if (id.isEmpty || senderUid.isEmpty) return;
    _roomChatReplyTarget = Map<String, dynamic>.from(message);
    _roomChatMentionTarget = null;
    _roomChatComposerIntentRevision += 1;
    notifyListeners();
  }

  void prepareRoomChatMention(Map<String, dynamic> message) {
    final senderUid = (message['senderUid'] ?? '').toString().trim();
    if (senderUid.isEmpty) return;
    _roomChatMentionTarget = Map<String, dynamic>.from(message);
    _roomChatReplyTarget = null;
    _roomChatComposerIntentRevision += 1;
    notifyListeners();
  }

  void clearRoomChatComposerIntent() {
    if (_roomChatReplyTarget == null && _roomChatMentionTarget == null) return;
    _roomChatReplyTarget = null;
    _roomChatMentionTarget = null;
    _roomChatComposerIntentRevision += 1;
    notifyListeners();
  }

  Future<void> reportRoomChatMessage({
    required String messageId,
    required String reason,
  }) {
    if (!_active || roomId.isEmpty) {
      throw StateError('room_realtime_not_connected');
    }
    return _presenceService.reportChatMessage(
      roomId: roomId,
      messageId: messageId,
      reason: reason,
    );
  }

  Future<void> sendRoomChat({
    required String text,
    String? replyTo,
    String? replyPreview,
    String? replySenderUid,
    List<String> mentionUids = const [],
    String? animatedEmojiId,
  }) async {
    if (!_active || roomId.isEmpty) {
      throw StateError('room_realtime_not_connected');
    }
    // A room can be visible while its separate presence socket failed.
    // On an explicit send only, recover the EXISTING socket before chatting.
    // Never send or acknowledge a message until the server confirms admission.
    if (!_presenceService.isReadyFor(roomId)) {
      final ready = await _presenceService.ensureReady(roomId);
      if (!ready) {
        throw StateError(_presenceService.lastConnectionError.isEmpty
            ? 'room_realtime_not_connected'
            : _presenceService.lastConnectionError);
      }
    }
    return _presenceService.sendChat(
      roomId: roomId,
      text: text,
      replyTo: replyTo,
      replyPreview: replyPreview,
      replySenderUid: replySenderUid,
      mentionUids: mentionUids,
      animatedEmojiId: animatedEmojiId,
    );
  }

  void _handleRealtimeEvent(RoomRealtimeEvent event) {
    if (!_active && !_joining) return;
    final eventRoomId = (event.payload['roomId'] ?? '').toString();
    if (eventRoomId.isNotEmpty && eventRoomId != roomId) return;

    var changed = false;
    if (event.type == 'server.ready') {
      changed = _replaceRoomParticipants(event.payload['participants']) ||
          changed;
      _roomArguments = <String, dynamic>{
        ..._roomArguments,
        'presenceDegraded': false,
      };
      changed = true;
    } else if (event.type == 'room.connection_lost') {
      // Do not keep displaying stale off-mic listeners after a socket loss.
      // Occupied seat snapshots remain available from the existing room doc.
      _roomParticipants.clear();
      _roomArguments = <String, dynamic>{
        ..._roomArguments,
        'presenceDegraded': true,
      };
      changed = true;
    } else if (event.type == 'room.presence_updated') {
      final rawParticipant = event.payload['participant'];
      if (rawParticipant is Map) {
        changed = _upsertRoomParticipant(
              Map<String, dynamic>.from(rawParticipant),
            ) ||
            changed;
      }
    } else if (event.type == 'room.presence_left') {
      changed = _removeRoomParticipant(
            (event.payload['uid'] ?? '').toString(),
          ) ||
          changed;
    }

    final onlineRaw = event.payload['onlineCount'];
    if (onlineRaw is num) {
      final onlineCount = onlineRaw.toInt().clamp(0, 1000000000);
      if (_roomArguments['onlineCount'] != onlineCount ||
          _roomArguments['participantsCount'] != onlineCount) {
        _roomArguments = <String, dynamic>{
          ..._roomArguments,
          'onlineCount': onlineCount,
          'participantsCount': onlineCount,
        };
        changed = true;
      }
    }

    if (event.type == 'room.entrance') {
      final rawEntrance = event.payload['event'];
      if (rawEntrance is Map) {
        _roomArguments = <String, dynamic>{
          ..._roomArguments,
          'recentEntrance': Map<String, dynamic>.from(rawEntrance),
        };
        changed = true;
      }
    }

    if (event.type == 'room.chat_message') {
      final rawMessage = event.payload['message'];
      if (rawMessage is Map) {
        _appendRoomChat(Map<String, dynamic>.from(rawMessage));
        changed = true;
        final rawAward = rawMessage['starBattleAward'];
        if (rawAward is Map &&
            _starBattleScores.apply(Map<String, dynamic>.from(rawAward)) &&
            _lastRawRoomState.isNotEmpty) {
          // The room already listens to roomStateEvents. Reuse it instead of
          // opening a new socket or Firestore subscription for score updates.
          _roomStateController.add(_starBattleScores.merge(_lastRawRoomState));
        }
      }
    } else if (event.type == 'room.presence_joined') {
      final uid = (event.payload['uid'] ?? '').toString().trim();
      final displayName =
          (event.payload['displayName'] ?? 'مستخدم Shadow Live')
              .toString()
              .trim();
      if (uid.isNotEmpty) {
        changed = _upsertRoomParticipant(event.payload) || changed;
        final vipLevel =
            (event.payload['vipLevel'] as num?)?.toInt() ?? 0;
        _appendRoomChat({
          'id': 'join_' +
              uid +
              '_' +
              (event.payload['joinedAtMs'] ?? event.serverTimeMs).toString(),
          'type': 'system',
          'systemKind': 'room_join',
          'senderUid': uid,
          'joinedAtMs': (event.payload['joinedAtMs'] as num?)?.toInt() ??
              event.serverTimeMs,
          'mysteriousMode': event.payload['mysteriousMode'] == true,
          'displayName': displayName,
          'profileImageUrl':
              (event.payload['profileImageUrl'] ?? '').toString(),
          'activeProfileFrameAssetKey':
              (event.payload['activeProfileFrameAssetKey'] ?? '').toString(),
          'activeProfileFrameImageUrl':
              (event.payload['activeProfileFrameImageUrl'] ?? '').toString(),
          'activeProfileFrameExpiresAtMs':
              (event.payload['activeProfileFrameExpiresAtMs'] as num?)
                      ?.toInt() ??
                  0,
          'activeProfileFramePermanent':
              event.payload['activeProfileFramePermanent'] == true,
          'text': vipLevel > 0
              ? displayName + ' دخل الغرفة — VIP ' + vipLevel.toString()
              : displayName + ' دخل الغرفة',
          'vipLevel': vipLevel,
          'entryEffectKey':
              (event.payload['entryEffectKey'] ?? '').toString(),
          'createdAtMs': event.serverTimeMs,
        });
        changed = true;
      }
    }

    if (changed) notifyListeners();
  }

  Future<void> _announceEntrance(String targetRoomId) async {
    try {
      await _seatService.announceEntrance(targetRoomId);
    } catch (_) {
      // Entrance cosmetics must never block joining the room.
    }
  }

  Future<bool> ensureRoomPresenceReady() async {
    final id = roomId.trim();
    if (!_active || id.isEmpty) return false;
    if (_presenceService.isReadyFor(id)) return true;
    final ready = await _presenceService.ensureReady(id);
    if (_roomArguments['presenceDegraded'] == ready) {
      _roomArguments = <String, dynamic>{
        ..._roomArguments,
        'presenceDegraded': !ready,
      };
      notifyListeners();
    }
    return ready;
  }

  Future<void> _startPresence(String targetRoomId) async {
    try {
      await _presenceService.join(targetRoomId);
      _roomArguments = <String, dynamic>{
        ..._roomArguments,
        'presenceDegraded': false,
      };
      if (_active && roomId == targetRoomId) {
        await _announceEntrance(targetRoomId);
      }
      notifyListeners();
    } catch (_) {
      // Voice stays connected, but room mutations must know presence is degraded.
      _roomArguments = <String, dynamic>{
        ..._roomArguments,
        'presenceDegraded': true,
      };
      notifyListeners();
      // The presence service keeps its bounded reconnect sequence.
    }
  }

  Future<void> _stopPresence([String? targetRoomId]) async {
    final id = (targetRoomId ?? roomId).trim();
    if (id.isEmpty) return;
    try {
      await _presenceService.leave(id);
    } catch (_) {
      // Realtime presence is removed by WebSocket close even if session
      // cleanup cannot reach the API.
    }
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
    final departingRoomId = roomId;
    if (departingRoomId.isEmpty) return;
    await leave();
    if (_active && roomId != departingRoomId) return;
    _error = 'room_banned';
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
        _lastRawRoomState = <String, dynamic>{
          ...data,
          'roomId': targetRoomId,
        };
        _roomStateController.add(_starBattleScores.merge(_lastRawRoomState));
        final rawMusicState = data['musicState'];
        final musicState = rawMusicState is Map
            ? Map<String, dynamic>.from(rawMusicState)
            : <String, dynamic>{
                'status': 'stopped',
                'currentTrackId': '',
                'sourceOwnerUid': '',
                'commandRevision': 0,
              };
        _lastRoomMusicState = musicState;
        unawaited(_applyRoomMusicState(musicState));

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
        };
        final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
        final ownerUid =
            (data['ownerUid'] ?? data['ownerId'] ?? data['hostId'] ?? '')
                .toString();
        final rawSeats = data['seats'];
        final mySeat = rawSeats is List
            ? rawSeats.whereType<Map>().where(
                  (seat) => (seat['uid'] ?? '').toString() == uid,
                ).firstOrNull
            : null;
        final hasSeat = mySeat != null;
        final isOwner = uid.isNotEmpty && ownerUid == uid;
        // A moderator's server-side mute must silence the live ZEGO mic,
        // including when this room is minimized. Reuse this same room
        // snapshot; do not open an extra seat listener or poll for mutes.
        final serverMuted = mySeat?['muted'] != false;
        if (!_micMuted &&
            ((!isOwner && !hasSeat) || (hasSeat && serverMuted))) {
          unawaited(setMicMuted(true));
        }
        notifyListeners();
      }
    });
  }

  Future<void> _leaveClosedRoom() async {
    final departingRoomId = roomId;
    if (departingRoomId.isEmpty) return;
    await leave();
    if (_active && roomId != departingRoomId) return;
    _error = 'room_closed';
    notifyListeners();
  }

  String _displayNameForJoin(
    User user,
    Map<String, dynamic> arguments,
  ) {
    final supplied = (arguments['displayName'] ?? '').toString().trim();
    if (supplied.isNotEmpty) return supplied;

    final authName = (user.displayName ?? '').trim();
    if (authName.isNotEmpty) return authName;

    final email = (user.email ?? '').trim();
    if (email.contains('@')) return email.split('@').first;

    return user.isAnonymous ? 'ضيف' : 'مستخدم Shadow Live';
  }

  Future<void> join(Map<String, dynamic> arguments) async {
    final user = FirebaseAuth.instance.currentUser;
    final targetRoomId = (arguments['roomId'] ?? '').toString().trim();
    if (user == null) throw StateError('not_signed_in');
    if (targetRoomId.isEmpty) throw StateError('room_id_missing');

    final currentUid = user.uid;
    if ((_active || _joining) &&
        _sessionUserUid != null &&
        _sessionUserUid != currentUid) {
      await leave();
    }

    final displayName = _displayNameForJoin(user, arguments);

    if (_active && roomId == targetRoomId && _sessionUserUid == currentUid) {
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
    _starBattleScores.clear();
    _lastRawRoomState = <String, dynamic>{};
    _roomChatMessages.clear();
    _roomParticipants.clear();
    _roomChatReplyTarget = null;
    _roomChatMentionTarget = null;
    _roomArguments = Map<String, dynamic>.from(arguments)
      ..remove('recentEntrance');
    _joining = true;
    _minimized = false;
    _error = null;
    notifyListeners();

    try {
      await _voiceService.joinRoom(
        roomId: targetRoomId,
        userId: user.uid,
        displayName: displayName.isEmpty ? 'Shadow Live' : displayName,
        accessCode: (arguments['roomPassword'] ?? '').toString(),
      );
      _active = true;
      _joining = false;
      _sessionUserUid = currentUid;
      _micMuted = true;
      _connectionState = VoiceConnectionState.connected;
      _watchRoomLifecycle(targetRoomId);
      _watchRoomBan(targetRoomId);
      unawaited(_startPresence(targetRoomId));
    } catch (error) {
      _active = false;
      _joining = false;
      _sessionUserUid = null;
      _roomChatMessages.clear();
      _roomChatReplyTarget = null;
      _roomChatMentionTarget = null;
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

  Future<void> leave() {
    final pending = _leaveInFlight;
    if (pending != null) return pending;
    late final Future<void> operation;
    operation = _leaveRoomSession().whenComplete(() {
      if (identical(_leaveInFlight, operation)) _leaveInFlight = null;
    });
    _leaveInFlight = operation;
    return operation;
  }

  Future<void> _leaveRoomSession() async {
    final activeRoomId = roomId;
    await _stopPresence(activeRoomId);
    await _stopRoomMusicWatch();
    await stopRoomEffectSounds();
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
    _starBattleScores.clear();
    _lastRawRoomState = <String, dynamic>{};
    _roomChatMessages.clear();
    _roomParticipants.clear();
    _roomChatReplyTarget = null;
    _roomChatMentionTarget = null;
    _sessionUserUid = null;
    notifyListeners();
  }

  Future<void> shutdown() async {
    await leave();
    await _authSubscription?.cancel();
    _authSubscription = null;
    await _connectionSubscription?.cancel();
    await _micSubscription?.cancel();
    await _realtimeSubscription?.cancel();
    _realtimeSubscription = null;
    await _roomLifecycleSubscription?.cancel();
    await _roomBanSubscription?.cancel();
    if (_serviceInitialized) {
      await _voiceService.dispose();
    }
    _presenceService.close();
    _seatService.close();
    _effectSoundHttp.close();
    _effectSoundCache.clear();
    _serviceInitialized = false;
  }
}
