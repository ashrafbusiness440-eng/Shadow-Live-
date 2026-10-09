import 'dart:async';
import 'dart:collection';

import 'package:flutter/material.dart';

import 'cosmetic_effect_widgets.dart';

class RoomVisualEffect {
  const RoomVisualEffect({
    required this.eventId,
    required this.kind,
    required this.mode,
    required this.assetKey,
    required this.imageUrl,
    required this.durationMs,
    required this.recipientUids,
    this.size = 0,
    this.displayName = '',
    this.profileImageUrl = '',
    this.badgeLabel = '',
    this.levelLabel = '',
  });

  final String eventId;
  final String kind;
  final String mode;
  final String assetKey;
  final String imageUrl;
  final int durationMs;
  final List<String> recipientUids;
  final int size;
  final String displayName;
  final String profileImageUrl;
  final String badgeLabel;
  final String levelLabel;
}

class RoomEffectCoordinator extends ChangeNotifier {
  RoomEffectCoordinator({
    Future<void> Function(String assetKey)? playEffectSound,
    Future<void> Function()? stopEffectSounds,
  })  : _playEffectSound = playEffectSound,
        _stopEffectSounds = stopEffectSounds;

  static const int maxCinematicQueue = 8;
  static const int maxParallelSeatEffects = 8;
  static const int maxSeenEvents = 96;

  final Queue<RoomVisualEffect> _cinematicQueue =
      Queue<RoomVisualEffect>();
  final LinkedHashMap<String, RoomVisualEffect> _seatEffects =
      LinkedHashMap<String, RoomVisualEffect>();
  final Map<String, int> _seatExpiresAtMs = <String, int>{};
  final LinkedHashSet<String> _seenEventIds = LinkedHashSet<String>();

  RoomVisualEffect? _currentCinematic;
  RoomVisualEffect? _currentRoomJoin;
  Timer? _roomJoinTimer;
  Timer? _cinematicTimer;
  Timer? _seatCleanupTimer;
  bool _visualEnabled = true;
  bool _effectSoundEnabled = true;
  final Future<void> Function(String assetKey)? _playEffectSound;
  final Future<void> Function()? _stopEffectSounds;

  RoomVisualEffect? get currentCinematic => _currentCinematic;
  RoomVisualEffect? get currentRoomJoin => _currentRoomJoin;
  bool get visualEnabled => _visualEnabled;
  bool get effectSoundEnabled => _effectSoundEnabled;

  RoomVisualEffect? seatEffectFor(String uid) =>
      _visualEnabled ? _seatEffects[uid.trim()] : null;

  void setPreferences({
    required bool visualEnabled,
    required bool effectSoundEnabled,
  }) {
    final visualChanged = _visualEnabled != visualEnabled;
    final soundChanged = _effectSoundEnabled != effectSoundEnabled;
    _visualEnabled = visualEnabled;
    _effectSoundEnabled = effectSoundEnabled;
    if (visualChanged && !visualEnabled) {
      _clearVisualState();
    }
    if (soundChanged && !effectSoundEnabled) {
      final stop = _stopEffectSounds;
      if (stop != null) unawaited(stop());
    }
  }

  bool _markSeen(String eventId) {
    final id = eventId.trim();
    if (id.isEmpty || _seenEventIds.contains(id)) return false;
    _seenEventIds.add(id);
    while (_seenEventIds.length > maxSeenEvents) {
      _seenEventIds.remove(_seenEventIds.first);
    }
    return true;
  }

  void ingestRoomJoin(Map<String, dynamic>? raw) {
    if (raw == null) return;
    final id = (raw['id'] ?? '').toString().trim();
    if (id.isEmpty || !_markSeen('join:$id')) return;
    if (!_visualEnabled) return;

    final joinedAtMs = (raw['joinedAtMs'] as num?)?.toInt() ?? 0;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    // Session events are ephemeral: don't replay old joins on rebuild.
    if (joinedAtMs > 0 &&
        (nowMs - joinedAtMs).abs() > 10000) {
      return;
    }
    final mysterious = raw['mysteriousMode'] == true;
    final vipLevel = mysterious ? 0 : (raw['vipLevel'] as num?)?.toInt() ?? 0;
    _roomJoinTimer?.cancel();
    _currentRoomJoin = RoomVisualEffect(
      eventId: id,
      kind: 'room_join',
      mode: 'strip',
      assetKey: '',
      imageUrl: '',
      durationMs: 2800,
      recipientUids: [
        if ((raw['senderUid'] ?? '').toString().trim().isNotEmpty)
          (raw['senderUid'] ?? '').toString().trim(),
      ],
      displayName: mysterious
          ? 'الشخص الغامض'
          : (raw['displayName'] ?? 'مستخدم Shadow Live').toString(),
      profileImageUrl: mysterious
          ? ''
          : (raw['profileImageUrl'] ?? '').toString(),
      badgeLabel: 'دخل الغرفة',
      levelLabel: vipLevel > 0 ? 'VIP $vipLevel' : '',
    );
    notifyListeners();
    _roomJoinTimer = Timer(const Duration(milliseconds: 2800), () {
      _roomJoinTimer = null;
      _currentRoomJoin = null;
      notifyListeners();
    });
  }

  void ingestEntrance(Map<String, dynamic>? raw) {
    if (raw == null) return;
    final eventId = (raw['eventId'] ?? '').toString().trim();
    if (!_markSeen('entrance:$eventId')) return;

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final eventAtMs = (raw['eventAtMs'] as num?)?.toInt() ?? 0;
    final rewardExpiresAtMs =
        (raw['rewardExpiresAtMs'] as num?)?.toInt() ?? 0;
    if (eventAtMs <= 0 || nowMs - eventAtMs > 12000) return;
    if (rewardExpiresAtMs > 0 && rewardExpiresAtMs <= nowMs) return;

    final soundAssetKey =
        (raw['soundAssetKey'] ?? '').toString().trim();
    _playSound(soundAssetKey);
    if (!_visualEnabled) return;

    final assetKey = (raw['assetKey'] ?? '').toString().trim();
    final imageUrl = (raw['imageUrl'] ?? '').toString().trim();
    if (assetKey.isEmpty && imageUrl.isEmpty) return;
    final vipLevel = (raw['vipLevel'] as num?)?.toInt() ?? 0;

    _enqueueCinematic(
      RoomVisualEffect(
        eventId: eventId,
        kind: 'entrance',
        mode: 'cinematic',
        assetKey: assetKey,
        imageUrl: imageUrl,
        durationMs: 5000,
        recipientUids: [
          if ((raw['uid'] ?? '').toString().trim().isNotEmpty)
            (raw['uid'] ?? '').toString().trim(),
        ],
        displayName:
            (raw['displayName'] ?? 'مستخدم Shadow Live').toString(),
        profileImageUrl: (raw['profileImageUrl'] ?? '').toString(),
        badgeLabel: (raw['badgeLabel'] ?? '').toString().trim(),
        levelLabel: vipLevel > 0 ? 'VIP $vipLevel' : '',
      ),
    );
  }

  void ingestAnimatedEmojiMessage(Map<String, dynamic> message) {
    final emojiId =
        (message['animatedEmojiId'] ?? '').toString().trim();
    final assetKey =
        (message['animatedEmojiAssetKey'] ?? '').toString().trim();
    final senderUid = (message['senderUid'] ?? '').toString().trim();
    final messageId = (message['id'] ?? '').toString().trim();
    if (
      emojiId.isEmpty ||
      assetKey.isEmpty ||
      senderUid.isEmpty ||
      messageId.isEmpty ||
      !_markSeen('emoji:$messageId')
    ) {
      return;
    }
    if (!_visualEnabled) return;

    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final createdAtMs =
        (message['createdAtMs'] as num?)?.toInt() ?? nowMs;
    if (createdAtMs <= 0 || nowMs - createdAtMs > 12000) return;

    _showSeatEffect(
      RoomVisualEffect(
        eventId: messageId,
        kind: 'animated_emoji',
        mode: 'seat',
        assetKey: assetKey,
        imageUrl: '',
        durationMs: 1800,
        recipientUids: <String>[senderUid],
        displayName: (message['displayName'] ?? '').toString(),
        profileImageUrl: (message['profileImageUrl'] ?? '').toString(),
      ),
    );
  }

  void ingestGiftMessage(Map<String, dynamic> message) {
    final eventId =
        (message['giftEffectEventId'] ?? '').toString().trim();
    if (eventId.isEmpty || !_markSeen('gift:$eventId')) return;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final createdAtMs =
        (message['createdAtMs'] as num?)?.toInt() ?? nowMs;
    if (createdAtMs <= 0 || nowMs - createdAtMs > 12000) return;

    final soundAssetKey =
        (message['giftEffectSoundAssetKey'] ?? '').toString().trim();
    _playSound(soundAssetKey);
    if (!_visualEnabled) return;

    final mode = (message['giftEffectMode'] ?? 'none').toString();
    if (mode != 'seat' && mode != 'cinematic') return;
    final assetKey =
        (message['giftEffectAssetKey'] ?? '').toString().trim();
    if (assetKey.isEmpty) return;
    final durationMs = ((message['giftEffectDurationMs'] as num?)
                ?.toInt() ??
            2200)
        .clamp(300, 12000)
        .toInt();
    final size = ((message['giftEffectSize'] as num?)?.toInt() ?? 0)
        .clamp(0, 420)
        .toInt();
    final rawRecipients = message['giftEffectRecipientUids'];
    final recipients = rawRecipients is List
        ? rawRecipients
            .map((value) => value.toString().trim())
            .where((value) => value.isNotEmpty)
            .toSet()
            .take(maxParallelSeatEffects)
            .toList(growable: false)
        : const <String>[];

    final event = RoomVisualEffect(
      eventId: eventId,
      kind: 'gift',
      mode: mode,
      assetKey: assetKey,
      imageUrl: '',
      durationMs: durationMs,
      recipientUids: recipients,
      size: size,
      displayName: (message['displayName'] ?? '').toString(),
      profileImageUrl: (message['profileImageUrl'] ?? '').toString(),
    );
    if (mode == 'cinematic') {
      _enqueueCinematic(event);
    } else {
      _showSeatEffect(event);
    }
  }

  void _playSound(String assetKey) {
    final key = assetKey.trim();
    final play = _playEffectSound;
    if (!_effectSoundEnabled || key.isEmpty || play == null) return;
    unawaited(play(key));
  }

  void _enqueueCinematic(RoomVisualEffect event) {
    if (_currentCinematic == null) {
      _startCinematic(event);
      return;
    }
    if (_cinematicQueue.length >= maxCinematicQueue) {
      _cinematicQueue.removeFirst();
    }
    _cinematicQueue.addLast(event);
  }

  void _startCinematic(RoomVisualEffect event) {
    _cinematicTimer?.cancel();
    _currentCinematic = event;
    notifyListeners();
    _cinematicTimer = Timer(
      Duration(milliseconds: event.durationMs),
      _finishCinematic,
    );
  }

  void _finishCinematic() {
    _cinematicTimer?.cancel();
    _cinematicTimer = null;
    _currentCinematic = null;
    if (!_visualEnabled || _cinematicQueue.isEmpty) {
      notifyListeners();
      return;
    }
    final next = _cinematicQueue.removeFirst();
    _startCinematic(next);
  }

  void _showSeatEffect(RoomVisualEffect event) {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    for (final uid in event.recipientUids) {
      if (!_seatEffects.containsKey(uid) &&
          _seatEffects.length >= maxParallelSeatEffects) {
        final oldest = _seatEffects.keys.first;
        _seatEffects.remove(oldest);
        _seatExpiresAtMs.remove(oldest);
      }
      _seatEffects[uid] = event;
      _seatExpiresAtMs[uid] = nowMs + event.durationMs;
    }
    _scheduleSeatCleanup();
    notifyListeners();
  }

  void _scheduleSeatCleanup() {
    _seatCleanupTimer?.cancel();
    if (_seatExpiresAtMs.isEmpty) return;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final nextExpiry = _seatExpiresAtMs.values.reduce(
      (left, right) => left < right ? left : right,
    );
    _seatCleanupTimer = Timer(
      Duration(
        milliseconds: (nextExpiry - nowMs).clamp(20, 12000).toInt(),
      ),
      _cleanupSeatEffects,
    );
  }

  void _cleanupSeatEffects() {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final expired = _seatExpiresAtMs.entries
        .where((entry) => entry.value <= nowMs)
        .map((entry) => entry.key)
        .toList(growable: false);
    for (final uid in expired) {
      _seatExpiresAtMs.remove(uid);
      _seatEffects.remove(uid);
    }
    if (expired.isNotEmpty) notifyListeners();
    _scheduleSeatCleanup();
  }

  void _clearVisualState() {
    _cinematicTimer?.cancel();
    _cinematicTimer = null;
    _roomJoinTimer?.cancel();
    _roomJoinTimer = null;
    _currentRoomJoin = null;
    _seatCleanupTimer?.cancel();
    _seatCleanupTimer = null;
    _cinematicQueue.clear();
    _currentCinematic = null;
    _seatEffects.clear();
    _seatExpiresAtMs.clear();
    notifyListeners();
  }

  @override
  void dispose() {
    _cinematicTimer?.cancel();
    _roomJoinTimer?.cancel();
    _seatCleanupTimer?.cancel();
    final stop = _stopEffectSounds;
    if (stop != null) unawaited(stop());
    super.dispose();
  }
}

class RoomEffectCoordinatorHost extends StatelessWidget {
  const RoomEffectCoordinatorHost({
    super.key,
    required this.coordinator,
    this.entranceTop = 100,
    this.joinBottom = 96,
  });

  final RoomEffectCoordinator coordinator;
  // Position the entrance above the microphone grid. A separate, very short
  // join notice appears above chat, using this SAME coordinator/queue.
  final double entranceTop;
  final double joinBottom;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: coordinator,
      builder: (context, _) {
        if (!coordinator.visualEnabled) return const SizedBox.shrink();
        final event = coordinator.currentCinematic;
        final roomJoin = coordinator.currentRoomJoin;
        if (event == null && roomJoin == null) {
          return const SizedBox.shrink();
        }

        return IgnorePointer(
          ignoring: true,
          child: Stack(
            fit: StackFit.expand,
            children: [
              if (event != null && event.kind == 'entrance')
                Positioned(
                  top: entranceTop,
                  left: 12,
                  right: 12,
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 268),
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xDD140E20),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(
                            color: const Color(0xAAFFD54A),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(
                              width: 36,
                              height: 36,
                              child: ClipRect(
                                child: CosmeticAssetVisual(
                                  assetKey: event.assetKey,
                                  imageUrl: event.imageUrl,
                                  fit: BoxFit.contain,
                                ),
                              ),
                            ),
                            Flexible(
                              child: _EntranceWelcomeStrip(event: event, compact: true),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              if (event != null && event.kind != 'entrance')
                Center(
                  child: SizedBox(
                    width: event.size > 0 ? event.size.toDouble() : 320,
                    height: event.size > 0 ? event.size.toDouble() : 320,
                    child: CosmeticAssetVisual(
                      assetKey: event.assetKey,
                      imageUrl: event.imageUrl,
                      fit: BoxFit.contain,
                    ),
                  ),
                ),
              if (roomJoin != null)
                Positioned(
                  left: 14,
                  right: 14,
                  bottom: joinBottom,
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 280),
                      child: _EntranceWelcomeStrip(event: roomJoin),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _EntranceWelcomeStrip extends StatelessWidget {
  const _EntranceWelcomeStrip({
    required this.event,
    this.compact = false,
  });

  final RoomVisualEffect event;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final badge = [
      event.badgeLabel,
      event.levelLabel,
    ].where((value) => value.trim().isNotEmpty).join(' • ');
    return Container(
      constraints: const BoxConstraints(maxWidth: 330),
      margin: compact
          ? EdgeInsets.zero
          : const EdgeInsets.symmetric(horizontal: 18),
      padding: compact
          ? const EdgeInsets.symmetric(horizontal: 6, vertical: 4)
          : const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: compact ? Colors.transparent : const Color(0xDD171020),
        borderRadius: BorderRadius.circular(16),
        border: compact ? null : Border.all(color: const Color(0x99FFD54A)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: compact ? 12 : 18,
            backgroundColor: const Color(0xFF2A2038),
            backgroundImage: event.profileImageUrl.trim().isEmpty
                ? null
                : NetworkImage(event.profileImageUrl),
            child: event.profileImageUrl.trim().isEmpty
                ? Icon(
                    Icons.person_rounded,
                    color: Colors.white70,
                    size: compact ? 15 : 20,
                  )
                : null,
          ),
          const SizedBox(width: 8),
          Flexible(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                    fontSize: compact ? 12 : 14,
                  ),
                ),
                Text(
                  badge.isEmpty ? 'أهلاً بك في الغرفة' : badge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFFFD54A),
                    fontSize: compact ? 10 : 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
