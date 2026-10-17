import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../features/chat/services/private_call_push_service.dart';

/// Personal preferences read by the existing private-call Worker policy.
/// This page does not activate calls, create a parallel preferences document,
/// or add any Firestore listeners.
class PrivateCallPrivacySettingsScreen extends StatefulWidget {
  const PrivateCallPrivacySettingsScreen({super.key});

  @override
  State<PrivateCallPrivacySettingsScreen> createState() =>
      _PrivateCallPrivacySettingsScreenState();
}

class _PrivateCallPrivacySettingsScreenState
    extends State<PrivateCallPrivacySettingsScreen> {
  String? _openedByUid;
  bool _loading = true;
  bool _saving = false;
  bool _loadFailed = false;
  bool _dirty = false;
  bool _allowCalls = true;
  bool _doNotDisturb = false;
  bool _pushEnabled = false;
  bool _pushSaving = false;
  String? _message;

  bool get _activeAccount {
    final user = FirebaseAuth.instance.currentUser;
    return mounted &&
        user != null &&
        !user.isAnonymous &&
        user.uid == _openedByUid;
  }

  @override
  void initState() {
    super.initState();
    _openedByUid = FirebaseAuth.instance.currentUser?.uid;
    _load();
  }

  Future<void> _load() async {
    if (_saving || _pushSaving) return;
    if (!_activeAccount) {
      setState(() {
        _loading = false;
        _loadFailed = true;
        _message = 'سجّل الدخول بحساب عادي لتعديل خصوصية المكالمات.';
      });
      return;
    }
    final uid = _openedByUid!;
    setState(() {
      _loading = true;
      _loadFailed = false;
      _message = null;
    });
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .get()
          .timeout(const Duration(seconds: 12));
      if (!_activeAccount) return;
      if (!snapshot.exists) {
        throw StateError('profile_unavailable');
      }
      final data = snapshot.data() ?? <String, dynamic>{};
      setState(() {
        // Identical defaults to requireMutualPrivateVoice in the Worker.
        _allowCalls = data['allowPrivateCalls'] != false;
        _doNotDisturb = data['doNotDisturbCalls'] == true;
        _pushEnabled = data['privateCallPushOptIn'] == true;
        _dirty = false;
      });
    } catch (_) {
      if (_activeAccount) {
        setState(() {
          _loadFailed = true;
          _message = 'تعذر جلب الإعدادات. تحقق من الاتصال واضغط تحديث.';
        });
      }
    } finally {
      if (_activeAccount) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (_loading || _saving || _loadFailed || !_dirty || !_activeAccount) {
      return;
    }
    final uid = _openedByUid!;
    final allow = _allowCalls;
    final dnd = _doNotDisturb;
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      // Existing Firestore rules allow a user to update their own profile
      // only, while forbidding changes to protected identity/economy fields.
      await FirebaseFirestore.instance
          .collection('users')
          .doc(uid)
          .update({
            'allowPrivateCalls': allow,
            'doNotDisturbCalls': dnd,
          })
          .timeout(const Duration(seconds: 12));
      if (!_activeAccount) return;
      setState(() {
        // Do not discard a newer UI change during the network await.
        _dirty = _allowCalls != allow || _doNotDisturb != dnd;
        _message = 'تم حفظ خصوصية المكالمات بنجاح.';
      });
    } catch (_) {
      if (_activeAccount) {
        setState(() => _message =
            'تعذر حفظ إعدادات المكالمات. جرّب مرة ثانية.');
      }
    } finally {
      if (_activeAccount) setState(() => _saving = false);
    }
  }

  Future<void> _changePush(bool enabled) async {
    if (!_activeAccount || _loading || _saving ||
        _pushSaving || _loadFailed) return;
    setState(() {
      _pushSaving = true;
      _message = null;
    });
    try {
      final push = PrivateCallPushService.instance;
      if (enabled) {
        await push.enableForCurrentUser();
      } else {
        await push.disableForCurrentUser();
      }
      if (!_activeAccount) return;
      setState(() {
        _pushEnabled = enabled;
        _message = enabled
            ? 'تم تشغيل تنبيهات المكالمات على هذا الجهاز. '
              'تظل الخدمة نفسها متوقفة حتى إطلاقها.'
            : 'تم إيقاف تنبيهات المكالمات لهذا الحساب.';
      });
    } catch (error) {
      if (_activeAccount) {
        setState(() {
          _message = error.toString().contains('permission_denied')
              ? 'إذن الإشعارات مرفوض. يمكنك السماح به من إعدادات الهاتف.'
              : 'تعذر تعديل تنبيهات المكالمات. تحقق من الاتصال وحاول مجددًا.';
        });
      }
    } finally {
      if (_activeAccount) setState(() => _pushSaving = false);
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('خصوصية المكالمات'),
            actions: [
              IconButton(
                tooltip: 'تحديث الإعدادات',
                onPressed: _loading || _saving ? null : _load,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
          ),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'تحكم بمن يستطيع الاتصال بك',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              const Text(
                'المكالمات مسموحة فقط بين شخصين يتابعان بعضهما، '
                'والحظر يبقى ساريًا دائمًا. '
                'هذه الإعدادات لا تفعّل خدمة المكالمات قبل إطلاقها.',
              ),
              const SizedBox(height: 14),
              Card(
                child: SwitchListTile(
                  secondary: const Icon(Icons.call_rounded),
                  title: const Text('السماح بالمكالمات الخاصة'),
                  subtitle: const Text(
                    'عند إيقافه لا يستطيع الآخرون بدء مكالمة معك.',
                  ),
                  value: _allowCalls,
                  onChanged: _loading || _saving || _loadFailed ||
                          !_activeAccount
                      ? null
                      : (value) => setState(() {
                            _allowCalls = value;
                            _dirty = true;
                          }),
                ),
              ),
              Card(
                child: SwitchListTile(
                  secondary: const Icon(Icons.do_not_disturb_on_outlined),
                  title: const Text('عدم الإزعاج للمكالمات'),
                  subtitle: const Text(
                    'امنع ورود مكالمات جديدة حتى تطفئ عدم الإزعاج.',
                  ),
                  value: _doNotDisturb,
                  onChanged: _loading || _saving || _loadFailed ||
                          !_activeAccount
                      ? null
                      : (value) => setState(() {
                            _doNotDisturb = value;
                            _dirty = true;
                          }),
                ),
              ),
              Card(
                child: SwitchListTile(
                  secondary: const Icon(Icons.notifications_active_outlined),
                  title: const Text('تنبيهات المكالمات على هذا الجهاز'),
                  subtitle: Text(
                    PrivateCallPushService.instance.supported
                        ? 'السماح بإشعار المكالمة الواردة عند إغلاق التطبيق '
                          'أو وجوده بالخلفية، بعد منح إذن الهاتف.'
                        : 'تنبيهات Android تحتاج تهيئة Firebase صحيحة، '
                          'وتنبيهات الويب وPWA تحتاج إعداد VAPID.',
                  ),
                  value: _pushEnabled,
                  onChanged: _loading || _saving || _pushSaving ||
                          _loadFailed || !_activeAccount ||
                          !PrivateCallPushService.instance.supported
                      ? null : _changePush,
                ),
              ),
              if (_pushSaving) const Padding(
                padding: EdgeInsets.all(12),
                child: Center(child: CircularProgressIndicator()),
              ),
              if (_loading) const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              ),
              if (_message != null) Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(_message!,
                    style: const TextStyle(color: Colors.amberAccent)),
              ),
              FilledButton.icon(
                onPressed: _loading || _saving || _loadFailed ||
                        !_dirty || !_activeAccount
                    ? null
                    : _save,
                icon: const Icon(Icons.save_rounded),
                label: Text(_saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'),
              ),
            ],
          ),
        ),
      );
}
