import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';
import 'store_receipt_sample_summary.dart';
import 'store_financial_sources_panel.dart';
import 'store_global_daily_financial_panel.dart';

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
  bool _loadingMore = false;
  bool _reviewingBatch = false;
  bool _loadingFinancial = false;
  String? _financialCursor;
  Map<String, dynamic>? _financialPage;
  String? _financialError;
  int _financialPageNumber = 0;
  String? _batchNote;
  String? _nextCursor;
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
      _nextCursor = null;
      _loadingMore = false;
      _reviewingBatch = false;
      _batchNote = null;
      _loadingFinancial = false;
      _financialCursor = null;
      _financialPage = null;
      _financialError = null;
      _financialPageNumber = 0;
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
        // A page cursor embeds an operation reference: only the Owner may
        // receive or use it. Delegated viewers keep a bounded first page.
        _nextCursor = value['canVerifyReceipts'] == true &&
                value['nextCursor'] is String &&
                (value['nextCursor'] as String).isNotEmpty
            ? value['nextCursor'] as String : null;
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

  Future<void> _loadMore() async {
    if (_loading || _loadingMore || _reviewingBatch || !_canVerifyReceipts ||
        _nextCursor == null || _target == null ||
        _verifyingOperationId != null) return;
    final target = _target!;
    final cursor = _nextCursor!;
    final currentGeneration = _generation;
    setState(() { _loadingMore = true; _error = null; });
    try {
      final user = controlAuth.currentUser;
      if (user == null) throw StateError('unauthorized');
      final token = await user.getIdToken();
      if (token == null || token.isEmpty) throw StateError('unauthorized');
      final response = await http.post(
        shadowApiEndpoint('manage-store-purchases'),
        headers: {'authorization': 'Bearer $token',
          'content-type': 'application/json'},
        body: jsonEncode({'action': 'history',
          'targetId': target, 'cursor': cursor}),
      ).timeout(const Duration(seconds: 25));
      final value = jsonDecode(response.body);
      if (response.statusCode != 200 || value is! Map ||
          value['ok'] != true || value['searchedId'] != target ||
          value['canVerifyReceipts'] != true ||
          value['receipts'] is! List ||
          value['moreMayExist'] is! bool) {
        throw const FormatException('invalid_store_receipt_page');
      }
      final entries = value['receipts'] as List;
      if (entries.length > 50 || entries.any((x) => x is! Map ||
          x['operationId'] is! String ||
          x['productId'] is! String)) {
        throw const FormatException('invalid_store_receipt_page');
      }
      if (!mounted || currentGeneration != _generation ||
          _target != target || _nextCursor != cursor) return;
      // Never append duplicate operations if the request was retried or
      // older data was updated during navigation. No balances are fetched.
      final seen = _receipts.map((x) => x['operationId']).toSet();
      final fresh = entries
          .map((x) => Map<String, dynamic>.from(x as Map))
          .where((x) => seen.add(x['operationId'])).toList();
      setState(() {
        _receipts = [..._receipts, ...fresh];
        _more = value['moreMayExist'] as bool;
        _nextCursor = value['nextCursor'] is String &&
                (value['nextCursor'] as String).isNotEmpty
            ? value['nextCursor'] as String : null;
      });
    } catch (_) {
      if (!mounted || currentGeneration != _generation) return;
      setState(() => _error =
        'تعذّر تحميل الصفحة التالية. لم يُعد تحميل أي إيصال، حاول مجدداً.');
    } finally {
      if (mounted && currentGeneration == _generation) {
        setState(() => _loadingMore = false);
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
          Text('ملخص حالات أول 50 إيصالاً',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          const Text('لهذا الحساب فقط، من أول 50 إيصالاً مسترجعاً. '
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
    if (_loading || _reviewingBatch || _verifyingOperationId != null || !_canVerifyReceipts ||
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

  Future<void> _reviewFirstFive() async {
    if (_loading || _loadingMore || _reviewingBatch ||
        _verifyingOperationId != null || !_canVerifyReceipts ||
        _target == null) return;
    final selected = _receipts.where((row) =>
      row['operationId'] is String && row['productId'] is String)
        .take(5).map((row) => {
          'operationId': row['operationId'],
          'productId': row['productId'],
        }).toList(growable: false);
    if (selected.isEmpty) return;
    final target = _target!;
    final currentGeneration = _generation;
    setState(() { _reviewingBatch = true; _batchNote = null; });
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
          'action': 'review_selected', 'targetId': target,
          'operations': selected,
        }),
      ).timeout(const Duration(seconds: 25));
      final body = jsonDecode(response.body);
      if (response.statusCode != 200 || body is! Map ||
          body['ok'] != true ||
          body['scope'] != 'selected_operations_only' ||
          body['financialReportComplete'] != false ||
          body['netRevenueCertified'] != false ||
          body['inspected'] != selected.length ||
          body['evidence'] is! List ||
          (body['evidence'] as List).length != selected.length) {
        throw const FormatException('invalid_store_review');
      }
      final expected = selected.map((row) => row['operationId']).toSet();
      final results = body['evidence'] as List;
      if (results.any((x) => x is! Map ||
          !expected.contains(x['operationId']) ||
          x['verified'] is! bool)) {
        throw const FormatException('invalid_store_review');
      }
      if (!mounted || currentGeneration != _generation ||
          _target != target) return;
      setState(() {
        for (final item in results) {
          final result = Map<String, dynamic>.from(item as Map);
          _evidenceByOperation[result['operationId'] as String] = result;
        }
        _batchNote = 'تم فحص أدلة ${body['inspected']} عمليات محددة؛ '
          'المتطابقة: ${body['verified']}، '
          'تحتاج مراجعة: ${body['needsReview']}. '
          'ليست هذه إيرادات شاملة ولا تسوية مالية.';
      });
    } catch (_) {
      if (!mounted || currentGeneration != _generation) return;
      setState(() => _batchNote =
        'تعذّر فحص الدفعة. لم تتغير أرصدة المستخدمين أو بيانات الشراء.');
    } finally {
      if (mounted && currentGeneration == _generation) {
        setState(() => _reviewingBatch = false);
      }
    }
  }

  Future<void> _loadFinancialPage({bool next = false}) async {
    if (_loading || _loadingMore || _reviewingBatch ||
        _loadingFinancial || _verifyingOperationId != null ||
        !_canVerifyReceipts || _target == null ||
        (next && _financialCursor == null)) return;
    final target = _target!;
    final cursor = next ? _financialCursor : null;
    final generation = _generation;
    setState(() { _loadingFinancial = true; _financialError = null; });
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
          'action': 'financial_page', 'targetId': target,
          if (cursor != null) 'cursor': cursor,
        }),
      ).timeout(const Duration(seconds: 25));
      final data = jsonDecode(response.body);
      if (response.statusCode != 200 || data is! Map ||
          data['ok'] != true || data['searchedId'] != target ||
          data['scope'] != 'one_buyer_one_page' ||
          data['pageLimit'] != 10 || data['inspected'] is! int ||
          (data['inspected'] as int) > 10 ||
          data['verified'] is! int || data['needsReview'] is! int ||
          data['verifiedPurchases'] is! int ||
          data['verifiedRenewals'] is! int ||
          data['verifiedPurchaseCoins'] is! int ||
          data['verifiedRenewalCoins'] is! int ||
          data['refundReview'] is! int ||
          data['hasMore'] is! bool ||
          data['partialEvidenceOnly'] != true ||
          data['financialReportComplete'] != false ||
          data['netRevenueCertified'] != false ||
          data['refundSettlementCertified'] != false ||
          data['evidence'] is! List ||
          (data['evidence'] as List).length != data['inspected']) {
        throw const FormatException('invalid_store_finance_page');
      }
      if (!mounted || generation != _generation || _target != target ||
          (next && cursor != _financialCursor)) return;
      setState(() {
        _financialPage = Map<String, dynamic>.from(data);
        _financialCursor = data['nextCursor'] is String &&
                (data['nextCursor'] as String).isNotEmpty
            ? data['nextCursor'] as String : null;
        _financialPageNumber = next ? _financialPageNumber + 1 : 1;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() => _financialError =
        'تعذّر فحص أدلة الصفحة المالية، ولم يتم تغيير أي رصيد.');
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loadingFinancial = false);
      }
    }
  }

  Widget _financialEvidencePanel() {
    final page = _financialPage;
    Widget count(String label, Object? value) =>
      Chip(label: Text('$label: $value'));
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('تدقيق الإيصالات المالية — للمالك',
            style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          const Text('فحص موثّق لإيصالات هذا الحساب، حتى 10 بكل صفحة. '
            'تُطابق العملية مع إيصالها وقيد الكوينز وسجل التنفيذ والتدقيق. '
            'أي استرداد أو نقص أو اختلاف يبقى بحاجة لمراجعة. '
            'الأرقام هنا للعمليات المثبتة في الصفحة فقط، '
            'وليست إيرادات المتجر الشاملة أو صافي المبيعات.'),
          const SizedBox(height: 8),
          FilledButton.tonalIcon(
            onPressed: _loadingFinancial || _loadingMore || _loading ||
                _reviewingBatch || _verifyingOperationId != null
                ? null : () => _loadFinancialPage(),
            icon: const Icon(Icons.receipt_long_outlined),
            label: Text(_loadingFinancial
              ? 'جارٍ فحص الأدلة...' : 'فحص أول 10 إيصالات'),
          ),
          if (_loadingFinancial) const LinearProgressIndicator(),
          if (_financialError != null)
            Text(_financialError!,
              style: const TextStyle(color: Colors.orangeAccent)),
          if (page != null) ...[
            const SizedBox(height: 12),
            Text('صفحة التدقيق: $_financialPageNumber'),
            Wrap(spacing: 6, runSpacing: 4, children: [
              count('تم فحصها', page['inspected']),
              count('عمليات مطابقة', page['verified']),
              count('شراء مطابق', page['verifiedPurchases']),
              count('تجديد مطابق', page['verifiedRenewals']),
              count('تحتاج مراجعة', page['needsReview']),
              count('استرداد يحتاج مراجعة', page['refundReview']),
              count('كوينز شراء مثبتة بهذه الصفحة',
                page['verifiedPurchaseCoins']),
              count('كوينز تجديد مثبتة بهذه الصفحة',
                page['verifiedRenewalCoins']),
            ]),
            const SizedBox(height: 8),
            for (final record in (page['evidence'] as List))
              if (record is Map)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Text(record['verified'] == true
                    ? 'عملية ${record['operationId']} — '
                      'مطابقة (${record['kind'] == 'renew' ? 'تجديد' : 'شراء'}) '
                      'بقيمة ${record['certifiedAmountCoins']} كوينز.'
                    : 'سجل يحتاج مراجعة: '
                      '${record['code'] ?? 'بيانات غير مكتملة'}'),
                ),
            if (page['hasMore'] == true &&
                _financialCursor != null)
              OutlinedButton.icon(
                onPressed: _loadingFinancial || _loadingMore ||
                  _reviewingBatch || _verifyingOperationId != null
                    ? null : () => _loadFinancialPage(next: true),
                icon: const Icon(Icons.navigate_next),
                label: const Text('فحص الصفحة المالية التالية'),
              ),
            if (page['hasMore'] == true &&
                _financialCursor == null)
              const Text('تعذّر الاستمرار بأمان بسبب بيانات صفحة '
                'غير مكتملة. يلزم مراجعة السجلات.'),
            const Text('حتى لو انتهت الصفحات، لا يُعتبر التقرير '
              'إقفالاً للمحاسبة أو إثباتاً لاكتمال كل القيود.'),
          ],
        ],
      ),
    ));
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
        if (_canVerifyReceipts) _financialEvidencePanel(),
        if (_canVerifyReceipts)
          StoreFinancialSourcesPanel(targetId: _target!),
        if (_canVerifyReceipts)
          const StoreGlobalDailyFinancialPanel(),
        if (_canVerifyReceipts && _receipts.any((row) =>
            row['operationId'] is String && row['productId'] is String))
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: OutlinedButton.icon(
              onPressed: _loading || _loadingMore || _reviewingBatch ||
                  _verifyingOperationId != null ? null : _reviewFirstFive,
              icon: const Icon(Icons.fact_check_outlined),
              label: Text(_reviewingBatch
                  ? 'جارٍ فحص الأدلة...' : 'فحص أدلة أول 5 عمليات معروضة'),
            ),
          ),
        if (_batchNote != null) Padding(
          padding: const EdgeInsets.all(8),
          child: Text(_batchNote!),
        ),
        if (_receipts.isEmpty) const Card(child: ListTile(
          title: Text('لا توجد إيصالات شراء حقيقية محفوظة لهذا الحساب.'),
        )),
        for (final item in _receipts) _record(item),
        if (_nextCursor != null && _canVerifyReceipts)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: OutlinedButton.icon(
              onPressed: _loadingMore ? null : _loadMore,
              icon: const Icon(Icons.more_horiz),
              label: Text(_loadingMore
                  ? 'جارٍ تحميل الصفحة التالية...' : 'عرض 50 إيصالاً إضافياً'),
            ),
          ),
        if (_more) const Padding(
          padding: EdgeInsets.all(8),
          child: Text('قد توجد إيصالات إضافية. المعروض عينة أو صفحات '
            'لحساب واحد فقط، وليس تقرير مبيعات أو إيرادات كامل.'),
        ),
      ],
    ],
  );
}
