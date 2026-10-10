import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import 'admin_account_identity_tile.dart';
import 'control_api_endpoints.dart';
import 'control_firebase.dart';

String generalReportErrorMessage(Object error) {
  final raw = error.toString().replaceFirst('Bad state: ', '');
  return switch (raw) {
    'forbidden' => 'ما عندك صلاحية لمراجعة البلاغ.',
    'recent_auth_required' => 'سجّل الدخول من جديد لتأكيد الإجراء.',
    'report_not_found' => 'هذا البلاغ غير موجود. حدّث القائمة.',
    'invalid_report_transition' => 'حالة البلاغ تغيرت. حدّث القائمة وحاول مجدداً.',
    'invalid_reason' => 'اكتب سبباً واضحاً بين 3 و200 حرف.',
    'invalid_idempotency_key' => 'تعذّر تسجيل العملية. أعد المحاولة.',
    _ => 'تعذّر تنفيذ الطلب. تحقق من الاتصال وأعد المحاولة.',
  };
}

class GeneralReportItem {
  const GeneralReportItem(this.data);
  final Map<String, dynamic> data;
  String field(String key) => (data[key] ?? '').toString().trim();
  String get id => field('reportId');
  String get type => field('type');
  String get status => field('status');
  String get reporterUid => field('reporterUid');
  String get targetUid => field('targetUid');
  Map<String, dynamic> mapField(String key) {
    final value = data[key];
    return value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
  }

  String get title => switch (type) {
    'user_report' => 'بلاغ عن مستخدم في المحادثة',
    'room_message_report' => 'بلاغ عن رسالة داخل غرفة',
    'room_report' => 'بلاغ عن غرفة',
    _ => 'بلاغ مستخدم',
  };
  String get statusLabel => switch (status) {
    'open' || 'new' => 'جديد',
    'under_review' => 'قيد المراجعة',
    'rejected' => 'مرفوض',
    'actioned' => 'تم تسجيل إجراء',
    'closed' => 'مغلق',
    _ => 'حالة غير معروفة',
  };
  String get reasonLabel => switch (field('reason')) {
    'spam' => 'إزعاج أو رسائل متكررة',
    'harassment' || 'abuse' => 'مضايقة أو إساءة',
    'abusive_content' || 'inappropriate_content' => 'محتوى غير مناسب',
    'scam' => 'احتيال أو تضليل',
    'hate' => 'تحريض أو كراهية',
    'sexual' => 'محتوى غير لائق',
    'other' => 'سبب آخر',
    _ => field('reason').isEmpty ? 'لم يُذكر سبب' : field('reason'),
  };
}

class GeneralReportsService {
  static Future<Map<String, dynamic>> _post(
      String action, [Map<String, dynamic> payload = const {}]) async {
    final user = controlAuth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    final response = await http.post(
      shadowApiEndpoint('general-reports'),
      headers: <String, String>{
        'authorization': 'Bearer ' + token,
        'content-type': 'application/json',
      },
      body: jsonEncode(<String, dynamic>{'action': action, ...payload}),
    );
    Map<String, dynamic> result = {};
    try {
      final parsed = jsonDecode(response.body);
      if (parsed is Map) result = Map<String, dynamic>.from(parsed);
    } catch (_) {}
    if (response.statusCode != 200 || result['ok'] != true) {
      throw StateError((result['code'] ?? 'request_failed').toString());
    }
    return result;
  }

  static Future<Map<String, dynamic>> load({String? reportId}) =>
      reportId == null || reportId.isEmpty
          ? _post('listReports', const <String, dynamic>{'limit': 25})
          : _post('getReport', <String, dynamic>{'reportId': reportId});

  static Future<void> review(String reportId, String status, String reason) async {
    // Never append a potentially long report ID to the idempotency key.
    final key = 'grctl_' + DateTime.now().microsecondsSinceEpoch.toString();
    await _post('reviewReport', <String, dynamic>{
      'reportId': reportId,
      'status': status,
      'reason': reason,
      'idempotencyKey': key,
    });
  }
}

class GeneralReportsControlPage extends StatefulWidget {
  const GeneralReportsControlPage({super.key, this.initialReportId});
  final String? initialReportId;
  @override
  State<GeneralReportsControlPage> createState() =>
      _GeneralReportsControlPageState();
}

class _GeneralReportsControlPageState extends State<GeneralReportsControlPage> {
  bool _loading = false;
  bool _canReview = false;
  bool _capped = false;
  String? _error;
  List<GeneralReportItem> _items = [];
  final Set<String> _busy = {};

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() { _loading = true; _error = null; });
    try {
      final result = await GeneralReportsService.load(
        reportId: widget.initialReportId,
      );
      if (!mounted) return;
      final rawList = result['items'];
      final items = rawList is List
          ? rawList.whereType<Map>().map((row) => GeneralReportItem(
              Map<String, dynamic>.from(row))).toList()
          : result['item'] is Map
              ? [GeneralReportItem(Map<String, dynamic>.from(result['item'] as Map))]
              : <GeneralReportItem>[];
      setState(() {
        _items = items;
        _canReview = result['canReview'] == true;
        _capped = result['capped'] == true;
      });
    } catch (error) {
      if (mounted) setState(() => _error = generalReportErrorMessage(error));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _review(GeneralReportItem item, String nextStatus) async {
    if (_busy.contains(item.id)) return;
    final controller = TextEditingController();
    final label = switch (nextStatus) {
      'under_review' => 'وضع البلاغ قيد المراجعة',
      'rejected' => 'رفض البلاغ',
      'actioned' => 'تسجيل إجراء نُفّذ بالفعل',
      'closed' => 'إغلاق البلاغ',
      _ => 'تحديث البلاغ',
    };
    final reason = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(label),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (nextStatus == 'actioned')
              const Text(
                'هذا يوثّق إجراءً نُفّذ سابقاً؛ لا يحظر أي حساب تلقائياً.',
                style: TextStyle(color: Colors.amber),
              ),
            TextField(
              controller: controller,
              maxLength: 200,
              maxLines: 3,
              decoration: const InputDecoration(labelText: 'سبب القرار'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.length >= 3) Navigator.pop(dialogContext, value);
            },
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (!mounted || reason == null) return;
    setState(() => _busy.add(item.id));
    try {
      await GeneralReportsService.review(item.id, nextStatus, reason);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تحديث البلاغ')),
      );
      await _load();
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(generalReportErrorMessage(error))),
        );
      }
    } finally {
      if (mounted) setState(() => _busy.remove(item.id));
    }
  }

  Widget _identity(String label, String uid, Map<String, dynamic> profile) =>
      AdminAccountIdentityTile(
        roleLabel: label,
        identity: AdminAccountIdentity.fromProfile(uid, profile),
      );

  Widget _card(GeneralReportItem item) {
    final isNew = item.status == 'new' || item.status == 'open';
    final inReview = item.status == 'under_review';
    final evidence = item.mapField('evidence');
    final message = evidence['message'] is Map
        ? Map<String, dynamic>.from(evidence['message'] as Map)
        : <String, dynamic>{};
    final contextEntries = evidence['context'] is List
        ? (evidence['context'] as List).take(7).whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m)).toList()
        : <Map<String, dynamic>>[];
    final details = item.field('details');
    final roomId = item.field('roomId');
    final conversationId = item.field('conversationId');

    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      color: const Color(0xFF171123),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              const Icon(Icons.flag_outlined, color: Color(0xFFFFD54A)),
              const SizedBox(width: 8),
              Expanded(child: Text(item.title,
                  style: const TextStyle(fontWeight: FontWeight.w900))),
              Chip(label: Text(item.statusLabel)),
            ]),
            const SizedBox(height: 8),
            Text('السبب: ' + item.reasonLabel),
            if (details.isNotEmpty) Text('التفاصيل: ' + details),
            const SizedBox(height: 10),
            _identity('مقدّم البلاغ', item.reporterUid,
                item.mapField('reporterProfile')),
            const SizedBox(height: 8),
            _identity(
              item.type == 'room_report'
                  ? 'صاحب الغرفة المبلّغ عنها' : 'الحساب المبلّغ عليه',
              item.targetUid,
              item.mapField('targetProfile'),
            ),
            if (roomId.isNotEmpty)
              ListTile(
                dense: true,
                title: const Text('الغرفة المرتبطة'),
                subtitle: Text(roomId, maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            if (conversationId.isNotEmpty)
              ListTile(
                dense: true,
                title: const Text('المحادثة المرتبطة'),
                subtitle: Text(conversationId, maxLines: 1,
                    overflow: TextOverflow.ellipsis),
              ),
            if ((message['text'] ?? '').toString().isNotEmpty)
              SelectableText('الرسالة المبلّغ عنها: ' +
                  (message['text'] ?? '').toString()),
            if (contextEntries.isNotEmpty)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('الدليل المحفوظ من سياق الرسالة'),
                children: [
                  for (final entry in contextEntries)
                    ListTile(
                      dense: true,
                      title: Text((entry['displayName'] ?? 'مستخدم').toString()),
                      subtitle: SelectableText((entry['text'] ?? '').toString()),
                    ),
                ],
              ),
            if (item.field('reviewReason').isNotEmpty)
              Text('قرار سابق: ' + item.field('reviewReason')),
            Row(
              children: [
                Expanded(
                  child: Text(
                    'مرجع: ' + (item.id.length <= 18
                        ? item.id
                        : '…' + item.id.substring(item.id.length - 15)),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 11, color: Colors.white54),
                  ),
                ),
                IconButton(
                  tooltip: 'نسخ رقم البلاغ',
                  onPressed: () async {
                    await Clipboard.setData(ClipboardData(text: item.id));
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('تم نسخ رقم البلاغ')),
                      );
                    }
                  },
                  icon: const Icon(Icons.copy_rounded),
                ),
              ],
            ),
            if (_canReview && (isNew || inReview || item.status == 'actioned'))
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (isNew)
                    OutlinedButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'under_review'),
                      child: const Text('قيد المراجعة'),
                    ),
                  if (isNew || inReview)
                    OutlinedButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'rejected'),
                      child: const Text('رفض البلاغ'),
                    ),
                  if (inReview)
                    FilledButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'actioned'),
                      child: const Text('تسجيل إجراء منفّذ'),
                    ),
                  if (inReview || item.status == 'actioned')
                    OutlinedButton(
                      onPressed: _busy.contains(item.id)
                          ? null : () => _review(item, 'closed'),
                      child: const Text('إغلاق البلاغ'),
                    ),
                ],
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('بلاغات المستخدمين والغرف'),
      actions: [
        IconButton(
          tooltip: 'تحديث',
          onPressed: _loading ? null : _load,
          icon: const Icon(Icons.refresh_rounded),
        ),
      ],
    ),
    body: RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('بلاغات المحادثات والغرف',
              style: TextStyle(fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 6),
          const Text(
            'اضغط على بيانات الحساب لعرض الهوية العامة ونسخ ID. '
            'كل تغيير حالة ينفذه الخادم ويُسجل في سجل الإدارة.',
            style: TextStyle(color: Colors.white70),
          ),
          if (_capped)
            const Text(
              'تظهر أحدث البلاغات فقط؛ قد تحتاج البلاغات الأقدم مراجعة إضافية.',
              style: TextStyle(color: Colors.amber),
            ),
          if (_loading && _items.isEmpty)
            const Padding(
              padding: EdgeInsets.all(30),
              child: Center(child: CircularProgressIndicator()),
            ),
          if (_error != null)
            ListTile(
              title: const Text('تعذر تحميل البلاغات'),
              subtitle: Text(_error!),
              trailing: IconButton(onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded)),
            ),
          if (!_loading && _error == null && _items.isEmpty)
            const Card(
              child: Padding(
                padding: EdgeInsets.all(30),
                child: Center(child: Text('لا توجد بلاغات قيد المراجعة.')),
              ),
            ),
          for (final item in _items) _card(item),
        ],
      ),
    ),
  );
}
