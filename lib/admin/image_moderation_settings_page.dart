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
  bool _enabled = false;
  bool _paidAcknowledged = false;
  int _version = 0;
  int _limit = 20;
  String _mode = 'free';
  String _scope = 'public';
  String? _notice;
  Map<String, dynamic> _providers = {};
  Map<String, dynamic> _usage = {};

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
        _enabled = conf['enabled'] == true;
        _paidAcknowledged = false;
        _providers = data['providers'] is Map
            ? Map<String, dynamic>.from(data['providers'] as Map)
            : {};
        _usage = data['usage'] is Map
            ? Map<String, dynamic>.from(data['usage'] as Map)
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
          'enabled': _enabled,
          'paidAcknowledged': _paidAcknowledged,
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
        _notice = _enabled
            ? 'تم حفظ الإعدادات وتشغيل حماية الصور الجديدة.'
            : 'تم حفظ التجهيز. الفحص غير مفعّل.';
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
    final canEnable = _gateReady && provider['configured'] == true;
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
          Text(_gateReady
              ? (_enabled
                  ? 'فحص الصور الجديدة مفعّل حسب النطاق المحدد.'
                  : 'حماية الصور غير مفعّلة. يمكنك تشغيلها بعد تحقق الخدمة.')
              : 'الحماية غير مفعّلة حاليًا. زر تشغيلها سيصبح متاحًا '
                  'بعد إكمال منع نشر الصور غير المفحوصة واختبار الخدمة.'),
          ListTile(
            leading: const Icon(Icons.shield_outlined),
            title: const Text('حالة تجهيز الخدمة'),
            subtitle: Text(_gateReady && _providerReady
              ? 'الخدمة جاهزة للتشغيل بعد الموافقة.'
              : 'فحص الصور غير مفعّل.'),
          ),
          SwitchListTile(
            title: const Text('تشغيل فحص الصور الجديدة'),
            subtitle: Text(_gateReady
                ? 'لا تُنشر الصور المشمولة قبل الموافقة.'
                : 'التشغيل مقفل حتى اكتمال بوابة الحماية والفحوص.'),
            value: _enabled,
            onChanged: (_busy || !canEnable) ? null
                : (v) => setState(() => _enabled = v),
          ),
          if (_mode == 'paid') CheckboxListTile(
            value: _paidAcknowledged,
            onChanged: _busy ? null : (v) =>
                setState(() => _paidAcknowledged = v == true),
            title: const Text('أوافق صراحة على استخدام المزود المدفوع'),
            subtitle: const Text('الرسوم لدى Google Cloud مباشرة، '
                'ولا يشحن التطبيق أي محفظة تلقائيًا.'),
          ),
          const Divider(),
          const Text('استهلاك اليوم على الخادم',
              style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          Text('اليوم (UTC): ${_usage['day'] ?? '—'}'),
          Text('الخدمة: ${_usage['provider'] ?? '—'}'),
          Text('محاولات الفحص: ${_usage['attempted'] ?? 0}'
              ' / ${_usage['limit'] ?? _limit}'),
          Text('سليمة: ${_usage['approved'] ?? 0}  •  '
              'للمراجعة: ${_usage['needsReview'] ?? 0}  •  '
              'محجوبة: ${_usage['blocked'] ?? 0}'),
          Text('المتبقي من الحد الداخلي: ${_usage['remaining'] ?? _limit}'),
          const Text('هذه أعداد داخل التطبيق وليست فاتورة أو رصيد '
              'الخدمة الخارجية. الصور القديمة لا تُفحص مجددًا.'),
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
          const Text('الحد اليومي يُطبّق عبر الخادم عند تشغيل الفحص '
              'لاحقًا، لكنه لا يساوي حصة Cloudflare الإجمالية أو رصيدها. '
              'لا تشغيل تلقائي ولا تحويل صامت إلى خدمة مدفوعة.'),
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
