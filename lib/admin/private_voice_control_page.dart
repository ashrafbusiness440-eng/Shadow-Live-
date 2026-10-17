import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// One Arabic control surface for both voice-note and call permissions.
/// Direct Firestore writes to system_config are intentionally forbidden.
class PrivateVoiceControlPage extends StatefulWidget {
  const PrivateVoiceControlPage({super.key});

  @override
  State<PrivateVoiceControlPage> createState() => _PrivateVoiceControlPageState();
}

class _PrivateVoiceControlPageState extends State<PrivateVoiceControlPage> {
  final _reason = TextEditingController(text: 'تعديل إعدادات صوتيات الرسائل');
  bool _loading = true;
  bool _saving = false;
  bool _voiceNotes = false;
  bool _calls = false;
  bool _callsReady = false;
  bool _dirty = false;
  int _version = 0;
  String? _message;
  String? _operationKey;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  String _friendlyError(String code) => switch (code) {
    'forbidden' => 'ليس لديك صلاحية لتغيير هذه الإعدادات.',
    'unauthorized' || 'recent_auth_required' =>
      'انتهت صلاحية تسجيل الدخول للإدارة. أعد تسجيل الدخول.',
    'private_calls_not_ready' =>
      'المكالمات غير جاهزة للإطلاق. لن تتفعّل حتى اكتمال الاختبارات.',
    'voice_config_conflict' =>
      'تغيّرت الإعدادات من جهاز آخر. اضغط تحديث ثم جرّب مرة ثانية.',
    'idempotency_conflict' =>
      'تم استخدام طلب قديم. حدّث الصفحة ثم جرّب.',
    'invalid_voice_config' || 'invalid_request' =>
      'راجع الخيارات وسبب التعديل.',
    _ => 'تعذر حفظ الإعدادات. تحقق من الاتصال وحاول مجددًا.',
  };

  Future<Map<String, dynamic>> _post(Map<String, dynamic> data) async {
    final user = controlAuth.currentUser;
    if (user == null) throw const FormatException('unauthorized');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw const FormatException('unauthorized');
    }
    final response = await http.post(
      shadowApiEndpoint('private-voice-control'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(data),
    ).timeout(const Duration(seconds: 15));
    if (controlAuth.currentUser?.uid != user.uid) {
      throw const FormatException('unauthorized');
    }
    final parsed = jsonDecode(response.body);
    if (parsed is! Map) throw const FormatException('invalid_response');
    final body = Map<String, dynamic>.from(parsed);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw FormatException('${body['code'] ?? 'request_failed'}');
    }
    return body;
  }

  void _apply(Map<String, dynamic> data) {
    _voiceNotes = data['voiceNotesEnabled'] == true;
    _calls = data['privateCallsEnabled'] == true;
    _callsReady = data['callsLaunchReady'] == true;
    _version = (data['version'] as num?)?.toInt() ?? 0;
    _dirty = false;
    _operationKey = null;
  }

  Future<void> _load() async {
    if (_saving) return;
    setState(() {
      _loading = true;
      _message = null;
    });
    try {
      final result = await _post({'action': 'load'});
      if (!mounted) return;
      setState(() {
        _apply(Map<String, dynamic>.from(result['config'] as Map));
      });
    } catch (error) {
      if (mounted) {
        setState(() => _message = _friendlyError(
          error is FormatException ? error.message : '',
        ));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (_saving || _loading || !_dirty) return;
    if (_reason.text.trim().length < 3) {
      setState(() => _message = 'اكتب سببًا مختصرًا للتعديل.');
      return;
    }
    final op = _operationKey ??
        'private_voice_${DateTime.now().microsecondsSinceEpoch}';
    _operationKey = op; // Preserve the operation on a network retry.
    setState(() {
      _saving = true;
      _message = null;
    });
    try {
      final result = await _post({
        'action': 'save',
        'config': {
          'voiceNotesEnabled': _voiceNotes,
          'privateCallsEnabled': _calls,
        },
        'reason': _reason.text.trim(),
        'expectedVersion': _version,
        'idempotencyKey': op,
      });
      if (!mounted) return;
      setState(() {
        _apply(Map<String, dynamic>.from(result['config'] as Map));
        _message = 'انحفظت إعدادات صوتيات الرسائل بنجاح.';
      });
    } catch (error) {
      if (mounted) {
        setState(() => _message = _friendlyError(
          error is FormatException ? error.message : '',
        ));
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _changeVoiceNotes(bool value) {
    setState(() {
      _voiceNotes = value;
      _dirty = true;
      _operationKey = null;
    });
  }

  void _changeCalls(bool value) {
    // Emergency OFF must always remain available, even when the
    // deployment is not launch-ready. Only enabling is gated.
    if (!_callsReady && value) return;
    setState(() {
      _calls = value;
      _dirty = true;
      _operationKey = null;
    });
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      appBar: AppBar(
        title: const Text('إعدادات الصوت بالرسائل'),
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
            'الرسائل الصوتية والمكالمات',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 8),
          const Text(
            'حدد الميزات المسموحة في المحادثات الخاصة. '
            'ما منغيّر أي أسعار أو رصيد من هذه الصفحة.',
          ),
          const SizedBox(height: 12),
          Card(
            child: SwitchListTile(
              secondary: const Icon(Icons.mic_rounded),
              title: const Text('الرسائل الصوتية'),
              subtitle: const Text('السماح بتسجيل وإرسال رسالة صوتية داخل المحادثة.'),
              value: _voiceNotes,
              onChanged: _loading || _saving ? null : _changeVoiceNotes,
            ),
          ),
          Card(
            child: SwitchListTile(
              secondary: const Icon(Icons.call_rounded),
              title: const Text('المكالمات الصوتية الخاصة'),
              subtitle: Text(_callsReady
                  ? 'السماح بمكالمات بين حسابين متابعين لبعضهما.'
                  : 'غير متاحة للتفعيل حاليًا. بقيت فحوص الأمان والتشغيل على هاتفين.'),
              value: _calls,
              onChanged: _loading || _saving || !_callsReady
                  ? null : _changeCalls,
            ),
          ),
          if (!_callsReady) const Padding(
            padding: EdgeInsets.symmetric(vertical: 10),
            child: Text(
              'المكالمات محمية ومقفلة من الخادم حتى انتهاء التجارب '
              'والموافقة على فتح الخدمة.',
              style: TextStyle(color: Colors.amberAccent),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _reason,
            enabled: !_loading && !_saving,
            maxLength: 180,
            decoration: const InputDecoration(
              labelText: 'سبب التغيير',
              hintText: 'اكتب سببًا بسيطًا للحفظ',
              border: OutlineInputBorder(),
            ),
          ),
          if (_message != null) Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(_message!, style:
                const TextStyle(color: Colors.amberAccent)),
          ),
          FilledButton.icon(
            onPressed: _loading || _saving || !_dirty ? null : _save,
            icon: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.save_rounded),
            label: const Text('حفظ الإعدادات'),
          ),
        ],
      ),
    ),
  );
}
