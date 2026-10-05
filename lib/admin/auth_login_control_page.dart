import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class AuthLoginControlPage extends StatefulWidget {
  const AuthLoginControlPage({super.key});

  @override
  State<AuthLoginControlPage> createState() => _AuthLoginControlPageState();
}

class _AuthLoginControlPageState extends State<AuthLoginControlPage> {
  final _reason =
      TextEditingController(text: 'تحديث طرق تسجيل الدخول من Shadow Control');

  bool _loading = true;
  bool _saving = false;
  String? _message;

  bool email = true;
  bool google = true;
  bool guest = true;
  bool phone = false;
  bool facebook = false;
  bool apple = false;
  bool optionalAccountLinking = false;

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

  Map<String, dynamic> get _config => {
        'providers': {
          'email': email,
          'google': google,
          'guest': guest,
          'phone': phone,
          'facebook': facebook,
          'apple': apple,
        },
        'optionalAccountLinking': optionalAccountLinking,
      };

  void _apply(Map<String, dynamic> config) {
    final providers = config['providers'] is Map
        ? Map<String, dynamic>.from(config['providers'] as Map)
        : const <String, dynamic>{};

    bool value(String key, bool fallback) =>
        providers[key] is bool ? providers[key] as bool : fallback;

    email = value('email', true);
    google = value('google', true);
    guest = value('guest', true);
    phone = value('phone', false);
    facebook = value('facebook', false);
    apple = value('apple', false);
    optionalAccountLinking = config['optionalAccountLinking'] is bool
        ? config['optionalAccountLinking'] as bool
        : false;
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _message = null;
      });
    }
    try {
      final response = await http
          .get(shadowApiEndpoint('auth-config'))
          .timeout(const Duration(seconds: 12));
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      final body = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{};
      if (response.statusCode == 200 &&
          body['ok'] == true &&
          body['config'] is Map) {
        if (!mounted) return;
        setState(() => _apply(
              Map<String, dynamic>.from(body['config'] as Map),
            ));
      } else if (mounted) {
        setState(() => _message =
            'تعذر تحميل إعدادات تسجيل الدخول: ${body['code'] ?? response.statusCode}');
      }
    } catch (error) {
      if (mounted) {
        setState(() => _message = 'تعذر تحميل إعدادات تسجيل الدخول: $error');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _save() async {
    if (_saving) return;
    if (![email, google, guest, phone, facebook, apple].any((e) => e)) {
      setState(() =>
          _message = 'يجب إبقاء طريقة تسجيل دخول واحدة على الأقل مفعلة.');
      return;
    }
    if (_reason.text.trim().length < 3) {
      setState(() => _message = 'اكتب سبباً مختصراً للتغيير.');
      return;
    }

    final user = controlAuth.currentUser;
    if (user == null) {
      setState(() => _message = 'انتهت جلسة Shadow Control.');
      return;
    }

    setState(() {
      _saving = true;
      _message = null;
    });

    try {
      final token = await user.getIdToken(true);
      if (token == null || token.isEmpty) {
        throw StateError('missing_token');
      }
      final response = await http
          .post(
            shadowApiEndpoint('auth-config'),
            headers: {
              'authorization': 'Bearer $token',
              'content-type': 'application/json',
            },
            body: jsonEncode({
              'action': 'update',
              'config': _config,
              'reason': _reason.text.trim(),
              'idempotencyKey':
                  'auth_login_${DateTime.now().microsecondsSinceEpoch}',
            }),
          )
          .timeout(const Duration(seconds: 15));

      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      final body = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{};

      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['ok'] == true) {
        final returned = body['config'];
        if (returned is Map) {
          _apply(Map<String, dynamic>.from(returned));
        }
        if (mounted) {
          setState(() =>
              _message = 'تم حفظ إعدادات تسجيل الدخول والربط بنجاح.');
        }
      } else if (mounted) {
        final code = '${body['code'] ?? 'http_${response.statusCode}'}';
        setState(() => _message = switch (code) {
              'recent_auth_required' =>
                'يلزم تسجيل الدخول من جديد إلى Shadow Control قبل الحفظ.',
              'forbidden' =>
                'التعديل يحتاج Owner أو صلاحية manageSystem.',
              'at_least_one_provider_required' =>
                'يجب إبقاء طريقة تسجيل دخول واحدة على الأقل مفعلة.',
              'invalid_request' => 'تحقق من الإعدادات وسبب التغيير.',
              _ => 'تعذر حفظ الإعدادات: $code',
            });
      }
    } catch (error) {
      if (mounted) setState(() => _message = 'تعذر حفظ الإعدادات: $error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _providerTile({
    required String title,
    required String subtitle,
    required IconData icon,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Card(
      child: SwitchListTile(
        secondary: Icon(icon, color: const Color(0xFFD7B85A)),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(subtitle),
        value: value,
        onChanged: _loading || _saving ? null : onChanged,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('تسجيل الدخول والربط'),
        actions: [
          IconButton(
            tooltip: 'تحديث',
            onPressed: _loading || _saving ? null : _load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Text(
                  'طرق تسجيل الدخول',
                  style: TextStyle(fontSize: 23, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 6),
                const Text(
                  'إيقاف أي مزود يخفيه من شاشة الدخول ويمنع استخدام مساره داخل التطبيق. '
                  'الإعدادات الافتراضية: Email + Google + Guest مفعلة.',
                  style: TextStyle(color: Color(0xFFCBC5D6), height: 1.5),
                ),
                const SizedBox(height: 14),
                _providerTile(
                  title: 'البريد الإلكتروني',
                  subtitle: 'زر رئيسي واضح في شاشة تسجيل الدخول',
                  icon: Icons.mail_outline_rounded,
                  value: email,
                  onChanged: (v) => setState(() => email = v),
                ),
                _providerTile(
                  title: 'Google',
                  subtitle: 'تسجيل الدخول باستخدام Google',
                  icon: Icons.g_mobiledata_rounded,
                  value: google,
                  onChanged: (v) => setState(() => google = v),
                ),
                _providerTile(
                  title: 'الضيف',
                  subtitle: 'متابعة بدون إنشاء حساب دائم',
                  icon: Icons.person_outline_rounded,
                  value: guest,
                  onChanged: (v) => setState(() => guest = v),
                ),
                _providerTile(
                  title: 'رقم الهاتف',
                  subtitle: 'SMS / OTP',
                  icon: Icons.phone_android_rounded,
                  value: phone,
                  onChanged: (v) => setState(() => phone = v),
                ),
                _providerTile(
                  title: 'Facebook',
                  subtitle: 'تسجيل الدخول باستخدام Facebook',
                  icon: Icons.facebook_rounded,
                  value: facebook,
                  onChanged: (v) => setState(() => facebook = v),
                ),
                _providerTile(
                  title: 'Apple',
                  subtitle: 'تسجيل الدخول باستخدام Apple',
                  icon: Icons.apple_rounded,
                  value: apple,
                  onChanged: (v) => setState(() => apple = v),
                ),
                const SizedBox(height: 20),
                const Text(
                  'الربط الاختياري',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                Card(
                  child: SwitchListTile(
                    secondary: const Icon(
                      Icons.link_rounded,
                      color: Color(0xFFD7B85A),
                    ),
                    title: const Text(
                      'صفحة ربط الحسابات (اختياري)',
                      style: TextStyle(fontWeight: FontWeight.w800),
                    ),
                    subtitle: const Text(
                      'عند إيقافها يتم تجاوز الصفحة تلقائياً بعد التسجيل. '
                      'يمكن إعادتها في أي وقت من هنا.',
                    ),
                    value: optionalAccountLinking,
                    onChanged: _saving
                        ? null
                        : (v) =>
                            setState(() => optionalAccountLinking = v),
                  ),
                ),
                const SizedBox(height: 16),
                TextField(
                  controller: _reason,
                  enabled: !_saving,
                  decoration: const InputDecoration(
                    labelText: 'سبب التغيير',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: _saving ? null : _save,
                  icon: _saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_outlined),
                  label: Text(_saving ? 'جارٍ الحفظ...' : 'حفظ الإعدادات'),
                ),
                if (_message != null) ...[
                  const SizedBox(height: 12),
                  Card(
                    child: ListTile(
                      leading: const Icon(
                        Icons.info_outline_rounded,
                        color: Color(0xFFD7B85A),
                      ),
                      title: Text(_message!),
                    ),
                  ),
                ],
              ],
            ),
    );
  }
}
