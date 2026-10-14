import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Owner settings are intentionally preparation-only until publication
/// enforcement is installed, verified and separately activated.
class ImageModerationSettingsPage extends StatefulWidget {
  const ImageModerationSettingsPage({super.key});
  @override
  State<ImageModerationSettingsPage> createState() =>
      _ImageModerationSettingsPageState();
}

class _ImageModerationSettingsPageState extends State<ImageModerationSettingsPage> {
  bool _busy = false;
  bool _gateReady = false;
  bool _providerReady = false;
  int _version = 0;
  int _limit = 20;
  String _mode = 'free';
  String _scope = 'public';
  String? _notice;
  Map<String, dynamic> _providers = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> request) async {
    final token = await controlAuth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('unauthorized');
    final res = await http.post(shadowApiEndpoint('image-moderation-control'),
        headers: {'authorization': 'Bearer $token',
          'content-type': 'application/json'},
        body: jsonEncode(request)).timeout(const Duration(seconds: 15));
    final data = jsonDecode(res.body);
    if (res.statusCode != 200 || data is! Map || data['ok'] != true)
      throw StateError('moderation_settings_failed');
    return Map<String, dynamic>.from(data);
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() { _busy = true; _notice = null; });
    try {
      final data = await _post({'action': 'read'});
      if (!mounted) return;
      final conf = data['config'] is Map
          ? Map<String, dynamic>.from(data['config'] as Map)
          : <String, dynamic>{};
      setState(() {
        _version = (conf['version'] as num?)?.toInt() ?? 0;
        _mode = conf['mode'] == 'paid' ? 'paid' : 'free';
        _scope = conf['scope'] == 'public_and_private'
            ? 'public_and_private' : 'public';
        _limit = ((conf['dailyLimit'] as num?)?.toInt() ?? 20).clamp(1, 500).toInt();
        _gateReady = data['publicationGateReady'] == true;
        _providerReady = data['providerConfigured'] == true;
        _providers = data['providers'] is Map
            ? Map<String, dynamic>.from(data['providers'] as Map)
            : {};
      });
    } catch (_) {
      if (mounted) setState(() => _notice =
          'تعذّر تحميل الخيارات. هذه الصفحة مخصّصة لمالك التطبيق.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _save() async {
    if (_busy) return;
    setState(() { _busy = true; _notice = null; });
    try {
      final data = await _post({
        'action': 'save',
        'expectedVersion': _version,
        'reason': 'تجهيز فحص الصور من لوحة التحكم',
        'idempotencyKey': 'image_mod_' +
            DateTime.now().microsecondsSinceEpoch.toString(),
        'config': {
          'enabled': false,
          'scope': _scope,
          'mode': _mode,
          'provider': _mode == 'paid'
              ? 'google_safesearch' : 'cloudflare_vision',
          'dailyLimit': _limit,
        },
      });
      if (!mounted) return;
      setState(() {
        _version = ((data['config'] as Map?)?['version'] as num?)?.toInt()
            ?? _version;
        _notice = 'تم حفظ التجهيز. الفحص لم يُفعَّل بعد.';
      });
    } catch (_) {
      if (mounted) setState(() => _notice =
          'تعذّر الحفظ. حدّث الخيارات وتأكد من صلاحية الأونر.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final selected = _mode == 'paid' ? 'google_safesearch' : 'cloudflare_vision';
    final provider = _providers[selected] is Map
        ? Map<String, dynamic>.from(_providers[selected] as Map)
        : <String, dynamic>{};
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        appBar: AppBar(title: const Text('فحص الصور'),
          actions: [IconButton(
            onPressed: _busy ? null : _load,
            tooltip: 'تحديث', icon: const Icon(Icons.refresh))]),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('تجهيز فحص الصور قبل النشر',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.bold)),
          const SizedBox(height: 10),
          const Text('الحماية غير مفعّلة حاليًا. زر تشغيلها سيصبح متاحًا '
              'بعد إكمال منع نشر الصور غير المفحوصة واختبار الخدمة.'),
          ListTile(
            leading: const Icon(Icons.shield_outlined),
            title: const Text('حالة تجهيز الخدمة'),
            subtitle: Text(_gateReady && _providerReady
              ? 'الخدمة جاهزة للتشغيل بعد الموافقة.'
              : 'فحص الصور غير مفعّل.'),
          ),
          const Divider(),
          const Text('نوع الخدمة', style: TextStyle(fontWeight: FontWeight.bold)),
          RadioListTile<String>(
            value: 'free', groupValue: _mode,
            title: const Text('الحصة المجانية أولًا'),
            subtitle: const Text('Cloudflare: يخضع للحصة المشتركة في الحساب.'),
            onChanged: _busy ? null : (v) => setState(() {
              _mode = v ?? 'free'; _limit = _limit.clamp(1, 100).toInt();
            }),
          ),
          RadioListTile<String>(
            value: 'paid', groupValue: _mode,
            title: const Text('خدمة مدفوعة (مقفلة افتراضيًا)'),
            subtitle: const Text('Google Vision: تتطلب رصيدًا ومفتاحًا سريًا '
                'وتفعيلًا صريحًا من الأونر لاحقًا.'),
            onChanged: _busy ? null : (v) => setState(() => _mode = v ?? 'paid'),
          ),
          const Divider(),
          const Text('نطاق فحص الصور بعد التفعيل',
            style: TextStyle(fontWeight: FontWeight.bold)),
          RadioListTile<String>(
            value: 'public', groupValue: _scope,
            title: const Text('الصور العامة فقط'),
            subtitle: const Text('الحساب والغلاف واليوميات والغرف والوكالات.'),
            onChanged: _busy ? null : (v) =>
                setState(() => _scope = v ?? 'public'),
          ),
          RadioListTile<String>(
            value: 'public_and_private', groupValue: _scope,
            title: const Text('الصور العامة والخاصة الجديدة'),
            subtitle: const Text('يتطلب إبلاغ المستخدمين قبل الفحص. '
                'لا يغيّر حالة الصور القديمة.'),
            onChanged: _busy ? null : (v) =>
                setState(() => _scope = v ?? 'public_and_private'),
          ),
          Text('الحد اليومي المختار: ' + _limit.toString() + ' صورة'),
          Slider(
            value: _limit.clamp(1, _mode == 'free' ? 100 : 500).toDouble(),
            min: 1, max: _mode == 'free' ? 100 : 500,
            divisions: _mode == 'free' ? 99 : 499,
            onChanged: _busy ? null : (v) =>
                setState(() => _limit = v.round()),
          ),
          const Text('هذا حد تخطيطي فقط إلى أن يُنفَّذ عدّ الاستهلاك بالخادم. '
              'حصة Cloudflare مشتركة وقد تطبق رسوم حسب خطة الحساب؛ '
              'لا تشغيل تلقائي ولا تحويل صامت إلى المدفوع.'),
          if (provider['billingUrl'] != null) ...[
            const Text('صفحة الخدمة الرسمية:'),
            SelectableText(provider['billingUrl'].toString()),
          ],
          if (_notice != null) Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(_notice!)),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _busy ? null : _save,
            icon: const Icon(Icons.save_outlined),
            label: const Text('حفظ خيارات التجهيز'),
          ),
        ]),
      ),
    );
  }
}
