import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Existing content-filter observations, inside the unified reports hub.
/// On demand only: no automatic refresh, polling or broad collection scans.
class SystemReportsControlPage extends StatefulWidget {
  const SystemReportsControlPage({super.key});
  @override
  State<SystemReportsControlPage> createState() =>
      _SystemReportsControlPageState();
}

class _SystemReportsControlPageState extends State<SystemReportsControlPage> {
  String _type = 'all';
  bool _loading = false;
  bool _canReview = false;
  bool _canViewSensitiveEvidence = false;
  bool _unavailable = false;
  String? _error;
  List<Map<String, dynamic>> _items = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Map<String, dynamic>> _request(String action,
      [Map<String, dynamic> payload = const {}]) async {
    final user = controlAuth.currentUser;
    final token = await user?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('auth_required');
    final res = await http.post(shadowApiEndpoint('general-reports'),
        headers: {'authorization': 'Bearer $token',
          'content-type': 'application/json'},
        body: jsonEncode({'action': action, ...payload}));
    final body = jsonDecode(res.body);
    if (body is! Map || body['ok'] != true || res.statusCode != 200) {
      throw StateError(body is Map ? '${body['code'] ?? 'request_failed'}'
          : 'request_failed');
    }
    return Map<String, dynamic>.from(body);
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {_loading = true; _error = null;});
    try {
      final response = await _request('listSystemFlags');
      if (!mounted) return;
      setState(() {
        _items = (response['items'] as List? ?? const [])
            .whereType<Map>()
            .map((row) => Map<String, dynamic>.from(row))
            .toList(growable: false);
        _canReview = response['canReview'] == true;
        _canViewSensitiveEvidence = response['canViewSensitiveEvidence'] == true;
        _unavailable = response['roomUnavailable'] == true;
      });
    } catch (_) {
      if (mounted) setState(() =>
          _error = 'تعذّر تحميل بلاغات النظام. تحقّق من الاتصال وأعد المحاولة.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openEvidence(Map<String, dynamic> item) async {
    if (!_canViewSensitiveEvidence || _loading) return;
    setState(() => _loading = true);
    try {
      final result = await _request('openSystemFlagEvidence', {
        'flagId': item['id'],
      });
      if (!mounted) return;
      final raw = result['evidence'];
      final evidence = raw is Map
          ? Map<String, dynamic>.from(raw)
          : <String, dynamic>{};
      final original = (evidence['text'] ?? '').toString();
      await showDialog<void>(
        context: context,
        builder: (dialog) => AlertDialog(
          title: const Text('النص الأصلي للمخالفة'),
          content: SizedBox(
            width: 480,
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('هذه رسالة واحدة فقط؛ لا يتم فتح بقية '
                      'المحادثة. تم توثيق الاطلاع في سجل الإدارة.'),
                  const SizedBox(height: 10),
                  SelectableText(original.isEmpty
                      ? 'لا يوجد نص أصلي محفوظ.' : original),
                ],
              ),
            ),
          ),
          actions: [
            FilledButton(onPressed: () => Navigator.pop(dialog),
              child: const Text('إغلاق')),
          ],
        ),
      );
    } catch (_) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text(
          'تعذّر فتح الدليل. تحقّق من الصلاحية وحداثة الدخول.')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _markReviewed(Map<String, dynamic> item) async {
    if (!_canReview || _loading) return;
    final id = (item['id'] ?? '').toString();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('إنهاء مراجعة تنبيه النظام'),
        content: const Text('سيُسجّل إتمام مراجعة هذا التنبيه فقط. '
            'لن يُعاقب أي مستخدم تلقائيًا.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false),
              child: const Text('إلغاء')),
          FilledButton(onPressed: () => Navigator.pop(dialog, true),
              child: const Text('تمت المراجعة')),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _loading = true);
    try {
      await _request('reviewSystemFlag', {
        'flagId': id,
        'reason': 'مراجعة تنبيه من مركز البلاغات',
        'idempotencyKey': 'system_review_${DateTime.now().microsecondsSinceEpoch}',
      });
      if (mounted) setState(() {
        _items = _items.map((row) =>
          row['id'] == id ? {...row, 'status': 'reviewed'} : row
        ).toList(growable: false);
      });
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('تعذّر حفظ المراجعة. حدّث القائمة وحاول من جديد.')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    // The image report provider is not active. An empty view MUST NOT
    // misrepresent an unsupported image scanner as a clean image queue.
    final selected = _type == 'images' ? <Map<String, dynamic>>[] : _items;
    return Column(children: [
      const Padding(
        padding: EdgeInsets.all(12),
        child: Text('تنبيهات النظام تساعد المراجعة ولا تُثبت مخالفة '
            'ولا تُنفّذ عقوبة تلقائية. آخر 40 تنبيهًا كحد أقصى.'),
      ),
      Wrap(spacing: 8, children: [
        for (final entry in const [
          ('all', 'الكل'),
          ('words', 'الكلمات المحظورة'),
          ('images', 'الصور المخالفة'),
        ])
          ChoiceChip(label: Text(entry.$2), selected: _type == entry.$1,
            onSelected: (_) => setState(() => _type = entry.$1)),
        IconButton(onPressed: _loading ? null : _load,
          tooltip: 'تحديث تنبيهات النظام', icon: const Icon(Icons.refresh)),
      ]),
      if (_loading) const LinearProgressIndicator(),
      if (_unavailable) const Padding(
        padding: EdgeInsets.all(8),
        child: Text('تعذّر تحميل تنبيهات الغرف الآن؛ النتائج قد تكون ناقصة.')),
      if (_error != null) Padding(
        padding: const EdgeInsets.all(12), child: Text(_error!)),
      if (_type == 'images') const Padding(
        padding: EdgeInsets.all(18),
        child: Text('مراقبة الصور لم تُفعّل بعد. لا توجد نتائج فحص صور '
            'موثوقة لعرضها في هذا القسم.')),
      Expanded(child: selected.isEmpty
        ? Center(child: Text(_type == 'images'
          ? 'فحص الصور غير متاح حاليًا'
          : 'لا توجد تنبيهات في العينة المحدودة'))
        : ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: selected.length,
            itemBuilder: (context, i) {
              final item = selected[i];
              final when = (item['createdAtMs'] as num?)?.toInt() ?? 0;
              return Card(child: ListTile(
                title: const Text('تنبيه كلمة محظورة'),
                subtitle: Text(
                  'الحساب: ${item['actorUid'] ?? 'غير محدد'}'
                  '\nالمكان: ${item['surface'] ?? 'غير معروف'}'
                  '\nالتاريخ: ${when > 0 ? DateTime.fromMillisecondsSinceEpoch(when).toLocal().toString().substring(0,16) : 'غير معروف'}'
                  '\nالحالة: ${item['status'] == 'reviewed' ? 'تمت المراجعة' : 'بانتظار المراجعة'}',
                ),
                trailing: Wrap(
                  spacing: 2,
                  children: [
                    if (_canViewSensitiveEvidence &&
                        item['hasSensitiveEvidence'] == true)
                      IconButton(
                        tooltip: 'فتح النص الأصلي بصلاحية الأدلة',
                        onPressed: _loading ? null
                            : () => _openEvidence(item),
                        icon: const Icon(Icons.lock_open_outlined),
                      ),
                    if (_canReview && item['status'] != 'reviewed')
                      TextButton(
                        onPressed: _loading ? null
                            : () => _markReviewed(item),
                        child: const Text('تمت المراجعة'),
                      ),
                  ],
                ),
              ));
            },
          )),
    ]);
  }
}
