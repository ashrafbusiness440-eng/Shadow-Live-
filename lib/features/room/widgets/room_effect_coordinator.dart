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
  Timer? _cinematicTimer;
  Timer? _seatCleanupTimer;
  bool _visualEnabled = true;
  bool _effectSoundEnabled = true;
  final Future<void> Function(String assetKey)? _playEffectSound;
  final Future<void> Function()? _stopEffectSounds;

  RoomVisualEffect? get currentCinematic => _currentCinematic;
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
  });

  final RoomEffectCoordinator coordinator;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: coordinator,
      builder: (context, _) {
        if (!coordinator.visualEnabled) return const SizedBox.shrink();
        final event = coordinator.currentCinematic;
        if (event == null) return const SizedBox.shrink();

        return IgnorePointer(
          ignoring: true,
          child: Stack(
            fit: StackFit.expand,
            children: [
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
              if (event.kind == 'entrance')
                Align(
                  alignment: const Alignment(0, -.72),
                  child: _EntranceWelcomeStrip(event: event),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _EntranceWelcomeStrip extends StatelessWidget {
  const _EntranceWelcomeStrip({required this.event});

  final RoomVisualEffect event;

  @override
  Widget build(BuildContext context) {
    final badge = [
      event.badgeLabel,
      event.levelLabel,
    ].where((value) => value.trim().isNotEmpty).join(' • ');
    return Container(
      constraints: const BoxConstraints(maxWidth: 330),
      margin: const EdgeInsets.symmetric(horizontal: 18),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: const Color(0xDD171020),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0x99FFD54A)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 18,
            backgroundColor: const Color(0xFF2A2038),
            backgroundImage: event.profileImageUrl.trim().isEmpty
                ? null
                : NetworkImage(event.profileImageUrl),
            child: event.profileImageUrl.trim().isEmpty
                ? const Icon(
                    Icons.person_rounded,
                    color: Colors.white70,
                    size: 20,
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
                  ),
                ),
                Text(
                  badge.isEmpty ? 'أهلاً بك في الغرفة' : badge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Color(0xFFFFD54A),
                    fontSize: 11,
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
