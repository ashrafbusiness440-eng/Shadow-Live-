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
  Future<void>? _startInFlight;
  late final String _key;
  String? _callId;
  String _status = 'connecting';
  String? _message;
  bool _busy = false, _checking = false, _connected = false, _closing = false;
  bool _joiningMedia = false;
  bool _localAudioCleanupFailed = false;
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
    _launchStart();
  }

  void _launchStart() {
    // Track each explicit retry, not only the initial attempt, so closing
    // during an HTTP retry cannot orphan a live ringing invitation.
    final pending = _start();
    _startInFlight = pending;
    unawaited(pending);
  }

  Future<void> _start() async {
    if (_busy || !_sameAccount || _callId != null) return;
    setState(() { _busy = true; _message = null; });
    try {
      final state = await _client.start(
        actorUid: widget.accountUid, otherUid: widget.otherUid,
        conversationId: widget.conversationId, idempotencyKey: _key,
      );
      if (!_sameAccount) return;
      // Even after a user requested hangup, retain the authoritative call ID
      // so the in-flight start can be cancelled on the server exactly once.
      _callId = state.callId;
      if (_closing) return;
      setState(() => _status = state.status);
      if (state.status == 'active') {
        await _joinMedia();
      } else if (!_terminal) {
        _watch(const Duration(seconds: 3));
      }
    } on PrivateCallSignalingException catch (error) {
      if (_sameAccount) setState(() {
        _status = 'error';
        _message = switch (error.code) {
          'private_calls_not_ready' || 'private_calls_disabled' =>
            'المكالمات الخاصة غير متاحة حاليًا.',
          'call_busy' => 'المستخدم مشغول بمكالمة أخرى.',
          'mutual_follow_required' =>
            'المكالمة تتطلب متابعة متبادلة بين الطرفين.',
          'blocked' || 'calls_not_allowed' =>
            'إعدادات الخصوصية لا تسمح بالمكالمة.',
          'call_rate_limited' =>
            'انتظر قليلًا قبل الاتصال مرة أخرى.',
          'registered_account_required' =>
            'يرجى تسجيل الدخول بحسابك قبل الاتصال.',
          _ => 'تعذر إجراء المكالمة. تحقق من الشبكة وحاول مجددًا.',
        };
      });
    } catch (_) {
      if (_sameAccount) setState(() {
        _status = 'error';
        _message = 'تعذر إجراء المكالمة. تحقق من الشبكة وحاول مجددًا.';
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
    if (!_sameAccount || _joiningMedia || _connected || id == null) return;
    _joiningMedia = true;
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
      _joiningMedia = false;
      _busy = false;
    }
  }

  Future<void> _end() async {
    if (_closing) return;
    _closing = true;
    _timer?.cancel();
    // A tap during start must not dismiss the dialog before the Worker
    // returns the call ID: that would leave a ringing invitation orphaned.
    // Wait once for the already-bounded request; no extra retries/listeners.
    final starting = _startInFlight;
    if (_callId == null && starting != null) {
      try {
        await starting.timeout(const Duration(seconds: 17));
      } catch (_) {}
    }
    // Do not strand the server call when native ZEGO cleanup throws.
    try {
      await _voice.exitPrivateCallMedia();
    } catch (_) {
      _localAudioCleanupFailed = true;
    }
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
    if (_localAudioCleanupFailed) {
      // Preserve the native-cleanup failure, even if a later local no-op
      // exit returns successfully after controller state was already reset.
      _closing = false;
      if (mounted) setState(() {
        _message = 'تم إرسال إنهاء المكالمة، لكن تعذر تأكيد توقف الصوت على جهازك. '
            'أغلق التطبيق وافتحه مجددًا قبل أي مكالمة أخرى.';
      });
      return;
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
            TextButton(onPressed: _busy ? null : _launchStart,
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
