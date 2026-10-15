import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// One existing moderation endpoint; no independent polling or new main tab.
class AccountActionAppealsControlPage extends StatefulWidget {
  const AccountActionAppealsControlPage({
    super.key, this.initialOperationId, this.embedded = false,
  });

  final String? initialOperationId;
  final bool embedded;

  @override
  State<AccountActionAppealsControlPage> createState() =>
      _AccountActionAppealsControlPageState();
}

class _AccountActionAppealsControlPageState
    extends State<AccountActionAppealsControlPage> {
  bool _busy = false;
  bool _canReview = false;
  bool _capped = false;
  String? _error;
  List<Map<String, dynamic>> _appeals = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<Map<String, dynamic>> _post(
    String action, Map<String, dynamic> payload,
  ) async {
    final token = await controlAuth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('unauthorized');
    final response = await http.post(
      shadowApiEndpoint('general-reports'),
      headers: {'authorization': 'Bearer $token',
        'content-type': 'application/json'},
      body: jsonEncode({'action': action, ...payload}),
    ).timeout(const Duration(seconds: 15));
    final data = jsonDecode(response.body);
    if (response.statusCode != 200 || data is! Map ||
        data['ok'] != true) {
      throw StateError((data is Map ? data['code'] : null)
          ?.toString() ?? 'appeal_request_failed');
    }
    return Map<String, dynamic>.from(data);
  }

  Future<void> _load() async {
    if (_busy) return;
    setState(() { _busy = true; _error = null; });
    try {
      final selected = widget.initialOperationId;
      final result = await _post(
        selected == null ? 'listAccountActionAppeals' : 'getAccountActionAppeal',
        selected == null ? {} : {'operationId': selected},
      );
      if (!mounted) return;
      final items = result['appeals'] is List
          ? (result['appeals'] as List).whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e)).toList()
          : result['appeal'] is Map
              ? [Map<String, dynamic>.from(result['appeal'] as Map)]
              : <Map<String, dynamic>>[];
      setState(() {
        _appeals = items;
        _canReview = result['canReview'] == true;
        _capped = result['capped'] == true;
      });
    } catch (_) {
      if (mounted) setState(() =>
          _error = 'تعذّر تحميل الاعتراضات. تحقّق من صلاحياتك وحاول مجددًا.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  static String _actionName(String action) => switch (action) {
    'suspend' => 'تعليق الحساب',
    'ban' => 'حظر الحساب',
    'restrictPrivateMessages' => 'تقييد الرسائل الخاصة',
    'restrictRoomChat' => 'منع الكتابة بالغرف',
    'restrictRoomEntry' => 'منع دخول الغرف',
    'restrictRoomMic' => 'كتم المايكروفون',
    _ => 'إجراء إداري',
  };

  Future<void> _decide(Map<String, dynamic> item, String decision) async {
    if (_busy || !_canReview) return;
    final reasonController = TextEditingController();
    final reversalController = TextEditingController();
    final isAccept = decision == 'accepted';
    try {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: Text(isAccept ? 'قبول الاعتراض' : 'رفض الاعتراض'),
          content: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              if (isAccept)
                const Padding(
                  padding: EdgeInsets.only(bottom: 14),
                  child: Text(
                    'ارفع العقوبة أولًا من أدوات إدارة الحساب. '
                    'ثم أدخل رقم عملية الرفع؛ الخادم يتأكد أنها '
                    'تخص هذا القرار، ولن يعتبر الاعتراض مقبولًا '
                    'إذا لم يتم رفع العقوبة فعلًا.',
                  ),
                ),
              TextField(
                controller: reasonController,
                maxLength: 200,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'سبب القرار (مطلوب)',
                ),
              ),
              if (isAccept)
                TextField(
                  controller: reversalController,
                  maxLength: 180,
                  decoration: const InputDecoration(
                    labelText: 'رقم عملية رفع العقوبة',
                    helperText: 'من سجل إجراءات الحساب، بعد تنفيذ الرفع',
                  ),
                ),
            ]),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('تأكيد القرار'),
            ),
          ],
        ),
      );
      if (confirm != true || !mounted) return;
      final reason = reasonController.text.trim();
      if (reason.length < 3 || reason.length > 200 ||
          isAccept && reversalController.text.trim().length < 12) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('اكتب سببًا واضحًا وتأكد من رقم عملية رفع العقوبة.'),
        ));
        return;
      }
      setState(() => _busy = true);
      try {
        await _post('reviewAccountActionAppeal', {
          'operationId': (item['operationId'] ?? '').toString(),
          'decision': decision,
          'reason': reason,
          if (isAccept)
            'reversalOperationId': reversalController.text.trim(),
          'idempotencyKey':
              'account_appeal_${DateTime.now().microsecondsSinceEpoch}',
        });
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(isAccept
            ? 'تم التحقق من رفع العقوبة وقبول الاعتراض وإشعار المستخدم.'
            : 'تم رفض الاعتراض وتسجيل السبب وإشعار المستخدم.')),
        );
      } catch (error) {
        if (mounted) {
          final message = error.toString().contains('reversal_not_verified')
              ? 'لم يتم إثبات رفع هذه العقوبة تحديدًا. '
                'ارفعها أولًا ثم حاول قبول الاعتراض.'
              : 'تعذّر إتمام القرار. تحقق من الصلاحيات وحالة الاعتراض.';
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(message)),
          );
        }
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      await _load();
    } finally {
      reasonController.dispose();
      reversalController.dispose();
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      appBar: widget.embedded ? null : AppBar(
        title: const Text('اعتراضات الإجراءات الإدارية'),
        actions: [
          IconButton(onPressed: _busy ? null : _load,
            tooltip: 'تحديث', icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.all(16), children: [
          const Text(
            'اعتراضات على إجراءات منفّذة ومثبتة. '
            'الاعتراض لا يرفع العقوبة تلقائيًا.',
          ),
          if (_capped)
            const Text('تظهر 20 حالة فقط؛ حدّث القائمة بعد مراجعتها.'),
          if (_busy) const LinearProgressIndicator(),
          if (_error != null) ListTile(title: Text(_error!),
            trailing: IconButton(
              onPressed: _load, icon: const Icon(Icons.refresh))),
          if (!_busy && _appeals.isEmpty && _error == null)
            const ListTile(title: Text('لا توجد اعتراضات لهذه القائمة.')),
          for (final item in _appeals)
            Card(child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_actionName((item['action'] ?? '').toString()),
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                  Text('الحساب: ${item['userUid'] ?? '—'}'),
                  SelectableText('رقم الإجراء: ${item['operationId'] ?? '—'}'),
                  Text('البلاغ المرتبط: ${item['linkedReportId'] ?? '—'}'),
                  Text('توضيح المستخدم: '
                    '${(item['explanation'] ?? '').toString().isEmpty ? 'بدون توضيح' : item['explanation']}'),
                  if (item['status'] == 'under_review' && _canReview)
                    Wrap(spacing: 10, children: [
                      OutlinedButton(
                        onPressed: _busy ? null : () => _decide(item, 'rejected'),
                        child: const Text('رفض الاعتراض')),
                      FilledButton(
                        onPressed: _busy ? null : () => _decide(item, 'accepted'),
                        child: const Text('قبول بعد رفع العقوبة')),
                    ]),
                  if (item['status'] != 'under_review')
                    Text('النتيجة: ${item['status'] ?? '—'}'
                      ' — ${item['decisionReason'] ?? ''}'),
                ],
              ),
            )),
        ]),
      ),
    ),
  );
}
