import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/room_pk_service.dart';

class RoomPkPanel extends StatefulWidget {
  const RoomPkPanel({
    super.key,
    required this.roomId,
    required this.canManage,
  });

  final String roomId;
  final bool canManage;

  @override
  State<RoomPkPanel> createState() => _RoomPkPanelState();
}

class _RoomPkPanelState extends State<RoomPkPanel> {
  final RoomPkService _service = RoomPkService();
  StreamSubscription<RoomPkContext>? _subscription;
  Timer? _timer;
  RoomPkContext? _context;
  bool _busy = false;
  bool _syncing = false;
  String _lastSyncKey = '';

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  @override
  void initState() {
    super.initState();
    _subscription = _service.watch(widget.roomId).listen((value) {
      if (!mounted) return;
      setState(() => _context = value);
      unawaited(_maybeSync());
    });
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() {});
      unawaited(_maybeSync());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(_subscription?.cancel());
    _service.close();
    super.dispose();
  }

  String _errorText(Object error) {
    final code = error is StateError ? error.message.toString() : '';
    switch (code) {
      case 'pk_already_active':
        return 'يوجد PK شغال حالياً.';
      case 'pk_participant_not_on_mic':
        return 'كل لاعبي PK لازم يكونوا على المايك.';
      case 'invalid_pk_participants':
        return 'اختر 2 أو 4 أو 6 أو 8 لاعبين.';
      case 'forbidden':
        return 'ما عندك صلاحية إدارة PK.';
      default:
        return 'تعذر تنفيذ عملية PK حالياً.';
    }
  }

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_errorText(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _maybeSync() async {
    final pk = _context?.pk;
    if (pk == null || _syncing) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    final dueCountdown = pk.status == 'countdown' &&
        pk.countdownEndsAtMs > 0 &&
        now >= pk.countdownEndsAtMs;
    final dueEnd = pk.status == 'active' &&
        pk.endsAtMs > 0 &&
        now >= pk.endsAtMs;
    if (!dueCountdown && !dueEnd) return;

    final key = pk.id +
        ':' +
        pk.status +
        ':' +
        pk.countdownEndsAtMs.toString() +
        ':' +
        pk.endsAtMs.toString();
    if (_lastSyncKey == key) return;
    _lastSyncKey = key;
    _syncing = true;
    try {
      await _service.sync(widget.roomId);
    } catch (_) {
      _lastSyncKey = '';
    } finally {
      _syncing = false;
    }
  }

  Future<void> _showCreateSheet() async {
    final speakers = _context?.speakers ?? const <RoomPkSpeaker>[];
    if (speakers.length < 2) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('لازم يكون في متحدثين اثنين على الأقل لبدء PK.'),
        ),
      );
      return;
    }

    final selected = <String>{};
    var duration = 5;
    if (speakers.length >= 2) {
      selected.add(speakers[0].uid);
      selected.add(speakers[1].uid);
    }

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) => SafeArea(
            child: SizedBox(
              height: MediaQuery.sizeOf(context).height * .78,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
                child: Column(
                  children: [
                    Container(
                      width: 44,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(99),
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Row(
                      children: [
                        Icon(
                          Icons.sports_mma_rounded,
                          color: Color(0xFFFFD54A),
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'بدء تحدي PK',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    const Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: Text(
                        'اختر عدداً زوجياً من المتحدثين: 2 / 4 / 6 / 8',
                        style: TextStyle(
                          color: Colors.white54,
                          fontSize: 11,
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Expanded(
                      child: ListView.separated(
                        itemCount: speakers.length,
                        separatorBuilder: (_, __) =>
                            const Divider(color: Colors.white10),
                        itemBuilder: (_, index) {
                          final speaker = speakers[index];
                          final checked = selected.contains(speaker.uid);
                          return CheckboxListTile(
                            value: checked,
                            activeColor: const Color(0xFF6D27D9),
                            secondary: CircleAvatar(
                              backgroundColor: const Color(0xFF25183F),
                              backgroundImage:
                                  speaker.profileImageUrl.isEmpty
                                      ? null
                                      : NetworkImage(
                                          speaker.profileImageUrl,
                                        ),
                              child: speaker.profileImageUrl.isEmpty
                                  ? const Icon(
                                      Icons.person_rounded,
                                      color: Colors.white54,
                                    )
                                  : null,
                            ),
                            title: Text(
                              speaker.displayName,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            subtitle: Text(
                              'المقعد ' +
                                  (speaker.seatIndex + 1).toString(),
                              style: const TextStyle(
                                color: Colors.white38,
                                fontSize: 10,
                              ),
                            ),
                            onChanged: _busy
                                ? null
                                : (value) {
                                    setSheetState(() {
                                      if (value == true) {
                                        if (selected.length < 8) {
                                          selected.add(speaker.uid);
                                        }
                                      } else {
                                        selected.remove(speaker.uid);
                                      }
                                    });
                                  },
                          );
                        },
                      ),
                    ),
                    const SizedBox(height: 10),
                    Wrap(
                      spacing: 8,
                      children: [5, 10, 15, 30]
                          .map(
                            (minutes) => ChoiceChip(
                              label: Text(
                                minutes.toString() + ' د',
                              ),
                              selected: duration == minutes,
                              onSelected: (_) {
                                setSheetState(() => duration = minutes);
                              },
                            ),
                          )
                          .toList(),
                    ),
                    const SizedBox(height: 12),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy
                            ? null
                            : () async {
                                if (!const [2, 4, 6, 8]
                                    .contains(selected.length)) {
                                  ScaffoldMessenger.of(sheetContext)
                                      .showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                        'اختر 2 أو 4 أو 6 أو 8 لاعبين.',
                                      ),
                                    ),
                                  );
                                  return;
                                }
                                await _run(
                                  () => _service.create(
                                    roomId: widget.roomId,
                                    participantUids: selected.toList(),
                                    durationMinutes: duration,
                                  ),
                                );
                                if (sheetContext.mounted && !_busy) {
                                  Navigator.pop(sheetContext);
                                }
                              },
                        style: FilledButton.styleFrom(
                          backgroundColor: const Color(0xFF6D27D9),
                          padding: const EdgeInsets.symmetric(vertical: 13),
                        ),
                        icon: const Icon(Icons.sports_mma_rounded),
                        label: const Text('إرسال تحدي PK'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  String _timerText(RoomPkState pk) {
    final now = DateTime.now().millisecondsSinceEpoch;
    if (pk.status == 'awaiting_acceptance') return 'بانتظار الموافقة';
    if (pk.status == 'countdown') {
      final seconds =
          ((pk.countdownEndsAtMs - now) / 1000).ceil().clamp(0, 3);
      return seconds > 0 ? seconds.toString() : 'ابدأ';
    }
    if (pk.status == 'active') {
      final totalSeconds =
          ((pk.endsAtMs - now) / 1000).ceil().clamp(0, 24 * 60 * 60);
      final minutes = totalSeconds ~/ 60;
      final seconds = totalSeconds % 60;
      return minutes.toString().padLeft(2, '0') +
          ':' +
          seconds.toString().padLeft(2, '0');
    }
    if (pk.status == 'finished') {
      if (pk.winner == 'a') return 'الفريق A فاز';
      if (pk.winner == 'b') return 'الفريق B فاز';
      return 'تعادل';
    }
    if (pk.status == 'cancelled') return 'تم إلغاء PK';
    return '';
  }

  Widget _participant(RoomPkParticipant item) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          CircleAvatar(
            radius: 14,
            backgroundColor: const Color(0xFF25183F),
            backgroundImage: item.profileImageUrl.isEmpty
                ? null
                : NetworkImage(item.profileImageUrl),
            child: item.profileImageUrl.isEmpty
                ? const Icon(
                    Icons.person_rounded,
                    color: Colors.white54,
                    size: 15,
                  )
                : null,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              item.displayName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 10,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          if (item.accepted)
            const Icon(
              Icons.check_circle_rounded,
              size: 14,
              color: Color(0xFF39D98A),
            )
          else
            const Icon(
              Icons.schedule_rounded,
              size: 14,
              color: Colors.white38,
            ),
        ],
      ),
    );
  }

  Widget _team({
    required String title,
    required List<RoomPkParticipant> participants,
    required num score,
    required Color accent,
  }) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: accent.withValues(alpha: .28)),
        ),
        child: Column(
          children: [
            Text(
              title,
              style: TextStyle(
                color: accent,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 5),
            Text(
              score.toString(),
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                fontSize: 18,
              ),
            ),
            const SizedBox(height: 6),
            ...participants.map(_participant),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final roomContext = _context;
    final pk = roomContext?.pk;
    final inactive = pk == null ||
        pk.status == 'finished' ||
        pk.status == 'cancelled';

    if (inactive && !widget.canManage) {
      if (pk == null) return const SizedBox.shrink();
    }

    if (pk == null) {
      return SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          onPressed: _busy ? null : _showCreateSheet,
          icon: const Icon(Icons.sports_mma_rounded),
          label: const Text('بدء PK'),
        ),
      );
    }

    final teamA =
        pk.participants.where((item) => item.team == 'a').toList();
    final teamB =
        pk.participants.where((item) => item.team == 'b').toList();
    final total = pk.scoreA + pk.scoreB;
    final progress = total <= 0 ? .5 : (pk.scoreA / total).toDouble();
    final pendingMe =
        pk.status == 'awaiting_acceptance' &&
        pk.isParticipant(_uid) &&
        !pk.participantAccepted(_uid);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF0D111C),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFFFFD54A).withValues(alpha: .24),
        ),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(
                Icons.sports_mma_rounded,
                color: Color(0xFFFFD54A),
                size: 20,
              ),
              const SizedBox(width: 7),
              Text(
                'PK ' + pk.mode,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
              if (pk.overtimeUsed) ...[
                const SizedBox(width: 6),
                const Text(
                  '• وقت إضافي',
                  style: TextStyle(
                    color: Colors.orangeAccent,
                    fontSize: 10,
                  ),
                ),
              ],
              const Spacer(),
              Text(
                _timerText(pk),
                style: const TextStyle(
                  color: Color(0xFFFFD54A),
                  fontWeight: FontWeight.w900,
                  fontSize: 12,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _team(
                title: 'الفريق A',
                participants: teamA,
                score: pk.scoreA,
                accent: const Color(0xFFBFA5FF),
              ),
              const SizedBox(width: 8),
              _team(
                title: 'الفريق B',
                participants: teamB,
                score: pk.scoreB,
                accent: const Color(0xFFFF8A80),
              ),
            ],
          ),
          const SizedBox(height: 9),
          ClipRRect(
            borderRadius: BorderRadius.circular(99),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 6,
              color: const Color(0xFF8A3DFF),
              backgroundColor: const Color(0xFFB94355),
            ),
          ),
          if (pendingMe) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: _busy
                        ? null
                        : () => _run(
                              () => _service.decline(widget.roomId),
                            ),
                    child: const Text('رفض'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    onPressed: _busy
                        ? null
                        : () => _run(
                              () => _service.accept(widget.roomId),
                            ),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF39A86B),
                    ),
                    child: const Text('قبول'),
                  ),
                ),
              ],
            ),
          ],
          if (pk.supporters.isNotEmpty) ...[
            const SizedBox(height: 10),
            const Align(
              alignment: AlignmentDirectional.centerStart,
              child: Text(
                'Top 3 داعمي الجولة',
                style: TextStyle(
                  color: Colors.white60,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            const SizedBox(height: 5),
            Row(
              children: pk.supporters
                  .take(3)
                  .map(
                    (supporter) => Expanded(
                      child: Column(
                        children: [
                          CircleAvatar(
                            radius: 17,
                            backgroundColor: const Color(0xFF25183F),
                            backgroundImage:
                                supporter.profileImageUrl.isEmpty
                                    ? null
                                    : NetworkImage(
                                        supporter.profileImageUrl,
                                      ),
                            child: supporter.profileImageUrl.isEmpty
                                ? const Icon(
                                    Icons.person_rounded,
                                    size: 15,
                                    color: Colors.white54,
                                  )
                                : null,
                          ),
                          const SizedBox(height: 3),
                          Text(
                            supporter.displayName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 8,
                            ),
                          ),
                          Text(
                            supporter.coins.toString(),
                            style: const TextStyle(
                              color: Color(0xFFFFD54A),
                              fontSize: 8,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                  )
                  .toList(),
            ),
          ],
          if (widget.canManage) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                if (!inactive)
                  Expanded(
                    child: TextButton.icon(
                      onPressed: _busy
                          ? null
                          : () => _run(
                                () => _service.cancel(widget.roomId),
                              ),
                      icon: const Icon(
                        Icons.close_rounded,
                        color: Colors.redAccent,
                      ),
                      label: const Text('إلغاء PK'),
                    ),
                  ),
                if (inactive)
                  Expanded(
                    child: FilledButton.icon(
                      onPressed: _busy ? null : _showCreateSheet,
                      style: FilledButton.styleFrom(
                        backgroundColor: const Color(0xFF6D27D9),
                      ),
                      icon: const Icon(Icons.replay_rounded),
                      label: const Text('PK جديد'),
                    ),
                  ),
              ],
            ),
          ],
          if (pk.scoreA == 0 &&
              pk.scoreB == 0 &&
              (pk.status == 'active' || pk.status == 'countdown')) ...[
            const SizedBox(height: 6),
            const Text(
              'نقاط PK ستُحتسب من هدايا الغرفة عند ربط اقتصاد الهدايا.',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: Colors.white30,
                fontSize: 8,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
