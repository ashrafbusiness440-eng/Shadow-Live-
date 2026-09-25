import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../../shared/services/storage_service.dart';
import '../../voice/services/voice_room_session_controller.dart';

class AccountEnforcementHost extends StatefulWidget {
  const AccountEnforcementHost({super.key, required this.child});

  final Widget child;

  @override
  State<AccountEnforcementHost> createState() => _AccountEnforcementHostState();
}

class _AccountNotice {
  const _AccountNotice({
    required this.title,
    required this.message,
    required this.icon,
  });

  final String title;
  final String message;
  final IconData icon;
}

class _AccountEnforcementHostState extends State<AccountEnforcementHost> {
  StreamSubscription<User?>? _authSubscription;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _userSubscription;
  _AccountNotice? _notice;
  int? _lastRevokedMs;
  int _sessionAuthTimeSeconds = 0;
  String? _activeAuthUid;
  bool _handling = false;

  @override
  void initState() {
    super.initState();
    _activeAuthUid = FirebaseAuth.instance.currentUser?.uid;
    _authSubscription = FirebaseAuth.instance.authStateChanges().listen(
      _handleAuthUser,
    );
    unawaited(_bindUser(FirebaseAuth.instance.currentUser));
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    _userSubscription?.cancel();
    super.dispose();
  }

  void _handleAuthUser(User? user) {
    if (_handling) return;
    final nextUid = user?.uid;
    final previousUid = _activeAuthUid;

    if (previousUid != null &&
        nextUid != null &&
        previousUid != nextUid) {
      _showNotice(
        const _AccountNotice(
          title: 'تم إيقاف الجلسة لحماية الحساب',
          message:
              'تم اكتشاف تبديل مفاجئ في هوية الحساب. لن يسمح Shadow Live '
              'بالانتقال تلقائيًا إلى حساب آخر. اضغط موافق ثم سجّل الدخول '
              'بالحساب الذي تريد استخدامه.',
          icon: Icons.security_rounded,
        ),
      );
      return;
    }

    _activeAuthUid = nextUid;
    unawaited(_bindUser(user));
  }

  Future<void> _bindUser(User? user) async {
    await _userSubscription?.cancel();
    _userSubscription = null;
    _lastRevokedMs = null;

    if (user == null || user.isAnonymous || _handling) return;

    try {
      final token = await user.getIdTokenResult();
      final rawAuthTime = token.claims?['auth_time'];
      _sessionAuthTimeSeconds = rawAuthTime is num
          ? rawAuthTime.toInt()
          : int.tryParse('$rawAuthTime') ??
              DateTime.now().millisecondsSinceEpoch ~/ 1000;
    } catch (_) {
      _sessionAuthTimeSeconds =
          DateTime.now().millisecondsSinceEpoch ~/ 1000;
    }

    _userSubscription = FirebaseFirestore.instance
        .collection('users')
        .doc(user.uid)
        .snapshots()
        .listen(
      _handleUserSnapshot,
      onError: (_) {},
    );
  }

  DateTime? _date(dynamic value) {
    if (value is Timestamp) return value.toDate();
    if (value is DateTime) return value;
    if (value == null) return null;
    return DateTime.tryParse(value.toString());
  }

  String _formatDate(DateTime value) {
    final local = value.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');
    return two(local.day) +
        '/' +
        two(local.month) +
        '/' +
        local.year.toString() +
        ' ' +
        two(local.hour) +
        ':' +
        two(local.minute);
  }

  void _handleUserSnapshot(DocumentSnapshot<Map<String, dynamic>> snapshot) {
    if (!snapshot.exists || _handling) return;
    final data = snapshot.data() ?? const <String, dynamic>{};
    final status = (data['accountStatus'] ?? 'active').toString();
    final reason = (data['moderationReason'] ?? '').toString().trim();
    final suspendedUntil = _date(data['suspendedUntil']);
    final revokedAt = _date(data['sessionsRevokedAt']);
    final revokedMs = revokedAt?.millisecondsSinceEpoch;

    if (status == 'suspended') {
      final untilText = suspendedUntil == null
          ? ''
          : '\nمدة التعليق حتى: ' + _formatDate(suspendedUntil);
      _showNotice(
        _AccountNotice(
          title: 'تم تعليق حسابك مؤقتًا',
          message:
              'تم تعليق حسابك مؤقتًا بواسطة إدارة Shadow Live.' +
              untilText +
              (reason.isEmpty ? '' : '\nالسبب: ' + reason),
          icon: Icons.timer_off_outlined,
        ),
      );
      return;
    }

    if (status == 'banned') {
      _showNotice(
        _AccountNotice(
          title: 'تم حظر حسابك بشكل دائم',
          message:
              'تم حظر هذا الحساب بشكل دائم بواسطة إدارة Shadow Live.' +
              (reason.isEmpty ? '' : '\nالسبب: ' + reason),
          icon: Icons.block,
        ),
      );
      return;
    }

    if (status == 'disabled') {
      _showNotice(
        _AccountNotice(
          title: 'تم تعطيل حسابك',
          message:
              'تم تعطيل هذا الحساب بواسطة إدارة Shadow Live.' +
              (reason.isEmpty ? '' : '\nالسبب: ' + reason),
          icon: Icons.pause_circle_outline,
        ),
      );
      return;
    }

    if (status == 'deleted') {
      _showNotice(
        _AccountNotice(
          title: 'تم حذف الحساب',
          message:
              'تم حذف هذا الحساب من Shadow Live.' +
              (reason.isEmpty ? '' : '\nالسبب: ' + reason),
          icon: Icons.delete_forever_outlined,
        ),
      );
      return;
    }

    if (revokedMs != null) {
      final previous = _lastRevokedMs;
      final revokedSeconds = revokedMs ~/ 1000;
      _lastRevokedMs = revokedMs;
      final changedWhileOpen = previous != null && previous != revokedMs;
      final newerThanSession = revokedSeconds > _sessionAuthTimeSeconds;
      if (status == 'active' && (changedWhileOpen || newerThanSession)) {
        _showNotice(
          _AccountNotice(
            title: 'تم إنهاء الجلسة',
            message:
                'تم إنهاء جلسة تسجيل الدخول بواسطة إدارة Shadow Live. '
                'يمكنك تسجيل الدخول مرة أخرى.' +
                (reason.isEmpty ? '' : '\nالسبب: ' + reason),
            icon: Icons.phonelink_erase_outlined,
          ),
        );
      }
    }
  }

  void _showNotice(_AccountNotice notice) {
    if (_handling || !mounted) return;
    _handling = true;
    _userSubscription?.cancel();
    unawaited(VoiceRoomSessionController.instance.leave());
    setState(() => _notice = notice);
  }

  Future<void> _returnToLogin() async {
    try {
      await FirebaseAuth.instance.signOut();
    } catch (_) {}
    final storage = StorageService();
    try {
      await storage.removeUser();
    } catch (_) {}
    try {
      await storage.removeToken();
    } catch (_) {}
    if (!mounted) return;
    _activeAuthUid = null;
    setState(() {
      _notice = null;
      _handling = false;
    });
    NavigationService.navigateToAndRemoveUntil(AppRoutes.authChoice);
  }

  @override
  Widget build(BuildContext context) {
    final notice = _notice;
    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (notice != null)
          Positioned.fill(
            child: Material(
              color: const Color(0xF20A0612),
              child: SafeArea(
                child: Directionality(
                  textDirection: TextDirection.rtl,
                  child: Center(
                    child: SingleChildScrollView(
                      padding: const EdgeInsets.all(24),
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 460),
                        child: Card(
                          color: const Color(0xFF171022),
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  notice.icon,
                                  size: 66,
                                  color: const Color(0xFFFFD54A),
                                ),
                                const SizedBox(height: 18),
                                Text(
                                  notice.title,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 25,
                                    fontWeight: FontWeight.w900,
                                    color: Colors.white,
                                  ),
                                ),
                                const SizedBox(height: 14),
                                Text(
                                  notice.message,
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    height: 1.7,
                                    color: Colors.white70,
                                  ),
                                ),
                                const SizedBox(height: 24),
                                SizedBox(
                                  width: double.infinity,
                                  height: 52,
                                  child: FilledButton(
                                    onPressed: _returnToLogin,
                                    child: const Text(
                                      'موافق',
                                      style: TextStyle(
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
