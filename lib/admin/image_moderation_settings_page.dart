import 'dart:convert';
import 'dart:typed_data';
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
  List<Map<String, dynamic>> _reviewCases = [];
  bool _reviewBusy = false;

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

  Future<void> _loadReviews() async {
    if (_reviewBusy) return;
    setState(() => _reviewBusy = true);
    try {
      final data = await _post({'action': 'list_images', 'limit': 12});
      if (!mounted) return;
      final cases = (data['images'] as List?) ?? [];
      setState(() => _reviewCases = cases.whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted) setState(() => _notice =
          'تعذّر تحميل الصور المعلّقة. حاول مجددًا.');
    } finally {
      if (mounted) setState(() => _reviewBusy = false);
    }
  }

  Future<void> _preview(String objectId) async {
    if (_reviewBusy) return;
    setState(() => _reviewBusy = true);
    try {
      final token = await controlAuth.currentUser?.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final res = await http.post(shadowApiEndpoint('image-moderation-control'),
          headers: {'authorization': 'Bearer $token',
            'content-type': 'application/json'},
          body: jsonEncode({'action': 'preview_image', 'objectId': objectId}))
          .timeout(const Duration(seconds: 20));
      if (res.statusCode != 200 || res.bodyBytes.length > 3 * 1024 * 1024) {
        throw StateError('image_preview_failed');
      }
      final bytes = Uint8List.fromList(res.bodyBytes);
      if (!mounted) return;
      await showDialog<void>(context: context, builder: (dialogContext) =>
          AlertDialog(
            title: const Text('معاينة صورة خاصة'),
            content: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400, maxHeight: 420),
              child: Image.memory(bytes, fit: BoxFit.contain)),
            actions: [TextButton(onPressed: () => Navigator.pop(dialogContext),
                child: const Text('إغلاق'))],
          ));
    } catch (_) {
      if (mounted) setState(() => _notice =
          'تعذّر فتح الصورة. قد تحتاج إلى تسجيل الدخول مجددًا للتحقق.');
    } finally {
      if (mounted) setState(() => _reviewBusy = false);
    }
  }

  static const Map<String, String> _scopeLabels = {
    'profile_image': 'الصورة الشخصية',
    'profile_avatar_animation': 'صورة الحساب المتحركة',
    'profile_cover': 'غلاف الحساب',
    'room_cover': 'غلاف الغرفة',
    'agency_logo': 'شعار الوكالة',
    'agency_background': 'خلفية الوكالة',
    'agency_room_image': 'صورة غرفة الوكالة',
    'chat_image': 'صورة محادثة خاصة',
    'diary_image': 'صورة يومية',
  };

  Future<void> _approveDiaryPrivate(String objectId) async {
    if (_reviewBusy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('موافقة على صورة يومية'),
        content: const Text('سيُعتمد محتوى الصورة فقط، وتبقى خاصة وغير '
            'منشورة حتى ينشئ صاحبها اليومية ويربطها بنفسه.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('الموافقة دون نشر')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _reviewBusy = true);
    try {
      await _post({
        'action': 'approve_diary_private',
        'objectId': objectId,
        'reason': 'تمت مراجعة صورة اليومية والموافقة على محتواها دون نشرها',
        'idempotencyKey': 'image_diary_private_' + objectId,
      });
      if (!mounted) return;
      setState(() => _notice =
          'تم اعتماد محتوى صورة اليومية. الصورة لم تُنشر بعد.');
      await _loadReviewsAfterDecision();
    } catch (_) {
      if (mounted) {
        setState(() => _notice =
            'تعذر اعتماد الصورة الخاصة. تحقق من الملف وصلاحية المراجعة.');
      }
    } finally {
      if (mounted) setState(() => _reviewBusy = false);
    }
  }

  Future<void> _approve(String objectId) async {
    if (_reviewBusy) return;
    final approved = await showDialog<bool>(
        context: context, builder: (dialogContext) => AlertDialog(
          title: const Text('الموافقة على نشر الصورة'),
          content: const Text('هل تحققت من الصورة؟ عند الموافقة '
              'ستصبح الصورة الجديدة ظاهرة في مكانها المناسب، '
              'وتبقى الصورة القديمة حتى اكتمال الاعتماد.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('إلغاء')),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('اعتماد الصورة')),
          ],
        ));
    if (approved != true || !mounted) return;
    setState(() => _reviewBusy = true);
    try {
      await _post({
        'action': 'approve_image', 'objectId': objectId,
        'reason': 'تمت مراجعة الصورة بصريًا واعتماد نشرها',
        'idempotencyKey': 'image_approval_' + objectId,
      });
      if (!mounted) return;
      setState(() => _notice = 'تم اعتماد الصورة وإرسال النتيجة لصاحبها.');
      await _loadReviewsAfterDecision();
    } catch (_) {
      if (mounted) setState(() => _notice =
          'تعذّر اعتماد الصورة. قد تكون الصورة تغيّرت أو انتهت الصلاحية. '
          'تحقّق وأعد المحاولة بنفس الطلب.');
    } finally {
      if (mounted) setState(() => _reviewBusy = false);
    }
  }

  Future<void> _reject(String objectId) async {
    if (_reviewBusy) return;
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
        context: context, builder: (dialogContext) => AlertDialog(
          title: const Text('رفض نشر الصورة'),
          content: TextField(
            controller: reason, maxLength: 200, maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'اكتب سبب الرفض ليصل إلى صاحب الصورة')),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('إلغاء')),
            FilledButton(onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('تأكيد الرفض')),
          ],
        ));
    final message = reason.text.trim();
    reason.dispose();
    if (confirmed != true || !mounted) return;
    if (message.length < 3) {
      setState(() => _notice = 'اكتب سببًا واضحًا لا يقل عن 3 أحرف.');
      return;
    }
    setState(() => _reviewBusy = true);
    try {
      await _post({
        'action': 'reject_image', 'objectId': objectId,
        'reason': message,
        'idempotencyKey': 'image_review_' +
            DateTime.now().microsecondsSinceEpoch.toString(),
      });
      if (!mounted) return;
      setState(() => _notice =
          'تم رفض نشر الصورة وإرسال النتيجة إلى صاحبها.');
      await _loadReviewsAfterDecision();
    } catch (_) {
      if (mounted) setState(() => _notice =
          'لم يُحفظ القرار. تحقّق من الصلاحية أو أعد تسجيل الدخول.');
    } finally {
      if (mounted) setState(() => _reviewBusy = false);
    }
  }

  Future<void> _changeEvidenceHold(String objectId, bool hold) async {
    if (_reviewBusy) return;
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(hold ? 'حفظ دليل الصورة' : 'إلغاء حجز الدليل'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(hold ? 'سيبقى الدليل محفوظًا إلى أن تنتهي المراجعة '
              'أو التحقيق أو الالتزامات اللازمة.'
              : 'لن يُحذف الدليل فورًا. يعود موعد الحذف السابق '
                  'بعد انتهاء الحجز.'),
          TextField(controller: reason, maxLength: 200, maxLines: 3,
            decoration: const InputDecoration(
              hintText: 'اكتب سبب الإجراء الإداري')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('تأكيد')),
        ],
      ));
    final message = reason.text.trim();
    reason.dispose();
    if (confirmed != true || !mounted) return;
    if (message.length < 3) {
      setState(() => _notice = 'اكتب سببًا واضحًا لا يقل عن 3 أحرف.');
      return;
    }
    setState(() => _reviewBusy = true);
    try {
      await _post({
        'action': 'hold_image_evidence', 'objectId': objectId,
        'hold': hold, 'reason': message,
        'idempotencyKey': 'image_evidence_hold_' +
            DateTime.now().microsecondsSinceEpoch.toString(),
      });
      if (!mounted) return;
      setState(() => _notice = hold
          ? 'تم حفظ دليل الصورة وتسجيل سبب الحجز.'
          : 'تم إلغاء الحجز. يسري موعد حذف الدليل المقرر.');
      await _loadReviewsAfterDecision();
    } catch (_) {
      if (mounted) setState(() => _notice =
          'تعذّر تعديل احتفاظ الدليل. تحقق من الصلاحية أو حاول مجددًا.');
    } finally {
      if (mounted) setState(() => _reviewBusy = false);
    }
  }

  Future<void> _loadReviewsAfterDecision() async {
    final data = await _post({'action': 'list_images', 'limit': 12});
    if (!mounted) return;
    final cases = (data['images'] as List?) ?? [];
    setState(() => _reviewCases = cases.whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e)).toList());
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
          const SizedBox(height: 22),
          const Text('مراجعة الصور المعلّقة',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          const Text('القائمة محدودة لأحدث عينة متاحة. عرض الصورة '
              'يسجّل الاطلاع عليها ولا يمنح حق النشر تلقائيًا.'),
          OutlinedButton.icon(
            onPressed: _reviewBusy ? null : _loadReviews,
            icon: const Icon(Icons.fact_check_outlined),
            label: Text(_reviewBusy ? 'جارٍ التحميل...' : 'عرض الصور للمراجعة'),
          ),
          for (final item in _reviewCases) Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('نوع الصورة: ${_scopeLabels[item['scope']] ?? 'صورة'}'),
                  Text('صاحب الصورة: ${item['ownerUid'] ?? '—'}'),
                  Text('الحالة: ${item['state'] == 'appeal_pending' ? 'اعتراض قيد المراجعة' : (item['state'] ?? '—')}'),
                  if (item['state'] == 'appeal_pending')
                    Text('توضيح صاحب الصورة: ${item['appealExplanation']?.toString().isNotEmpty == true ? item['appealExplanation'] : 'لم يضف توضيحًا'}'),
                  Text('السبب: ${item['reason'] ?? 'غير محدد'}'),
                  if (item['state'] == 'approved_pending_diary_link')
                    const Text('محتوى الصورة مقبول، لكن الصورة خاصة ولم تُنشر.'),
                  if (item['evidenceHold'] == true)
                    const Text('الدليل محفوظ بقرار إداري؛ الحذف موقوف.'),
                  if (item['state'] == 'rejected' &&
                      item['evidencePurgeAt'] != null)
                    const Text('الدليل مهيّأ للحذف بعد انقضاء المهلة، '
                        'ما لم يوجد حجز إداري.'),
                  Wrap(spacing: 10, children: [
                    OutlinedButton(
                      onPressed: _reviewBusy ? null : () =>
                          _preview((item['objectId'] ?? '').toString()),
                      child: const Text('معاينة آمنة')),
                    if (['needs_review', 'approved_pending_copy', 'appeal_pending'].contains(item['state']) &&
                        _scopeLabels.containsKey(item['scope']) &&
                        !['chat_image', 'diary_image']
                            .contains(item['scope']))
                      FilledButton(
                        onPressed: _reviewBusy ? null : () =>
                            _approve((item['objectId'] ?? '').toString()),
                        child: Text(item['state'] == 'appeal_pending' ? 'قبول الاعتراض' : 'اعتماد النشر')),
                    if (item['scope'] == 'diary_image' &&
                        ['needs_review', 'appeal_pending']
                            .contains(item['state']))
                      FilledButton(
                        onPressed: _reviewBusy ? null : () =>
                            _approveDiaryPrivate(
                                (item['objectId'] ?? '').toString()),
                        child: const Text('الموافقة دون نشر')),
                    if (['needs_review', 'blocked', 'appeal_pending']
                        .contains(item['state']))
                      OutlinedButton(
                        onPressed: _reviewBusy ? null : () =>
                            _reject((item['objectId'] ?? '').toString()),
                        child: Text(item['state'] == 'appeal_pending' ? 'رفض الاعتراض' : 'رفض النشر')),
                    if (['rejected', 'blocked', 'appeal_pending']
                        .contains(item['state']))
                      OutlinedButton.icon(
                        onPressed: _reviewBusy ? null : () =>
                            _changeEvidenceHold((item['objectId'] ?? '').toString(),
                                item['evidenceHold'] != true),
                        icon: Icon(item['evidenceHold'] == true
                            ? Icons.lock_open_outlined : Icons.lock_outline),
                        label: Text(item['evidenceHold'] == true
                            ? 'إلغاء حجز الدليل' : 'حفظ الدليل')),
                  ]),
                ],
              ),
            ),
          ),
          const Text('الصور المشتبه بها من الحسابات والغرف والوكالات '
              'يمكن اعتمادها يدويًا. صور المحادثات واليوميات والصور '
              'المحجوبة آليًا لا تُنشر تلقائيًا؛ اعتراضاتها تُراجع '
              'بقرار بشري موثّق. صور اليوميات والخاصة تبقى محجوبة '
              'لحين اكتمال ربط النشر الآمن.'),
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
