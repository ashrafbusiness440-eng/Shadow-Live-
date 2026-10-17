import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../services/private_call_signaling_client.dart';

/// The notification bell opens this UI only when the user taps the call.
/// Calls are still disabled in production until all acceptance tests pass.
class PrivateCallIncomingDialog extends StatefulWidget {
  const PrivateCallIncomingDialog({
    super.key,
    required this.accountUid,
    required this.callId,
    required this.callerName,
  });
  final String accountUid, callId, callerName;
  @override
  State<PrivateCallIncomingDialog> createState() => _PrivateCallIncomingDialogState();
}

class _PrivateCallIncomingDialogState extends State<PrivateCallIncomingDialog> {
  final _client = PrivateCallSignalingClient();
  final _voice = VoiceRoomSessionController.instance;
  Timer? _timer;
  StreamSubscription<User?>? _auth;
  String _status = 'loading';
  String? _error;
  bool _busy = false, _active = false, _checking = false, _closing = false;
  int _ticks = 0, _errors = 0, _deadlineRefreshes = 0;

  bool get _sameUser =>
      mounted && FirebaseAuth.instance.currentUser?.uid == widget.accountUid;
  bool get _terminal => const {
    'missed', 'rejected', 'completed', 'cancelled', 'interrupted',
  }.contains(_status);

  @override
  void initState() {
    super.initState();
    _auth = FirebaseAuth.instance.authStateChanges().listen((user) {
      if (!mounted || user?.uid == widget.accountUid) return;
      _timer?.cancel();
      unawaited(_voice.exitPrivateCallMedia());
      Navigator.of(context).pop();
    });
    unawaited(_load());
  }

  Future<void> _load() async {
    if (!_sameUser || _busy) return;
    setState(() => _busy = true);
    try {
      final state = await _client.get(
        actorUid: widget.accountUid, callId: widget.callId,
      );
      if (!_sameUser || _closing) return;
      setState(() { _status = state.status; _error = null; });
      if (state.status == 'ringing' && state.ringDeadlineMs > 0 &&
          _deadlineRefreshes < 2) {
        // Device time may be incorrect: never spin in a 100ms loop while
        // waiting for the 30-second server-authoritative ring deadline.
        _deadlineRefreshes++;
        final delay = state.ringDeadlineMs -
            DateTime.now().millisecondsSinceEpoch + 300;
        _timer?.cancel();
        _timer = Timer(Duration(milliseconds: delay.clamp(2000, 30000).toInt()),
            () { if (_sameUser) unawaited(_load()); });
      }
    } catch (_) {
      if (_sameUser) {
        setState(() {
          _status = 'error';
          _error = 'تعذر فتح المكالمة. تحقق من الشبكة أو ربما انتهى الرنين.';
        });
      }
    } finally {
      if (_sameUser) setState(() => _busy = false);
    }
  }

  Future<void> _respond(bool accept) async {
    if (_busy || !_sameUser || _status != 'ringing') return;
    setState(() => _busy = true);
    _timer?.cancel();
    try {
      final state = await _client.respond(
        actorUid: widget.accountUid, callId: widget.callId,
        accept: accept,
      );
      if (!_sameUser || _closing) return;
      if (!accept || state.status != 'active') {
        setState(() => _status = state.status);
        return;
      }
      final media = await _client.mediaSession(
        actorUid: widget.accountUid, callId: widget.callId,
      );
      if (!_sameUser || _closing) return;
      // The public room is left AFTER accepting, never on incoming ring.
      await _voice.enterPrivateCallMedia(
        actorUid: widget.accountUid, credentials: media,
        displayName: widget.callerName,
      );
      if (!_sameUser || _closing) {
        await _voice.exitPrivateCallMedia();
        return;
      }
      _active = true;
      _ticks = 0;
      setState(() => _status = 'active');
      _timer = Timer.periodic(const Duration(seconds: 12),
          (_) { if (!_closing) unawaited(_check()); });
    } catch (_) {
      await _voice.exitPrivateCallMedia();
      if (_sameUser) {
        try {
          await _client.finish(
            actorUid: widget.accountUid, callId: widget.callId,
          );
        } catch (_) {}
        setState(() {
          _status = 'error';
          _error = 'تعذر قبول المكالمة أو تشغيل الصوت. تم إيقاف المحاولة.';
        });
      }
    } finally {
      if (_sameUser) setState(() => _busy = false);
    }
  }

  Future<void> _check() async {
    if (_checking || _busy || !_active || !_sameUser) return;
    _checking = true;
    try {
      final result = await _client.get(
        actorUid: widget.accountUid, callId: widget.callId,
      );
      if (!_sameUser || _closing) return;
      _errors = 0;
      if (result.terminal) {
        _timer?.cancel();
        await _voice.exitPrivateCallMedia();
        _active = false;
        if (mounted) setState(() => _status = result.status);
      } else if (++_ticks % 4 == 0) {
        final renewed = await _client.renew(
          actorUid: widget.accountUid, callId: widget.callId,
        );
        if (renewed.status != 'active') {
          _timer?.cancel();
          await _voice.exitPrivateCallMedia();
          _active = false;
          if (mounted) setState(() => _status = renewed.status);
        }
      }
    } catch (_) {
      if (_sameUser && ++_errors >= 2) {
        _timer?.cancel();
        await _voice.exitPrivateCallMedia();
        _active = false;
        if (mounted) setState(() {
          _status = 'interrupted';
          _error = 'انقطع الاتصال. أوقفنا الصوت لحماية خصوصيتك.';
        });
      }
    } finally { _checking = false; }
  }

  Future<void> _end() async {
    if (_closing) return;
    _closing = true;
    _timer?.cancel();
    await _voice.exitPrivateCallMedia();
    // A second device may see a call already answered on the first.
    // Dismissing this notification must not terminate that live device.
    if (_sameUser && !_terminal &&
        !(_status == 'active' && !_active) &&
        !(_status == 'error' && !_active)) {
      try {
        await _client.finish(
          actorUid: widget.accountUid, callId: widget.callId,
        ).timeout(const Duration(seconds: 8));
      } catch (_) {
        _closing = false;
        if (mounted) setState(() {
          _error = 'توقف الصوت، لكن تعذر تأكيد إنهاء المكالمة. حاول مجددًا.';
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
    if (_active) unawaited(_voice.exitPrivateCallMedia());
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
        title: const Text('مكالمة صوتية واردة',
          style: TextStyle(color: Colors.white)),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.ring_volume_rounded, size: 48,
              color: Color(0xFFFFD54A)),
          const SizedBox(height: 12),
          Text(widget.callerName,
              style: const TextStyle(color: Colors.white)),
          const SizedBox(height: 12),
          Text(switch (_status) {
            'ringing' => 'يريد الاتصال بك',
            'active' => _active ? 'المكالمة متصلة' : 'المكالمة بدأت مسبقًا',
            'missed' => 'مكالمة فائتة',
            'rejected' => 'تم رفض المكالمة',
            'completed' => 'انتهت المكالمة',
            'cancelled' => 'ألغى الطرف الآخر المكالمة',
            'interrupted' => 'انقطعت المكالمة',
            'error' => 'المكالمة غير متاحة',
            _ => 'جارٍ التحقق من المكالمة...',
          }, style: const TextStyle(color: Colors.white70)),
          if (_error != null) Text(_error!,
              style: const TextStyle(color: Colors.orangeAccent)),
          if (_busy) const Padding(padding: EdgeInsets.all(10),
              child: CircularProgressIndicator(strokeWidth: 2)),
        ]),
        actions: [
          if (_status == 'ringing' && !_busy) ...[
            OutlinedButton(onPressed: () => _respond(false),
                child: const Text('رفض')),
            FilledButton(onPressed: () => _respond(true),
                child: const Text('قبول')),
          ],
          if (_status == 'error' && !_active)
            TextButton(onPressed: _busy ? null : _load,
                child: const Text('إعادة المحاولة')),
          TextButton(onPressed: _closing ? null : _end,
            child: Text(_terminal ? 'إغلاق' : 'إنهاء المكالمة')),
        ],
      ),
    ),
  );
}
