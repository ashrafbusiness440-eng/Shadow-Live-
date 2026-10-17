import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../profile/services/follow_service.dart';
import '../../room/services/room_seat_service.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../services/private_voice_media_client.dart';
import '../services/private_voice_recorder.dart';

/// One voice composer per opened conversation. No per-contact/seat polling.
/// Server-side feature toggle and mutual-follow checks remain authoritative.
class PrivateVoiceNoteControls extends StatefulWidget {
  const PrivateVoiceNoteControls({
    super.key,
    required this.conversationId,
    required this.otherUid,
    required this.accountUid,
    required this.onFeedback,
  });
  final String conversationId;
  final String otherUid;
  final String accountUid;
  final ValueChanged<String> onFeedback;
  @override
  State<PrivateVoiceNoteControls> createState() => _PrivateVoiceNoteControlsState();
}

class _PrivateVoiceNoteControlsState extends State<PrivateVoiceNoteControls> {
  final _recorder = PrivateVoiceRecorder();
  final _client = PrivateVoiceMediaClient();
  final _follow = FollowService();
  AudioPlayer? _player;
  StreamSubscription<Map<String, dynamic>>? _roomSubscription;
  StreamSubscription<User?>? _authSubscription;
  PrivateVoiceDraft? _draft;
  String? _pendingSendKey;
  bool _held = false;
  bool _locked = false;
  bool _recording = false;
  bool _busy = false;
  bool _disposed = false;

  @override
  void initState() {
    super.initState();
    // Exactly one auth subscription for this chat composer; stop the mic
    // immediately when its owning account signs out or changes.
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen((user) {
      if (user?.uid != widget.accountUid && !_disposed) {
        unawaited(_cancel());
      }
    });
  }

  bool get _sameAccount => !_disposed &&
    FirebaseAuth.instance.currentUser?.uid == widget.accountUid;

  Future<bool> _eligibleToRecord() async {
    if (!_sameAccount) return false;
    if (VoiceRoomSessionController.instance.privateCallMediaActive) {
      widget.onFeedback('لا يمكن تسجيل رسالة صوتية أثناء مكالمة خاصة.');
      return false;
    }
    if (!await _follow.isMutual(widget.otherUid)) {
      widget.onFeedback('التسجيل الصوتي يحتاج متابعة متبادلة.');
      return false;
    }
    if (!_sameAccount) return false;
    return _roomMicFree();
  }

  Future<bool> _roomMicFree() async {
    final room = VoiceRoomSessionController.instance;
    if (!room.active && !room.joining) return true;
    final roomId = room.roomId.trim();
    if (roomId.isEmpty) {
      widget.onFeedback('تعذر التحقق من مايك الغرفة. حاول خارج الغرفة.');
      return false;
    }
    final seats = RoomSeatService();
    try {
      final state = await seats.load(roomId);
      if (room.privateCallMediaActive) {
        widget.onFeedback('لا يمكن تسجيل رسالة صوتية أثناء مكالمة خاصة.');
        return false;
      }
      if (!state.isActive || state.seats.any((s) => s.uid == widget.accountUid)) {
        widget.onFeedback('لا يمكن تسجيل رسالة صوتية وأنت على مايك الغرفة.');
        return false;
      }
      return true;
    } catch (_) {
      widget.onFeedback('تعذر التحقق من المايك. حاول مرة أخرى.');
      return false;
    } finally {
      seats.close();
    }
  }

  bool _roomNowHasMic(Map<String, dynamic> state) {
    final raw = state['seats'];
    if (raw is! List) return false;
    return raw.whereType<Map>().any((seat) =>
      (seat['uid'] ?? '').toString() == widget.accountUid);
  }

  Future<void> _start() async {
    if (_busy || _recording || _draft != null || !_sameAccount) return;
    _held = true;
    _pendingSendKey = null;
    setState(() => _busy = true);
    try {
      if (!await _eligibleToRecord() || !_sameAccount || !_held) return;
      await _recorder.start(onLimit: () {
        if (mounted && _recording) unawaited(_stop());
      });
      if (!_sameAccount || (!_held && !_locked) ||
          VoiceRoomSessionController.instance.privateCallMediaActive) {
        await _recorder.cancel();
        return;
      }
      // Single temporary listener only during a recording. No per-message
      // listeners and no network or presence polling.
      _roomSubscription = VoiceRoomSessionController.instance.roomStateEvents.listen((event) {
        if (_roomNowHasMic(event)) unawaited(_cancel(
          'تم إلغاء التسجيل لأنك صرت على مايك الغرفة.'));
      });
      if (mounted) setState(() => _recording = true);
    } catch (_) {
      widget.onFeedback('تعذر تشغيل الميكروفون. تحقق من الإذن وحاول مجدداً.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _stop() async {
    if (!_recording || _busy) return;
    if (VoiceRoomSessionController.instance.privateCallMediaActive) {
      await _cancel('تم إلغاء التسجيل لأنك في مكالمة خاصة.');
      return;
    }
    setState(() { _busy = true; _recording = false; });
    await _roomSubscription?.cancel();
    _roomSubscription = null;
    try {
      final result = await _recorder.stop();
      if (!_sameAccount) return;
      setState(() { _draft = result; _locked = false; });
    } catch (_) {
      widget.onFeedback('تعذر حفظ التسجيل. حاول مجدداً.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel([String? reason]) async {
    _held = false;
    await _roomSubscription?.cancel();
    _roomSubscription = null;
    try { await _recorder.cancel(); } catch (_) {}
    await _player?.stop();
    if (mounted) {
      setState(() {
        _recording = false; _locked = false; _draft = null; _busy = false;
        _pendingSendKey = null;
      });
      if (reason != null) widget.onFeedback(reason);
    }
  }

  Future<void> _preview() async {
    final draft = _draft;
    if (draft == null || _busy) return;
    _player ??= AudioPlayer();
    try {
      await _player!.stop();
      await _player!.play(BytesSource(draft.bytes, mimeType: draft.mimeType));
    } catch (_) {
      widget.onFeedback('تعذر تشغيل معاينة التسجيل.');
    }
  }

  Future<void> _send() async {
    final draft = _draft;
    if (draft == null || _busy || !_sameAccount) return;
    setState(() => _busy = true);
    try {
      if (!await _eligibleToRecord() || !_sameAccount) return;
      await _player?.stop();
      final idempotencyKey = _pendingSendKey ??=
          'voice_${widget.accountUid}_${DateTime.now().microsecondsSinceEpoch}';
      await _client.uploadAndSend(
        senderUid: widget.accountUid,
        otherUid: widget.otherUid,
        conversationId: widget.conversationId,
        draft: draft,
        idempotencyKey: idempotencyKey,
      );
      if (!_sameAccount) return;
      setState(() {
        _draft = null;
        _pendingSendKey = null;
      });
      widget.onFeedback('تم إرسال التسجيل الصوتي.');
    } catch (_) {
      if (_sameAccount) widget.onFeedback('تعذر إرسال التسجيل. احتفظنا به للمحاولة مرة أخرى.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  void dispose() {
    _disposed = true;
    unawaited(_authSubscription?.cancel() ?? Future<void>.value());
    unawaited(_roomSubscription?.cancel() ?? Future<void>.value());
    unawaited(_recorder.dispose());
    if (_player != null) unawaited(_player!.dispose());
    _client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final draft = _draft;
    if (draft != null) {
      return Row(mainAxisSize: MainAxisSize.min, children: [
        IconButton(
          tooltip: 'استمع للتسجيل',
          onPressed: _busy ? null : _preview,
          icon: const Icon(Icons.play_arrow_rounded, color: Color(0xFFBB9FFF)),
        ),
        Text('${draft.durationSeconds}ث',
          style: const TextStyle(color: Colors.white70)),
        IconButton(
          tooltip: 'حذف التسجيل',
          onPressed: _busy ? null : () => _cancel(),
          icon: const Icon(Icons.delete_outline_rounded, color: Colors.white70),
        ),
        IconButton(
          tooltip: 'إرسال التسجيل',
          onPressed: _busy ? null : _send,
          icon: _busy
            ? const SizedBox(width:16,height:16,child:CircularProgressIndicator(strokeWidth:2))
            : const Icon(Icons.send_rounded, color: Color(0xFFFFD54A)),
        ),
      ]);
    }
    if (_recording && _locked) {
      return Row(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.fiber_manual_record_rounded, color: Colors.redAccent, size: 15),
        IconButton(
          tooltip: 'إيقاف التسجيل المثبّت',
          onPressed: _stop,
          icon: const Icon(Icons.stop_circle_outlined, color: Colors.white),
        ),
        IconButton(
          tooltip: 'إلغاء التسجيل',
          onPressed: () => _cancel(),
          icon: const Icon(Icons.close_rounded, color: Colors.redAccent),
        ),
      ]);
    }
    return GestureDetector(
      onLongPressStart: (_) => unawaited(_start()),
      onLongPressMoveUpdate: (details) {
        if (!_recording) return;
        if (details.offsetFromOrigin.dy < -65 && !_locked) {
          setState(() => _locked = true);
        } else if (details.offsetFromOrigin.dx.abs() > 75 && !_locked) {
          unawaited(_cancel('تم إلغاء التسجيل.'));
        }
      },
      onLongPressEnd: (_) {
        _held = false;
        if (_recording && !_locked) unawaited(_stop());
      },
      child: Tooltip(
        message: _recording ? 'اسحب للأعلى للتثبيت أو جانباً للإلغاء' : 'اضغط مطولاً لتسجيل رسالة صوتية',
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 10),
          child: Icon(_recording ? Icons.mic_rounded : Icons.mic_none_rounded,
            color: _recording ? Colors.redAccent : const Color(0xFFB78CFF)),
        ),
      ),
    );
  }
}

class PrivateVoicePlaybackTile extends StatefulWidget {
  const PrivateVoicePlaybackTile({
    super.key, required this.objectId,
    required this.accountUid, required this.durationSeconds,
  });
  final String objectId;
  final String accountUid;
  final int durationSeconds;
  @override
  State<PrivateVoicePlaybackTile> createState() => _PrivateVoicePlaybackTileState();
}
class _PrivateVoicePlaybackTileState extends State<PrivateVoicePlaybackTile> {
  final _client = PrivateVoiceMediaClient();
  AudioPlayer? _player;
  bool _busy = false, _playing = false;
  Future<void> _toggle() async {
    if (_busy || FirebaseAuth.instance.currentUser?.uid != widget.accountUid) return;
    if (_playing) {
      await _player?.stop();
      if (mounted) setState(() => _playing = false);
      return;
    }
    setState(() => _busy = true);
    try {
      final bytes = await _client.read(
        userUid: widget.accountUid, objectId: widget.objectId);
      if (!mounted || FirebaseAuth.instance.currentUser?.uid != widget.accountUid) return;
      _player ??= AudioPlayer();
      await _player!.play(BytesSource(bytes, mimeType:'audio/wav'));
      if (mounted) setState(() => _playing = true);
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر تشغيل الرسالة الصوتية. حاول مجدداً.')));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
  @override
  void dispose() {
    if(_player!=null)unawaited(_player!.dispose());
    _client.dispose();
    super.dispose();
  }
  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize:MainAxisSize.min, children:[
      IconButton(
        tooltip:_playing?'إيقاف الرسالة الصوتية':'تشغيل الرسالة الصوتية',
        onPressed:_busy?null:_toggle,
        icon:_busy
          ? const SizedBox(width:16,height:16,child:CircularProgressIndicator(strokeWidth:2))
          : Icon(_playing?Icons.stop_rounded:Icons.play_arrow_rounded,
              color:const Color(0xFFBB9FFF)),
      ),
      const Icon(Icons.graphic_eq_rounded,color:Colors.white54,size:18),
      const SizedBox(width:10),
      Text('${widget.durationSeconds}ث',
        style: const TextStyle(color:Colors.white70)),
    ],
  );
}
