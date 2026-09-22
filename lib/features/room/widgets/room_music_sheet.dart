import 'dart:async';

import 'package:file_picker/file_picker.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../voice/services/voice_room_session_controller.dart';
import '../services/room_music_service.dart';

class RoomMusicSheet extends StatefulWidget {
  const RoomMusicSheet({
    super.key,
    required this.roomId,
    required this.canManage,
    required this.canManagePolicy,
  });

  final String roomId;
  final bool canManage;
  final bool canManagePolicy;

  @override
  State<RoomMusicSheet> createState() => _RoomMusicSheetState();
}

class _RoomMusicSheetState extends State<RoomMusicSheet> {
  final RoomMusicService _service = RoomMusicService();
  StreamSubscription<RoomMusicSnapshot>? _subscription;

  RoomMusicSnapshot? _snapshot;
  List<PlatformFile> _pending = const [];
  final Set<int> _pendingSelected = <int>{};
  final Set<String> _queueSelected = <String>{};
  bool _busy = false;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  bool get _canAddOrPlay =>
      widget.canManage || (_snapshot?.allowMembers ?? false);

  @override
  void initState() {
    super.initState();
    _subscription = _service.watch(widget.roomId).listen((value) {
      if (!mounted) return;
      setState(() {
        _snapshot = value;
        _queueSelected.removeWhere(
          (id) => !value.queue.any((track) => track.id == id),
        );
      });
    });
  }

  @override
  void dispose() {
    unawaited(_subscription?.cancel());
    _service.close();
    super.dispose();
  }

  String _message(Object error) {
    final code = error is StateError ? error.message.toString() : '';
    switch (code) {
      case 'music_permission_required':
      case 'forbidden':
        return 'ما عندك صلاحية لتنفيذ هذا الإجراء.';
      case 'music_queue_full':
        return 'قائمة الغرفة وصلت للحد الأقصى 50 مقطع.';
      case 'music_track_not_found':
        return 'المقطع لم يعد موجوداً في القائمة.';
      default:
        return 'تعذر تنفيذ عملية الموسيقى حالياً.';
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
          SnackBar(content: Text(_message(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pickAudio() async {
    if (!_canAddOrPlay || _busy) return;
    try {
      final files = await FilePicker.pickFiles(
        type: FileType.audio,
        allowMultiple: true,
      );
      if (!mounted || files.isEmpty) return;
      setState(() {
        _pending = files.take(20).toList(growable: false);
        _pendingSelected
          ..clear()
          ..addAll(
            List<int>.generate(_pending.length, (index) => index),
          );
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تعذر فتح ملفات الصوت على هذا الجهاز.'),
          ),
        );
      }
    }
  }

  String _cleanTitle(String name) {
    final dot = name.lastIndexOf('.');
    return dot > 0 ? name.substring(0, dot) : name;
  }

  Future<void> _addSelectedFiles() async {
    if (_busy || _pendingSelected.isEmpty || !_canAddOrPlay) return;
    setState(() => _busy = true);
    var added = 0;
    var skipped = 0;
    try {
      final indices = _pendingSelected.toList()..sort();
      for (final index in indices) {
        if (index < 0 || index >= _pending.length) continue;
        final file = _pending[index];
        final length = file.lengthSync() ?? await file.length();
        if (length == null || length <= 0 || length > 30 * 1024 * 1024) {
          skipped++;
          continue;
        }
        final bytes = await file.readAsBytes();
        final track = await _service.addTrack(
          roomId: widget.roomId,
          title: _cleanTitle(file.name),
        );
        VoiceRoomSessionController.instance.registerRoomMusicTrack(
          track.id,
          bytes,
        );
        added++;
      }
      if (!mounted) return;
      setState(() {
        _pending = const [];
        _pendingSelected.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تمت إضافة ' +
                added.toString() +
                ' مقطع' +
                (skipped > 0
                    ? ' — تم تجاهل ' +
                        skipped.toString() +
                        ' ملف أكبر من 30MB أو غير صالح.'
                    : '.'),
          ),
        ),
      );
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_message(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _removeSelected() async {
    if (_busy || _queueSelected.isEmpty) return;
    final ids = _queueSelected.toList();
    await _run(() async {
      for (final id in ids) {
        await _service.removeTrack(
          roomId: widget.roomId,
          trackId: id,
        );
        VoiceRoomSessionController.instance.unregisterRoomMusicTrack(id);
      }
      if (mounted) setState(() => _queueSelected.clear());
    });
  }

  bool _canDelete(RoomMusicTrack track) =>
      widget.canManage || track.sourceOwnerUid == _uid;

  Future<void> _play(RoomMusicTrack track) async {
    final localOwner = track.sourceOwnerUid == _uid;
    final controller = VoiceRoomSessionController.instance;
    if (localOwner && !controller.hasLocalRoomMusicTrack(track.id)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'هذا الملف لم يعد محملاً محلياً. أضفه من الجهاز من جديد.',
          ),
        ),
      );
      return;
    }
    await _run(
      () => _service.play(
        roomId: widget.roomId,
        trackId: track.id,
      ),
    );
  }

  Widget _currentTrack() {
    final snapshot = _snapshot;
    final track = snapshot?.currentTrack;
    if (snapshot == null ||
        snapshot.status != 'playing' ||
        track == null) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF151A26),
          borderRadius: BorderRadius.circular(16),
        ),
        child: const Row(
          children: [
            Icon(Icons.music_off_rounded, color: Colors.white38),
            SizedBox(width: 8),
            Text(
              'لا يوجد مقطع يعمل الآن',
              style: TextStyle(color: Colors.white54),
            ),
          ],
        ),
      );
    }

    final canStop =
        widget.canManage || track.sourceOwnerUid == _uid;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF6D27D9).withValues(alpha: .12),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: const Color(0xFF8A3DFF).withValues(alpha: .34),
        ),
      ),
      child: Row(
        children: [
          const CircleAvatar(
            backgroundColor: Color(0xFF6D27D9),
            child: Icon(
              Icons.graphic_eq_rounded,
              color: Colors.white,
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  track.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                Text(
                  'المصدر: ' + track.sourceOwnerName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 9,
                  ),
                ),
              ],
            ),
          ),
          if (widget.canManage)
            IconButton(
              onPressed: _busy
                  ? null
                  : () => _run(
                        () => _service.skip(widget.roomId),
                      ),
              icon: const Icon(Icons.skip_next_rounded),
              tooltip: 'التالي',
            ),
          if (canStop)
            IconButton(
              onPressed: _busy
                  ? null
                  : () => _run(
                        () => _service.stop(widget.roomId),
                      ),
              icon: const Icon(
                Icons.stop_circle_rounded,
                color: Colors.redAccent,
              ),
              tooltip: 'إيقاف',
            ),
        ],
      ),
    );
  }

  Widget _queueTab() {
    final snapshot = _snapshot;
    if (snapshot == null) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
      );
    }

    return Column(
      children: [
        _currentTrack(),
        const SizedBox(height: 10),
        if (widget.canManagePolicy)
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: snapshot.allowMembers,
            activeThumbColor: Colors.white,
            activeTrackColor: const Color(0xFF6D27D9),
            title: const Text(
              'السماح للأعضاء بتشغيل الموسيقى',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                fontSize: 12,
              ),
            ),
            subtitle: const Text(
              'المشرفون يحتفظون بحق الإيقاف والتخطي والحذف.',
              style: TextStyle(color: Colors.white38, fontSize: 9),
            ),
            onChanged: _busy
                ? null
                : (value) => _run(
                      () => _service.setAllowMembers(
                        roomId: widget.roomId,
                        value: value,
                      ),
                    ),
          ),
        Row(
          children: [
            TextButton(
              onPressed: snapshot.queue.isEmpty
                  ? null
                  : () {
                      final deletable = snapshot.queue
                          .where(_canDelete)
                          .map((track) => track.id)
                          .toSet();
                      setState(() {
                        if (_queueSelected.length == deletable.length &&
                            _queueSelected.containsAll(deletable)) {
                          _queueSelected.clear();
                        } else {
                          _queueSelected
                            ..clear()
                            ..addAll(deletable);
                        }
                      });
                    },
              child: const Text('تحديد الكل'),
            ),
            const Spacer(),
            if (_queueSelected.isNotEmpty)
              TextButton.icon(
                onPressed: _busy ? null : _removeSelected,
                icon: const Icon(
                  Icons.delete_outline_rounded,
                  color: Colors.redAccent,
                ),
                label: const Text('حذف المحدد'),
              ),
            if (widget.canManage && snapshot.queue.isNotEmpty)
              TextButton(
                onPressed: _busy
                    ? null
                    : () => _run(
                          () => _service.clearQueue(widget.roomId),
                        ),
                child: const Text('تفريغ القائمة'),
              ),
          ],
        ),
        Expanded(
          child: snapshot.queue.isEmpty
              ? const Center(
                  child: Text(
                    'قائمة الموسيقى فارغة',
                    style: TextStyle(color: Colors.white54),
                  ),
                )
              : ListView.separated(
                  itemCount: snapshot.queue.length,
                  separatorBuilder: (_, __) =>
                      const Divider(color: Colors.white10),
                  itemBuilder: (_, index) {
                    final track = snapshot.queue[index];
                    final playing =
                        snapshot.currentTrackId == track.id &&
                            snapshot.status == 'playing';
                    final canDelete = _canDelete(track);
                    return ListTile(
                      contentPadding: EdgeInsets.zero,
                      leading: canDelete
                          ? Checkbox(
                              value: _queueSelected.contains(track.id),
                              activeColor: const Color(0xFF6D27D9),
                              onChanged: (value) {
                                setState(() {
                                  if (value == true) {
                                    _queueSelected.add(track.id);
                                  } else {
                                    _queueSelected.remove(track.id);
                                  }
                                });
                              },
                            )
                          : const Icon(
                              Icons.music_note_rounded,
                              color: Colors.white38,
                            ),
                      title: Text(
                        track.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          color: playing
                              ? const Color(0xFFFFD54A)
                              : Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      subtitle: Text(
                        'أضافه ' + track.sourceOwnerName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white38,
                          fontSize: 9,
                        ),
                      ),
                      trailing: IconButton(
                        onPressed: !_canAddOrPlay ||
                                _busy ||
                                (!widget.canManage &&
                                    track.sourceOwnerUid != _uid)
                            ? null
                            : () => _play(track),
                        icon: Icon(
                          playing
                              ? Icons.graphic_eq_rounded
                              : Icons.play_circle_fill_rounded,
                          color: playing
                              ? const Color(0xFFFFD54A)
                              : const Color(0xFFBFA5FF),
                        ),
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _addTab() {
    return Column(
      children: [
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _canAddOrPlay && !_busy ? _pickAudio : null,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF6D27D9),
            ),
            icon: const Icon(Icons.audio_file_rounded),
            label: const Text('اختيار ملفات صوت من الجهاز'),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'الحد الأقصى للمقطع 30MB. الملف يبقى على جهاز صاحبه ولا يُرفع إلى Firebase.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white38, fontSize: 9),
        ),
        const SizedBox(height: 10),
        if (_pending.isNotEmpty)
          Row(
            children: [
              TextButton(
                onPressed: () {
                  setState(() {
                    if (_pendingSelected.length == _pending.length) {
                      _pendingSelected.clear();
                    } else {
                      _pendingSelected
                        ..clear()
                        ..addAll(
                          List<int>.generate(
                            _pending.length,
                            (index) => index,
                          ),
                        );
                    }
                  });
                },
                child: const Text('تحديد الكل'),
              ),
              const Spacer(),
              Text(
                _pendingSelected.length.toString() +
                    '/' +
                    _pending.length.toString(),
                style: const TextStyle(color: Colors.white54),
              ),
            ],
          ),
        Expanded(
          child: _pending.isEmpty
              ? Center(
                  child: Text(
                    _canAddOrPlay
                        ? 'اختر ملفات الصوت ثم حدد ما تريد إضافته.'
                        : 'تشغيل الموسيقى متاح لصاحب الغرفة والمشرفين فقط.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white54),
                  ),
                )
              : ListView.builder(
                  itemCount: _pending.length,
                  itemBuilder: (_, index) {
                    final file = _pending[index];
                    return CheckboxListTile(
                      value: _pendingSelected.contains(index),
                      activeColor: const Color(0xFF6D27D9),
                      secondary: const Icon(
                        Icons.music_note_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      title: Text(
                        file.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(color: Colors.white),
                      ),
                      onChanged: (value) {
                        setState(() {
                          if (value == true) {
                            _pendingSelected.add(index);
                          } else {
                            _pendingSelected.remove(index);
                          }
                        });
                      },
                    );
                  },
                ),
        ),
        if (_pending.isNotEmpty)
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _busy || _pendingSelected.isEmpty
                  ? null
                  : _addSelectedFiles,
              style: FilledButton.styleFrom(
                backgroundColor: const Color(0xFF39A86B),
              ),
              icon: _busy
                  ? const SizedBox(
                      width: 17,
                      height: 17,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white,
                      ),
                    )
                  : const Icon(Icons.add_rounded),
              label: const Text('إضافة المحدد إلى القائمة'),
            ),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
            child: DefaultTabController(
              length: 2,
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
                        Icons.library_music_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      SizedBox(width: 8),
                      Text(
                        'موسيقى الغرفة',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  const TabBar(
                    indicatorColor: Color(0xFF8A3DFF),
                    labelColor: Colors.white,
                    unselectedLabelColor: Colors.white38,
                    tabs: [
                      Tab(text: 'القائمة'),
                      Tab(text: 'إضافة أغاني'),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Expanded(
                    child: TabBarView(
                      children: [
                        _queueTab(),
                        _addTab(),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
