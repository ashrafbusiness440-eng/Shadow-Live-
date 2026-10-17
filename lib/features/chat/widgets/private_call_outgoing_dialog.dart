import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../services/private_call_signaling_client.dart';

/// Outgoing 1:1 call, only mounted when system_config enables private calls.
/// Server gate stays closed until the complete release is approved.
class PrivateCallOutgoingDialog extends StatefulWidget {
  const PrivateCallOutgoingDialog({
    super.key,
    required this.accountUid,
    required this.otherUid,
    required this.conversationId,
    required this.otherName,
  });
  final String accountUid, otherUid, conversationId, otherName;

  @override
  State<PrivateCallOutgoingDialog> createState() => _PrivateCallOutgoingDialogState();
}

class _PrivateCallOutgoingDialogState extends State<PrivateCallOutgoingDialog> {
  final _client = PrivateCallSignalingClient();
  final _voice = VoiceRoomSessionController.instance;
  Timer? _timer;
  StreamSubscription<User?>? _auth;
  late final String _key;
  String? _callId;
  String _status = 'connecting';
  String? _message;
  bool _busy = false, _checking = false, _connected = false, _closing = false;
  int _ticks = 0, _failures = 0;

  bool get _sameAccount =>
      mounted && FirebaseAuth.instance.currentUser?.uid == widget.accountUid;
  bool get _terminal => const {
    'missed', 'completed', 'cancelled', 'rejected', 'interrupted',
  }.contains(_status);

  @override
  void initState() {
    super.initState();
    _key = 'call_${DateTime.now().microsecondsSinceEpoch}';
    _auth = FirebaseAuth.instance.authStateChanges().listen((user) {
      if (!mounted || user?.uid == widget.accountUid) return;
      _timer?.cancel();
      unawaited(_voice.exitPrivateCallMedia());
      Navigator.of(context).pop();
    });
    unawaited(_start());
  }

  Future<void> _start() async {
    if (_busy || !_sameAccount || _callId != null) return;
    setState(() { _busy = true; _message = null; });
    try {
      final state = await _client.start(
        actorUid: widget.accountUid, otherUid: widget.otherUid,
        conversationId: widget.conversationId, idempotencyKey: _key,
      );
      if (!_sameAccount || _closing) return;
      _callId = state.callId;
      setState(() => _status = state.status);
      if (state.status == 'active') {
        await _joinMedia();
      } else if (!_terminal) {
        _watch(const Duration(seconds: 3));
      }
    } catch (_) {
      if (_sameAccount) setState(() {
        _status = 'error';
        _message = 'تعذر إجراء المكالمة. تحقق من المتابعة والخصوصية والاتصال.';
      });
    } finally {
      if (_sameAccount) setState(() => _busy = false);
    }
  }

  void _watch(Duration interval) {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) {
      if (!_closing) unawaited(_check());
    });
  }

  Future<void> _check() async {
    final callId = _callId;
    if (!_sameAccount || _checking || _busy || callId == null || _terminal) {
      return;
    }
    _checking = true;
    try {
      final state = await _client.get(
        actorUid: widget.accountUid, callId: callId,
      );
      if (!_sameAccount || _closing || _callId != callId) return;
      _failures = 0;
      if (state.terminal) {
        _timer?.cancel();
        await _voice.exitPrivateCallMedia();
        _connected = false;
        if (mounted) setState(() => _status = state.status);
      } else if (state.status == 'active' && !_connected) {
        await _joinMedia();
      } else if (state.status == 'active' && ++_ticks % 4 == 0) {
        final renewed = await _client.renew(
          actorUid: widget.accountUid, callId: callId,
        );
        if (renewed.status != 'active') {
          _timer?.cancel();
          await _voice.exitPrivateCallMedia();
          _connected = false;
          if (mounted) setState(() => _status = renewed.status);
        }
      }
    } catch (_) {
      if (_sameAccount && ++_failures >= 2) {
        _timer?.cancel();
        await _voice.exitPrivateCallMedia();
        _connected = false;
        if (mounted) setState(() {
          _status = 'interrupted';
          _message = 'فُقد الاتصال بالشبكة. تم إيقاف الصوت لحمايتك.';
        });
      }
    } finally {
      _checking = false;
    }
  }

  Future<void> _joinMedia() async {
    final id = _callId;
    if (!_sameAccount || _busy || _connected || id == null) return;
    _busy = true;
    try {
      final media = await _client.mediaSession(
        actorUid: widget.accountUid, callId: id,
      );
      if (!_sameAccount || _closing) return;
      await _voice.enterPrivateCallMedia(
        actorUid: widget.accountUid, credentials: media,
        displayName: widget.otherName,
      );
      if (!_sameAccount || _closing) {
        await _voice.exitPrivateCallMedia();
        return;
      }
      _connected = true;
      _ticks = 0;
      if (mounted) setState(() => _status = 'active');
      _watch(const Duration(seconds: 12));
    } catch (_) {
      await _voice.exitPrivateCallMedia();
      if (_sameAccount) {
        try {
          await _client.finish(actorUid: widget.accountUid, callId: id);
        } catch (_) {}
        _timer?.cancel();
        if (mounted) setState(() {
          _status = 'interrupted';
          _message = 'تعذر تشغيل الصوت. انتهت محاولة المكالمة.';
        });
      }
    } finally {
      _busy = false;
    }
  }

  Future<void> _end() async {
    if (_closing) return;
    _closing = true;
    _timer?.cancel();
    await _voice.exitPrivateCallMedia();
    if (_callId != null && !_terminal && _sameAccount) {
      try {
        await _client.finish(
          actorUid: widget.accountUid, callId: _callId!,
        ).timeout(const Duration(seconds: 8));
      } catch (_) {
        _closing = false;
        if (mounted) setState(() {
          _message = 'توقف الصوت، لكن تعذر تأكيد إنهاء المكالمة. حاول ثانية.';
        });
        return;
      }
    }
    if (mounted) Navigator.of(context).pop();
  }

  @override
  void dispose() {
    _timer?.cancel();
    unawaited(_auth?.cancel() ?? Future<void>.value());
    if (_connected) unawaited(_voice.exitPrivateCallMedia());
    _client.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: WillPopScope(
      onWillPop: () async { await _end(); return false; },
      child: AlertDialog(
        backgroundColor: const Color(0xFF14172A),
        title: const Text('مكالمة صوتية', style: TextStyle(color: Colors.white)),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.call_rounded, color: Color(0xFFFFD54A), size: 48),
          const SizedBox(height: 10),
          Text(widget.otherName, style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 12),
          Text(switch (_status) {
            'ringing' => 'جارٍ الاتصال وانتظار الرد...',
            'active' => 'المكالمة متصلة',
            'missed' => 'لم يتم الرد',
            'rejected' => 'تم رفض المكالمة',
            'completed' => 'انتهت المكالمة',
            'cancelled' => 'تم إلغاء المكالمة',
            'interrupted' => 'انقطع الاتصال',
            'error' => 'المكالمة غير متاحة',
            _ => 'جارٍ بدء المكالمة...',
          }, style: const TextStyle(color: Colors.white70)),
          if (_message != null) Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_message!, style: const TextStyle(color: Colors.orangeAccent)),
          ),
          if (_busy) const Padding(
            padding: EdgeInsets.all(12),
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ]),
        actions: [
          if (_status == 'error' && _callId == null)
            TextButton(onPressed: _busy ? null : _start,
              child: const Text('إعادة المحاولة')),
          FilledButton.icon(
            onPressed: _closing ? null : _end,
            icon: const Icon(Icons.call_end),
            label: Text(_terminal ? 'إغلاق' : 'إنهاء المكالمة'),
          ),
        ],
      ),
    ),
  );
}
