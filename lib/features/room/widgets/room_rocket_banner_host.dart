import 'dart:async';
import 'dart:math' as math;

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../services/room_rocket_service.dart';

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
  final VoiceRoomSessionController _voice =
      VoiceRoomSessionController.instance;

  StreamSubscription<List<RoomRocketEvent>>? _subscription;
  Timer? _timer;
  List<RoomRocketEvent> _events = const [];
  RoomRocketEvent? _active;
  final Set<String> _registered = <String>{};
  final Set<String> _entering = <String>{};
  final Set<String> _claiming = <String>{};
  final Set<String> _claimed = <String>{};
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
    _timer = Timer.periodic(
      const Duration(milliseconds: 250),
      (_) => _refresh(),
    );
  }

  @override
  void dispose() {
    _timer?.cancel();
    _subscription?.cancel();
    _voice.removeListener(_onVoiceChanged);
    _service.close();
    super.dispose();
  }

  void _onVoiceChanged() => _refresh();

  void _refresh() {
    if (!mounted) return;
    final nowMs = DateTime.now().millisecondsSinceEpoch;
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
        _voice.roomId == active.roomId) {
      unawaited(_register(active));
    }

    final uid = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (uid.isEmpty) return;
    for (final event in _events) {
      if (!event.endedAt(nowMs) || _claimed.contains(event.id)) continue;
      final contributor = event.contributorIds.contains(uid);
      if (contributor || _registered.contains(event.id)) {
        unawaited(_claim(event));
      }
    }
  }

  Future<void> _register(RoomRocketEvent event) async {
    if (_registered.contains(event.id) || _entering.contains(event.id)) return;
    _entering.add(event.id);
    try {
      await _service.enter(event.id);
      _registered.add(event.id);
    } catch (_) {
      // Presence join can land a fraction later than the banner.
      // Keep it retryable until the 10-second window closes.
    } finally {
      _entering.remove(event.id);
    }
  }

  Future<void> _claim(RoomRocketEvent event) async {
    if (_claiming.contains(event.id) || _claimed.contains(event.id)) return;
    _claiming.add(event.id);
    try {
      final body = await _service.claim(event.id);
      _claimed.add(event.id);
      final raw = body['result'];
      if (raw is Map &&
          _voice.active &&
          _voice.roomId == event.roomId) {
        await _showPrivateResult(
          Map<String, dynamic>.from(raw),
        );
      }
    } catch (_) {
      // If the backend says not ready/eligible yet, leave it retryable.
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
    return Stack(
      children: [
        widget.child,
        if (event != null)
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
                CircleAvatar(
                  radius: 22,
                  backgroundColor: const Color(0xFF25183F),
                  backgroundImage: event.triggerProfileImageUrl.isEmpty
                      ? null
                      : NetworkImage(event.triggerProfileImageUrl),
                  child: event.triggerProfileImageUrl.isEmpty
                      ? const Icon(
                          Icons.person_rounded,
                          color: Colors.white70,
                        )
                      : null,
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
