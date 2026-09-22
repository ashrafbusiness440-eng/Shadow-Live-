import 'dart:async';
import 'package:flutter/material.dart';
import '../services/star_battle_service.dart';

class StarBattleSheet extends StatefulWidget {
  const StarBattleSheet({
    super.key,
    required this.roomId,
    required this.canManage,
  });

  final String roomId;
  final bool canManage;

  @override
  State<StarBattleSheet> createState() => _StarBattleSheetState();
}

class _StarBattleSheetState extends State<StarBattleSheet> {
  final StarBattleService _service = StarBattleService();
  StreamSubscription<StarBattleState?>? _subscription;
  Timer? _timer;
  StarBattleState? _battle;
  bool _busy = false;
  bool _syncing = false;

  @override
  void initState() {
    super.initState();
    _subscription = _service.watch(widget.roomId).listen((value) {
      if (mounted) setState(() => _battle = value);
    });
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
      final battle = _battle;
      if (battle != null &&
          battle.active &&
          battle.endsAtMs > 0 &&
          DateTime.now().millisecondsSinceEpoch >= battle.endsAtMs &&
          !_syncing) {
        _syncing = true;
        unawaited(
          _service.sync(widget.roomId).whenComplete(() => _syncing = false),
        );
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(_subscription?.cancel());
    _service.close();
    super.dispose();
  }

  String _score(int value) {
    if (value >= 1000000) {
      final n = value / 1000000;
      return (n >= 10 ? n.toStringAsFixed(0) : n.toStringAsFixed(2)) + 'M';
    }
    if (value >= 1000) {
      final n = value / 1000;
      return (n >= 10 ? n.toStringAsFixed(0) : n.toStringAsFixed(1)) + 'K';
    }
    return value.toString();
  }

  String _remaining(StarBattleState battle) {
    final total = ((battle.endsAtMs -
                DateTime.now().millisecondsSinceEpoch) /
            1000)
        .ceil()
        .clamp(0, 86400);
    final hours = total ~/ 3600;
    final minutes = (total % 3600) ~/ 60;
    final seconds = total % 60;
    final hh = hours.toString().padLeft(2, '0');
    final mm = minutes.toString().padLeft(2, '0');
    final ss = seconds.toString().padLeft(2, '0');
    return hours > 0 ? hh + ':' + mm + ':' + ss : mm + ':' + ss;
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر تنفيذ حرب النجوم حالياً.')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _start() async {
    var duration = 10;
    final selected = await showModalBottomSheet<int>(
      context: context,
      backgroundColor: const Color(0xFF11131B),
      builder: (sheetContext) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: StatefulBuilder(
            builder: (_, setLocalState) {
              return SafeArea(
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'بدء حرب النجوم ⭐',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [5, 10, 15, 30, 60]
                            .map(
                              (minutes) => ChoiceChip(
                                label: Text(minutes.toString() + ' دقيقة'),
                                selected: duration == minutes,
                                onSelected: (_) {
                                  setLocalState(() => duration = minutes);
                                },
                              ),
                            )
                            .toList(),
                      ),
                      const SizedBox(height: 16),
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton(
                          onPressed: () =>
                              Navigator.pop(sheetContext, duration),
                          child: const Text('بدء الجولة'),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
    if (selected != null) {
      await _run(
        () => _service.create(
          roomId: widget.roomId,
          durationMinutes: selected,
        ),
      );
    }
  }

  Future<void> _history() async {
    final history = await _service.history(widget.roomId);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF11131B),
      builder: (_) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: SizedBox(
              height: MediaQuery.sizeOf(context).height * .72,
              child: Column(
                children: [
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Text(
                      'آخر جولات حرب النجوم',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 19,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  Expanded(
                    child: history.isEmpty
                        ? const Center(
                            child: Text(
                              'لا توجد جولات سابقة',
                              style: TextStyle(color: Colors.white54),
                            ),
                          )
                        : ListView.builder(
                            itemCount: history.length,
                            itemBuilder: (_, index) {
                              final item = history[index];
                              final top = item.leaders.isEmpty
                                  ? 'بدون نقاط'
                                  : item.leaders
                                      .take(3)
                                      .map(
                                        (leader) =>
                                            leader.displayName +
                                            ': ' +
                                            _score(leader.coins) +
                                            ' ⭐',
                                      )
                                      .join(' • ');
                              return ListTile(
                                leading: const Icon(
                                  Icons.star_rounded,
                                  color: Color(0xFFFFD54A),
                                ),
                                title: Text(
                                  'جولة ' +
                                      (history.length - index).toString(),
                                  style: const TextStyle(color: Colors.white),
                                ),
                                subtitle: Text(
                                  top,
                                  style:
                                      const TextStyle(color: Colors.white54),
                                ),
                              );
                            },
                          ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final battle = _battle;
    final active = battle?.active == true;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Row(
                  children: [
                    const Icon(
                      Icons.star_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    const SizedBox(width: 8),
                    const Text(
                      'حرب النجوم',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 21,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const Spacer(),
                    if (active)
                      Text(
                        _remaining(battle!),
                        style: const TextStyle(
                          color: Color(0xFFFFD54A),
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    TextButton.icon(
                      onPressed: _busy ? null : _history,
                      icon: const Icon(Icons.history_rounded),
                      label: const Text('آخر 100 جولة'),
                    ),
                    const Spacer(),
                    if (!active && widget.canManage)
                      FilledButton(
                        onPressed: _busy ? null : _start,
                        child: const Text('بدء الجولة'),
                      ),
                    if (active && widget.canManage)
                      FilledButton(
                        onPressed: _busy
                            ? null
                            : () => _run(
                                  () => _service.finish(widget.roomId),
                                ),
                        style: FilledButton.styleFrom(
                          backgroundColor: Colors.redAccent,
                        ),
                        child: const Text('إنهاء مبكر'),
                      ),
                  ],
                ),
                const Divider(color: Colors.white12),
                const Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: Text(
                    '1 Coin دعم = 1 نجمة • K وM تنسيق عرض فقط',
                    style: TextStyle(color: Colors.white54, fontSize: 10),
                  ),
                ),
                Expanded(
                  child: !active
                      ? const Center(
                          child: Text(
                            'لا توجد جولة نشطة الآن',
                            style: TextStyle(color: Colors.white54),
                          ),
                        )
                      : battle!.leaders.isEmpty
                          ? const Center(
                              child: Text(
                                'بانتظار أول دعم خلال الجولة',
                                style: TextStyle(color: Colors.white54),
                              ),
                            )
                          : ListView.separated(
                              itemCount: battle.leaders.length,
                              separatorBuilder: (_, __) =>
                                  const Divider(color: Colors.white10),
                              itemBuilder: (_, index) {
                                final leader = battle.leaders[index];
                                return ListTile(
                                  leading: CircleAvatar(
                                    backgroundImage:
                                        leader.profileImageUrl.isEmpty
                                            ? null
                                            : NetworkImage(
                                                leader.profileImageUrl,
                                              ),
                                    child: leader.profileImageUrl.isEmpty
                                        ? const Icon(Icons.person_rounded)
                                        : null,
                                  ),
                                  title: Text(
                                    leader.displayName,
                                    style:
                                        const TextStyle(color: Colors.white),
                                  ),
                                  subtitle: Text(
                                    '#' + (index + 1).toString(),
                                  ),
                                  trailing: Text(
                                    _score(leader.coins) + ' ⭐',
                                    style: const TextStyle(
                                      color: Color(0xFFFFD54A),
                                      fontWeight: FontWeight.w900,
                                    ),
                                  ),
                                );
                              },
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
