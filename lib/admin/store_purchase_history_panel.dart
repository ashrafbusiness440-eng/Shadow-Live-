import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';
import 'store_receipt_sample_summary.dart';

/// View-only server-authorized receipt history for one account at a time.
class StorePurchaseHistoryPanel extends StatefulWidget {
  const StorePurchaseHistoryPanel({super.key});

  @override
  State<StorePurchaseHistoryPanel> createState() =>
      _StorePurchaseHistoryPanelState();
}

class _StorePurchaseHistoryPanelState
    extends State<StorePurchaseHistoryPanel> {
  final _id = TextEditingController();
  bool _loading = false;
  String? _error;
  String? _target;
  bool _more = false;
  bool _canVerifyReceipts = false;
  String? _verifyingOperationId;
  final Map<String, Map<String, dynamic>> _evidenceByOperation = {};
  List<Map<String, dynamic>> _receipts = [];
  int _generation = 0;

  @override
  void dispose() {
    _generation++;
    _id.dispose();
    super.dispose();
  }

  String _date(Object? value) {
    if (value is! int) return 'غير محدد';
    final date = DateTime.fromMillisecondsSinceEpoch(value).toLocal();
    return '${date.day}/${date.month}/${date.year}';
  }

  Future<void> _load() async {
    if (_loading) return;
    final target = _id.text.trim();
    if (!RegExp(r'^[A-Za-z0-9_٠-٩۰-۹-]{1,128}$').hasMatch(target)) {
      setState(() { _error = 'أدخل معرّف المستخدم الصحيح.'; });
      return;
    }
    final currentGeneration = ++_generation;
    setState(() {
      _loading = true;
      _error = null;
      _target = null;
      _receipts = [];
      _more = false;
      _canVerifyReceipts = false;
      _verifyingOperationId = null;
      _evidenceByOperation.clear();
    });
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-purchases'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({'action': 'history', 'targetId': target}),
      ).timeout(const Duration(seconds: 25));
      final value = jsonDecode(response.body);
      if (value is! Map || response.statusCode != 200 ||
          value['ok'] != true || value['searchedId'] != target ||
          value['receipts'] is! List ||
          value['purchasingEnabled'] != false ||
          value['moreMayExist'] is! bool) {
        final code = value is Map ? value['code']?.toString() ?? '' : '';
        throw StateError(code.isEmpty ? 'request_failed' : code);
      }
      final records = value['receipts'] as List;
      if (records.length > 50 || records.any((x) => x is! Map)) {
        throw const FormatException('invalid_purchase_history');
      }
      if (!mounted || currentGeneration != _generation) return;
      setState(() {
        _target = target;
        _receipts = records.map((entry) =>
          Map<String, dynamic>.from(entry as Map)).toList(growable: false);
        _more = value['moreMayExist'] as bool;
        // Only a server-authorized Owner receives operation IDs and this flag.
        // An older Worker safely defaults to no verification action.
        _canVerifyReceipts = value['canVerifyReceipts'] == true;
      });
    } catch (error) {
      if (!mounted || currentGeneration != _generation) return;
      final code = error.toString();
      setState(() {
        _error = code.contains('recent_auth_required')
            ? 'يلزم تسجيل دخول حديث لعرض سجل المشتريات.'
            : code.contains('forbidden')
                ? 'لا تملك صلاحية عرض مشتريات المستخدمين.'
                : code.contains('not_found')
                    ? 'هذا المستخدم غير موجود.'
                    : 'تعذّر تحميل السجل. تحقق من الاتصال وحاول مجدداً.';
      });
    } finally {
      if (mounted && currentGeneration == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  String _delivery(String value) => switch (value) {
    'delivered' => 'تم التسليم',
    'pending' => 'قيد التنفيذ',
    'failed' => 'تعذّر التسليم',
    _ => 'غير معروف',
  };

  String _refund(String value) => switch (value) {
    'none' => 'لا يوجد استرداد',
    'requested' => 'طلب استرداد',
    'refunded' => 'تم الاسترداد',
    'rejected' => 'تم رفض الاسترداد',
    _ => 'غير معروف',
  };

  Widget _receiptSampleSummary() {
    final sample = StoreReceiptSampleSummary.fromEntries(_receipts);
    Widget stat(String label, int value) => Chip(label: Text('$label: $value'));
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('ملخص حالات الإيصالات المعروضة',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          const Text('لهذا الحساب فقط، من النتائج المسترجعة (حتى 50 إيصالاً). '
              'هذه أعداد حالات، وليست إجمالي مبيعات أو إيرادات أو '
              'إثباتاً لصحة رصيد الكوينز. وقد توجد إيصالات أخرى.'),
          const SizedBox(height: 8),
          Wrap(spacing: 8, runSpacing: 4, children: [
            stat('إيصالات تمت مراجعتها', sample.inspected),
            stat('تم التسليم', sample.delivered),
            stat('قيد التنفيذ', sample.pending),
            stat('تعذّر التسليم', sample.failed),
            stat('حالة تسليم غير معروفة', sample.unknownDelivery),
            stat('طلبات استرداد', sample.refundRequested),
            stat('تم الاسترداد', sample.refunded),
            stat('استرداد مرفوض', sample.refundRejected),
            stat('حالة استرداد غير معروفة', sample.unknownRefund),
            stat('تحتاج مراجعة حالة', sample.reviewFlagged),
          ]),
        ],
      ),
    ));
  }

  Future<void> _verifyEvidence(String operationId, String productId) async {
    if (_loading || _verifyingOperationId != null || !_canVerifyReceipts ||
        _target == null) return;
    final target = _target!;
    final currentGeneration = _generation;
    setState(() {
      _verifyingOperationId = operationId;
      _evidenceByOperation.remove(operationId);
    });
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-purchases'),
        headers: {'authorization': 'Bearer $token',
          'content-type': 'application/json'},
        body: jsonEncode({
          'action': 'verify_operation',
          'targetId': target,
          'operationId': operationId,
          'productId': productId,
        }),
      ).timeout(const Duration(seconds: 25));
      final parsed = jsonDecode(response.body);
      if (response.statusCode != 200 || parsed is! Map ||
          parsed['ok'] != true || parsed['operationId'] != operationId ||
          parsed['verified'] is! bool) throw const FormatException();
      if (parsed['verified'] == true &&
          (!(parsed['kind'] == 'purchase' || parsed['kind'] == 'renew') ||
           parsed['certifiedAmountCoins'] is! int ||
           (parsed['certifiedAmountCoins'] as int) <= 0)) {
        throw const FormatException();
      }
      if (!mounted || currentGeneration != _generation) return;
      setState(() => _evidenceByOperation[operationId] =
        Map<String, dynamic>.from(parsed));
    } catch (_) {
      if (!mounted || currentGeneration != _generation) return;
      setState(() => _evidenceByOperation[operationId] = {
        'verified': false, 'code': 'unavailable',
      });
    } finally {
      if (mounted && currentGeneration == _generation) {
        setState(() => _verifyingOperationId = null);
      }
    }
  }

  String _evidenceText(Map<String, dynamic> evidence) {
    if (evidence['verified'] == true) {
      return 'تم تطابق أدلة هذه العملية: '
          '${evidence['certifiedAmountCoins']} كوينز. '
          'هذا تحقق تاريخي لعملية واحدة، وليس إثباتاً للرصيد الحالي '
          'أو لإجمالي الإيرادات.';
    }
    return switch (evidence['code']) {
      'requires_refund_review' =>
        'توجد حالة استرداد تستلزم مراجعة منفصلة. لم يتم اعتماد العملية.',
      'incomplete_evidence' || 'not_found' =>
        'أدلة العملية غير مكتملة أو غير موجودة. يلزم مراجعتها.',
      'operation_mismatch' || 'receipt_mismatch' ||
      'ledger_mismatch' || 'audit_mismatch' =>
        'يوجد اختلاف بين سجلات العملية. يلزم مراجعة البيانات.',
      _ => 'تعذّر التحقق من أدلة العملية. جرّب مجدداً.',
    };
  }

  Widget _record(Map<String, dynamic> item) {
    final operationId = item['operationId'];
    final eligible = _canVerifyReceipts && operationId is String &&
      RegExp(r'^[A-Za-z0-9_-]{12,100}$').hasMatch(operationId);
    final evidence = eligible ? _evidenceByOperation[operationId] : null;
    return Card(child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        ListTile(
          leading: const Icon(Icons.receipt_long_outlined),
          title: Text(item['nameAr']?.toString() ?? 'منتج من المتجر'),
          subtitle: Text(
            'رقم المنتج: ${item['productId']}\n'
            'السعر المسجل: ${item['priceCoins']} كوينز\n'
            'التاريخ: ${_date(item['acquiredAtMs'])} • '
            'الصلاحية: ${_date(item['expiresAtMs'])}\n'
            '${_delivery(item['deliveryStatus']?.toString() ?? '')} • '
            '${_refund(item['refundStatus']?.toString() ?? '')}',
          ),
          isThreeLine: true,
        ),
        if (eligible)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 12, end: 12, bottom: 8),
            child: Align(
              alignment: AlignmentDirectional.centerEnd,
              child: OutlinedButton.icon(
                onPressed: _loading || _verifyingOperationId != null
                    ? null : () => _verifyEvidence(
                        operationId, item['productId'].toString()),
                icon: const Icon(Icons.fact_check_outlined),
                label: Text(_verifyingOperationId == operationId
                    ? 'جارٍ التحقق...' : 'التحقق من أدلة الشراء'),
              ),
            ),
          ),
        if (evidence != null)
          Padding(
            padding: const EdgeInsetsDirectional.only(start: 12, end: 12, bottom: 12),
            child: Text(_evidenceText(evidence),
              style: TextStyle(color: evidence['verified'] == true
                ? Colors.green : Colors.orangeAccent)),
          ),
      ],
    ));
  }

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      const Card(child: ListTile(
        leading: Icon(Icons.lock_outline),
        title: Text('سجل مشتريات المتجر — قراءة فقط'),
        subtitle: Text('يعرض إيصالات شراء حقيقية محفوظة لحساب محدد، '
          'ولا ينشئ عمليات شراء أو يخصم الكوينز. الشراء غير مفعل حالياً.'),
      )),
      const SizedBox(height: 8),
      TextField(
        controller: _id,
        enabled: !_loading,
        textDirection: TextDirection.ltr,
        decoration: const InputDecoration(
          labelText: 'معرّف المستخدم (ID)',
          hintText: 'رقم المستخدم أو UID',
          border: OutlineInputBorder(),
          prefixIcon: Icon(Icons.person_search_outlined),
        ),
        onSubmitted: (_) => _load(),
      ),
      const SizedBox(height: 8),
      Align(alignment: Alignment.centerRight, child: FilledButton.icon(
        onPressed: _loading ? null : _load,
        icon: const Icon(Icons.search),
        label: const Text('عرض المشتريات'),
      )),
      if (_loading) const LinearProgressIndicator(),
      if (_error != null) Padding(
        padding: const EdgeInsets.all(8),
        child: Text(_error!, style: const TextStyle(color: Colors.orangeAccent)),
      ),
      if (_target != null) ...[
        const SizedBox(height: 12),
        Text('السجل: ${_receipts.length} • الحساب: $_target'),
        if (_receipts.isNotEmpty) _receiptSampleSummary(),
        if (_receipts.isEmpty) const Card(child: ListTile(
          title: Text('لا توجد إيصالات شراء حقيقية محفوظة لهذا الحساب.'),
        )),
        for (final item in _receipts) _record(item),
        if (_more) const Padding(
          padding: EdgeInsets.all(8),
          child: Text('يظهر أول 50 إيصالاً مسترجعاً فقط. '
            'هذا ليس السجل التاريخي الكامل.'),
        ),
      ],
    ],
  );
}
