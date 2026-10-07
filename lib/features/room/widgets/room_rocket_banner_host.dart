import 'dart:async';
import 'dart:math' as math;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../services/room_rocket_service.dart';
import '../../vip/services/vip_service.dart';

class RoomRocketBannerHost extends StatefulWidget {
  const RoomRocketBannerHost({
    super.key,
    required this.child,
  });

  final Widget child;

  @override
  State<RoomRocketBannerHost> createState() => _RoomRocketBannerHostState();
}

class _RoomRocketBannerHostState extends State<RoomRocketBannerHost> {
  final RoomRocketService _service = RoomRocketService();
  final VipService _vipService = VipService();
  final VoiceRoomSessionController _voice =
      VoiceRoomSessionController.instance;

  StreamSubscription<List<RoomRocketEvent>>? _subscription;
  StreamSubscription<List<GlobalAppEvent>>? _globalSubscription;
  StreamSubscription<User?>? _vipAuthSubscription;
  Timer? _timer;
  List<RoomRocketEvent> _events = const [];
  List<GlobalAppEvent> _globalEvents = const [];
  RoomRocketEvent? _active;
  GlobalAppEvent? _globalActive;
  String _lastVip10PromptUid = '';
  final Set<String> _registered = <String>{};
  static const int _maxNetworkAttempts = 4;

  final Set<String> _entering = <String>{};
  final Set<String> _claiming = <String>{};
  final Set<String> _claimed = <String>{};
  final Set<String> _enterStopped = <String>{};
  final Set<String> _claimStopped = <String>{};
  final Map<String, int> _enterAttempts = <String, int>{};
  final Map<String, int> _claimAttempts = <String, int>{};
  final Map<String, int> _enterRetryAtMs = <String, int>{};
  final Map<String, int> _claimRetryAtMs = <String, int>{};
  bool _openingRoom = false;

  @override
  void initState() {
    super.initState();
    _voice.addListener(_onVoiceChanged);
    _subscription = _service.watchRecentEvents().listen(
      (events) {
        _events = events;
        _refresh();
      },
      onError: (_) {},
    );
    _globalSubscription = _service.watchGlobalEvents().listen(
      (events) {
        _globalEvents = events;
        _refreshGlobal();
      },
      onError: (_) {},
    );
    _vipAuthSubscription = FirebaseAuth.instance.authStateChanges().listen(
      (user) {
        if (user == null || user.isAnonymous) {
          _lastVip10PromptUid = '';
          return;
        }
        unawaited(_checkVip10EntryPrompt(user));
      },
      onError: (_) {},
    );
    _timer = Timer.periodic(
      const Duration(milliseconds: 250),
      (_) => _refresh(),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    _subscription?.cancel();
    _globalSubscription?.cancel();
    _vipAuthSubscription?.cancel();
    _voice.removeListener(_onVoiceChanged);
    _service.close();
    _vipService.close();
    super.dispose();
  }

  void _onVoiceChanged() => _refresh();
  Future<void> _checkVip10EntryPrompt(User user) async {
    if (_lastVip10PromptUid == user.uid) return;
    _lastVip10PromptUid = user.uid;
    try {
      final state = await _vipService.loadVip10GlobalEntryState();
      if (!mounted ||
          !state.eligible ||
          state.alreadyPublished ||
          FirebaseAuth.instance.currentUser?.uid != user.uid) {
        return;
      }
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(_showVip10EntryPrompt());
      });
    } catch (_) {
      // VIP prompt must never delay login or app navigation.
    }
  }

  Future<void> _showVip10EntryPrompt() async {
    final context = NavigationService.navigatorKey.currentContext;
    if (context == null || !mounted) return;
    final publish = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF111321),
          title: const Text(
            'دخول VIP10',
            style: TextStyle(color: Color(0xFFFFD54A)),
          ),
          content: const Text(
            'هل تريد نشر شريط دخولك العام الآن؟ يمكن نشره مرة واحدة فقط اليوم.',
            style: TextStyle(color: Colors.white70),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('بدون نشر'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('نشر'),
            ),
          ],
        ),
      ),
    );
    if (publish != true) return;
    try {
      await _vipService.publishVip10GlobalEntry();
    } catch (_) {
      final current = NavigationService.navigatorKey.currentContext;
      if (current != null && current.mounted) {
        ScaffoldMessenger.of(current).showSnackBar(
          const SnackBar(
            content: Text('تعذر نشر شريط VIP10 حالياً.'),
          ),
        );
      }
    }
  }

  void _refreshGlobal() {
    if (!mounted) return;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    const celebrationKinds = <String>{
      'vip10_global_entry',
      'vip_level_upgrade',
      'game_win',
      'relationship_level_up',
      'premium_gift',
    };
    final active = _globalEvents
        .where(
          (event) =>
              celebrationKinds.contains(event.kind) &&
              event.activeAt(nowMs),
        )
        .toList()
      ..sort((a, b) => a.startsAtMs.compareTo(b.startsAtMs));
    final next = active.isEmpty ? null : active.first;
    if (_globalActive?.id != next?.id) {
      setState(() => _globalActive = next);
    } else if (next != null) {
      setState(() {});
    }
  }


  void _refresh() {
    if (!mounted) return;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final knownIds = _events.map((event) => event.id).toSet();
    _registered.removeWhere((id) => !knownIds.contains(id));
    _claimed.removeWhere((id) => !knownIds.contains(id));
    _enterStopped.removeWhere((id) => !knownIds.contains(id));
    _claimStopped.removeWhere((id) => !knownIds.contains(id));
    _enterAttempts.removeWhere((id, _) => !knownIds.contains(id));
    _claimAttempts.removeWhere((id, _) => !knownIds.contains(id));
    _enterRetryAtMs.removeWhere((id, _) => !knownIds.contains(id));
    _claimRetryAtMs.removeWhere((id, _) => !knownIds.contains(id));

    final activeEvents = _events
        .where((event) => event.activeAt(nowMs))
        .toList()
      ..sort((a, b) => a.startsAtMs.compareTo(b.startsAtMs));
    final nextActive = activeEvents.isEmpty ? null : activeEvents.first;

    if (_active?.id != nextActive?.id) {
      setState(() => _active = nextActive);
    } else if (nextActive != null) {
      setState(() {});
    }

    final active = nextActive;
    if (active != null &&
        _voice.active &&
        _voice.roomId == active.roomId &&
        !_enterStopped.contains(active.id) &&
        (_enterAttempts[active.id] ?? 0) < _maxNetworkAttempts &&
        nowMs >= (_enterRetryAtMs[active.id] ?? 0)) {
      unawaited(_register(active));
    }

    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (uid.isEmpty) return;
    for (final event in _events) {
      if (!event.endedAt(nowMs) ||
          _claimed.contains(event.id) ||
          _claimStopped.contains(event.id) ||
          (_claimAttempts[event.id] ?? 0) >= _maxNetworkAttempts ||
          nowMs < (_claimRetryAtMs[event.id] ?? 0)) {
        continue;
      }
      final contributor = event.contributorIds.contains(uid);
      if (contributor || _registered.contains(event.id)) {
        unawaited(_claim(event));
      }
    }
  }

  Duration _retryDelay(
    RoomRocketRequestException error,
    int attempt, {
    required int baseMilliseconds,
  }) {
    final serverDelay = error.retryAfter;
    if (serverDelay != null) {
      return serverDelay > const Duration(seconds: 8)
          ? const Duration(seconds: 8)
          : serverDelay;
    }
    final exponent = attempt <= 1 ? 0 : attempt - 1;
    final multiplier = 1 << exponent;
    return Duration(
      milliseconds: math.min(8000, baseMilliseconds * multiplier).toInt(),
    );
  }

  Future<void> _register(RoomRocketEvent event) async {
    if (_registered.contains(event.id) ||
        _entering.contains(event.id) ||
        _enterStopped.contains(event.id)) {
      return;
    }
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (!event.activeAt(nowMs) ||
        nowMs < (_enterRetryAtMs[event.id] ?? 0)) {
      return;
    }

    final attempt = (_enterAttempts[event.id] ?? 0) + 1;
    if (attempt > _maxNetworkAttempts) {
      _enterStopped.add(event.id);
      return;
    }
    _enterAttempts[event.id] = attempt;
    _entering.add(event.id);
    try {
      await _service.enter(event.id);
      _registered.add(event.id);
      _enterAttempts.remove(event.id);
      _enterRetryAtMs.remove(event.id);
    } on RoomRocketRequestException catch (error) {
      if (!error.retryable ||
          attempt >= _maxNetworkAttempts ||
          !event.activeAt(DateTime.now().millisecondsSinceEpoch)) {
        _enterStopped.add(event.id);
      } else {
        _enterRetryAtMs[event.id] =
            DateTime.now().millisecondsSinceEpoch +
                _retryDelay(
                  error,
                  attempt,
                  baseMilliseconds: 500,
                ).inMilliseconds;
      }
    } catch (_) {
      _enterStopped.add(event.id);
    } finally {
      _entering.remove(event.id);
    }
  }

  Future<void> _claim(RoomRocketEvent event) async {
    if (_claiming.contains(event.id) ||
        _claimed.contains(event.id) ||
        _claimStopped.contains(event.id)) {
      return;
    }
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    if (nowMs < (_claimRetryAtMs[event.id] ?? 0)) return;

    final attempt = (_claimAttempts[event.id] ?? 0) + 1;
    if (attempt > _maxNetworkAttempts) {
      _claimStopped.add(event.id);
      return;
    }
    _claimAttempts[event.id] = attempt;
    _claiming.add(event.id);
    try {
      final body = await _service.claim(event.id);
      _claimed.add(event.id);
      _claimAttempts.remove(event.id);
      _claimRetryAtMs.remove(event.id);
      final raw = body['result'];
      if (raw is Map &&
          _voice.active &&
          _voice.roomId == event.roomId) {
        await _showPrivateResult(
          Map<String, dynamic>.from(raw),
        );
      }
    } on RoomRocketRequestException catch (error) {
      if (!error.retryable || attempt >= _maxNetworkAttempts) {
        _claimStopped.add(event.id);
      } else {
        _claimRetryAtMs[event.id] =
            DateTime.now().millisecondsSinceEpoch +
                _retryDelay(
                  error,
                  attempt,
                  baseMilliseconds: 1000,
                ).inMilliseconds;
      }
    } catch (_) {
      _claimStopped.add(event.id);
    } finally {
      _claiming.remove(event.id);
    }
  }

  String _rewardLine(Map<String, dynamic> outcome) {
    if (outcome['won'] != true) {
      return (outcome['messageAr'] ?? 'حظ أوفر في المرة القادمة').toString();
    }
    switch ((outcome['type'] ?? '').toString()) {
      case 'coins':
        return 'ربحت ${outcome['coins'] ?? 0} Coins';
      case 'frame':
        return 'ربحت إطارًا لمدة ${outcome['durationHours'] ?? 0} ساعة';
      case 'entrance':
        return 'ربحت دخولية لمدة ${outcome['durationHours'] ?? 0} ساعة';
      case 'voice_wave':
        return 'ربحت موجة صوتية لمدة ${outcome['durationHours'] ?? 0} ساعة';
      case 'room_background':
        return 'ربحت خلفية روم لمدة ${outcome['durationHours'] ?? 0} ساعة';
      default:
        return 'تمت إضافة جائزتك إلى حسابك';
    }
  }

  Future<void> _showPrivateResult(Map<String, dynamic> result) async {
    final raw = result['outcomes'];
    final outcomes = raw is List
        ? raw
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList(growable: false)
        : const <Map<String, dynamic>>[];
    if (outcomes.isEmpty) return;
    final context = NavigationService.navigatorKey.currentContext;
    if (context == null) return;

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF111321),
          title: Row(
            children: [
              const Icon(
                Icons.rocket_launch_rounded,
                color: Color(0xFFFFD54A),
              ),
              const SizedBox(width: 8),
              Text(
                'نتيجة صاروخ LV.${result['level'] ?? ''}',
                style: const TextStyle(color: Colors.white),
              ),
            ],
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: outcomes
                .map(
                  (outcome) => Padding(
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text(
                      _rewardLine(outcome),
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: outcome['won'] == true
                            ? const Color(0xFFFFD54A)
                            : Colors.white70,
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                )
                .toList(growable: false),
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('تمام'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openRoom(RoomRocketEvent event) async {
    if (_openingRoom) return;
    if (_voice.roomId.isNotEmpty && _voice.roomId == event.roomId) {
      return;
    }
    _openingRoom = true;
    try {
      final args = await _service.loadRoomNavigationArguments(event.roomId);
      if (args == null) return;
      unawaited(
        NavigationService.navigateTo(
          AppRoutes.voiceChatRoom,
          arguments: args,
        ),
      );
    } finally {
      _openingRoom = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final event = _active;
    final global = _globalActive;
    return Stack(
      children: [
        widget.child,
        if (global != null)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                child: _CelebrationBanner(event: global),
              ),
            ),
          )
        else if (event != null)
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 8, 12, 0),
                child: _RocketBanner(
                  event: event,
                  onTap: () => _openRoom(event),
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _CelebrationBanner extends StatelessWidget {
  const _CelebrationBanner({required this.event});

  final GlobalAppEvent event;

  String get _headline => switch (event.kind) {
        'game_win' => event.displayName,
        'relationship_level_up' =>
          event.relationshipType == 'cp' ? 'ترقية CP' : 'ترقية علاقة',
        'premium_gift' => event.displayName,
        _ => event.displayName,
      };

  String get _message {
    if (event.messageAr.trim().isNotEmpty) return event.messageAr.trim();
    return switch (event.kind) {
      'vip_level_upgrade' => 'ترقّى إلى VIP${event.vipLevel} 🎉',
      'vip10_global_entry' => 'دخل التطبيق • VIP10',
      'game_win' => 'ربح ${event.payoutCoins} كوينز',
      'relationship_level_up' =>
        '${event.relationshipType == 'cp' ? 'CP' : 'العلاقة'} → Lv.${event.relationshipLevel}',
      'premium_gift' =>
        'أرسل ${event.giftName.isEmpty ? 'هدية فاخرة' : event.giftName} ×${event.giftQuantity}',
      _ => '',
    };
  }

  IconData get _icon => switch (event.kind) {
        'game_win' => Icons.emoji_events_rounded,
        'relationship_level_up' => Icons.favorite_rounded,
        'premium_gift' => Icons.card_giftcard_rounded,
        _ => Icons.workspace_premium_rounded,
      };

  Color get _accent => switch (event.kind) {
        'relationship_level_up' => const Color(0xFFFF6FB2),
        'game_win' => const Color(0xFFFFD54A),
        'premium_gift' => const Color(0xFFC8A2FF),
        _ => const Color(0xFFFFD54A),
      };

  @override
  Widget build(BuildContext context) {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final seconds = math.max(0, ((event.endsAtMs - nowMs) / 1000).ceil());
    final hasSecondary = event.secondaryUid.isNotEmpty;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: IgnorePointer(
        ignoring: true,
        child: Material(
          color: Colors.transparent,
          child: Container(
            height: 70,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  _accent.withValues(alpha: .34),
                  const Color(0xFF15101E),
                  _accent.withValues(alpha: .18),
                ],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: _accent.withValues(alpha: .78)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x66000000),
                  blurRadius: 18,
                  offset: Offset(0, 7),
                ),
              ],
            ),
            child: Row(
              children: [
                ProfileAvatarWithFrame(
                  diameter: 44,
                  userId: event.uid,
                  backgroundColor: const Color(0xFF25183F),
                  placeholderColor: Colors.white70,
                  fallbackProfile: <String, dynamic>{
                    'profileImageUrl': event.profileImageUrl,
                  },
                ),
                if (hasSecondary) ...[
                  Transform.translate(
                    offset: const Offset(8, 0),
                    child: ProfileAvatarWithFrame(
                      diameter: 38,
                      userId: event.secondaryUid,
                      backgroundColor: const Color(0xFF25183F),
                      placeholderColor: Colors.white70,
                      fallbackProfile: <String, dynamic>{
                        'profileImageUrl': event.secondaryProfileImageUrl,
                      },
                    ),
                  ),
                  const SizedBox(width: 6),
                ] else
                  const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _headline,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        _message,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: _accent,
                          fontWeight: FontWeight.w900,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(_icon, color: _accent, size: 27),
                const SizedBox(width: 7),
                Text(
                  '${seconds}s',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontWeight: FontWeight.w900,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RocketBanner extends StatelessWidget {
  const _RocketBanner({
    required this.event,
    required this.onTap,
  });

  final RoomRocketEvent event;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final nowMs = DateTime.now().millisecondsSinceEpoch;
    final seconds = math.max(
      0,
      ((event.endsAtMs - nowMs) / 1000).ceil(),
    );

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(18),
          child: Container(
            height: 66,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [
                  Color(0xFF26123F),
                  Color(0xFF121526),
                  Color(0xFF38200A),
                ],
              ),
              borderRadius: BorderRadius.circular(18),
              border: Border.all(color: const Color(0x99FFD54A)),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x66000000),
                  blurRadius: 16,
                  offset: Offset(0, 7),
                ),
              ],
            ),
            child: Row(
              children: [
                ProfileAvatarWithFrame(
                  diameter: 44,
                  userId: event.triggerUid,
                  backgroundColor: const Color(0xFF25183F),
                  placeholderColor: Colors.white70,
                  fallbackProfile: <String, dynamic>{
                    'profileImageUrl': event.triggerProfileImageUrl,
                  },
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        event.triggerDisplayName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        'فجّر صاروخ الغرفة • LV.${event.level}',
                        style: const TextStyle(
                          color: Color(0xFFFFD54A),
                          fontSize: 12,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.rocket_launch_rounded,
                  color: Color(0xFFFFD54A),
                  size: 27,
                ),
                const SizedBox(width: 8),
                Text(
                  '${seconds}s',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontWeight: FontWeight.w900,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
