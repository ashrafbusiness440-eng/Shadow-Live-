import 'package:flutter/material.dart';

import 'admin_notifications_page.dart';

/// Owner-only verification receipts. Never reconstruct deleted user profiles.
/// Read is bounded and explicit: no listeners, client Firestore queries or polling.
class DeletedAccountLogsPage extends StatefulWidget {
  const DeletedAccountLogsPage({super.key});

  @override
  State<DeletedAccountLogsPage> createState() => _DeletedAccountLogsPageState();
}

class _DeletedAccountLogsPageState extends State<DeletedAccountLogsPage> {
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _items = const [];
  bool _capped = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    if (_loading) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final result = await AdminInboxService.completedAccountDeletionLogs();
      if (!mounted) return;
      final raw = result['items'];
      setState(() {
        _items = raw is List
            ? raw.whereType<Map>().map((v) =>
                Map<String, dynamic>.from(v)).toList(growable: false)
            : const [];
        _capped = result['capped'] == true;
      });
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر تحميل سجلات الحذف. تأكد من صلاحية الأونر.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  String _time(dynamic value) {
    final raw = (value ?? '').toString();
    final dt = DateTime.tryParse(raw);
    if (dt == null) return 'غير مسجّل';
    return dt.toLocal().toString().split('.').first;
  }

  String _financial(dynamic status) => switch (status) {
        'settled' => 'تمت التسوية',
        'retained_under_policy' => 'سجل مالي محفوظ وفق السياسة',
        'not_applicable' => 'لا تنطبق تسوية',
        _ => 'غير موثّق بعد',
      };

  String _evidence(dynamic status) => switch (status) {
        'none' => 'لا توجد أدلة محتفظ بها',
        'retained_under_policy' => 'أدلة محفوظة وفق السياسة',
        'expired' => 'انتهى الاحتفاظ',
        _ => 'غير موثّق بعد',
      };

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          appBar: AppBar(title: const Text('سجلات الحسابات المحذوفة'),
            actions: [
              IconButton(tooltip: 'تحديث', onPressed: _loading ? null : _load,
                icon: const Icon(Icons.refresh)),
            ]),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text(
                'يعرض هذا القسم عمليات الحذف المكتملة والمتحقق منها فقط، '
                'ولا يعرض الحسابات المعلقة أو بيانات المستخدم الشخصية أو الأدلة الحساسة.',
              ),
              const SizedBox(height: 12),
              if (_loading) const LinearProgressIndicator(),
              if (_error != null)
                Card(child:ListTile(
                  leading: const Icon(Icons.error_outline),
                  title: Text(_error!),
                )),
              if (!_loading && _error == null && _items.isEmpty)
                const Card(child: ListTile(
                  leading: Icon(Icons.verified_user_outlined),
                  title: Text('لا توجد عمليات حذف مكتملة وموثّقة'),
                  subtitle: Text('طلبات الحذف قيد الانتظار والمراجعة ليست عمليات حذف مكتملة.'),
                )),
              ..._items.map((item) => Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Row(children: [
                        Icon(Icons.verified_user_outlined, size: 20),
                        SizedBox(width: 8),
                        Text('حذف مكتمل ومتحقّق منه',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                      ]),
                      const SizedBox(height: 8),
                      SelectableText('رقم العملية: ${item['operationId'] ?? '—'}'),
                      Text('تاريخ الطلب: ${_time(item['requestedAt'])}'),
                      Text('تاريخ الإتمام: ${_time(item['completedAt'])}'),
                      Text('المنفّذ: ${item['executor'] == 'owner' ? 'الأونر' : item['executor'] == 'system' ? 'النظام' : 'غير مسجّل'}'),
                      Text('التسوية: ${_financial(item['financialStatus'])}'),
                      Text('الأدلة: ${_evidence(item['evidenceStatus'])}'),
                      if (item['retentionCategories'] is List &&
                          (item['retentionCategories'] as List).isNotEmpty)
                        const Text('توجد فئات احتفاظ مسموح بها ضمن سجل العملية.'),
                    ],
                  ),
                ),
              )),
              if (_capped) const Padding(
                padding: EdgeInsets.all(8),
                child: Text('تُعرض أول 20 عملية مكتملة كحد أقصى.'),
              ),
            ],
          ),
        ),
      );
}
