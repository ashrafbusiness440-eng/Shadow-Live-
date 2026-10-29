import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Owner-only, read-only Store source parity. No wallet or settlement action.
/// The parent hides it from delegated admins, and the Worker rechecks Owner.
class StoreFinancialSourcesPanel extends StatefulWidget {
  final String targetId;
  const StoreFinancialSourcesPanel({super.key, required this.targetId});

  @override
  State<StoreFinancialSourcesPanel> createState() =>
      _StoreFinancialSourcesPanelState();
}

class _StoreFinancialSourcesPanelState
    extends State<StoreFinancialSourcesPanel> {
  String _source = 'operations';
  String? _cursor;
  Map<String, dynamic>? _page;
  String? _error;
  bool _loading = false;
  int _pageNumber = 0;
  int _generation = 0;

  static const _labels = <String, String>{
    'operations': 'عمليات الشراء والتجديد',
    'ledger': 'قيود خصم الكوينز',
    'audit': 'سجلات التدقيق',
  };

  @override
  void didUpdateWidget(covariant StoreFinancialSourcesPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.targetId != oldWidget.targetId) {
      _generation++;
      _page = null;
      _cursor = null;
      _error = null;
      _loading = false;
      _pageNumber = 0;
    }
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  void _selectSource(String source) {
    if (_loading || _source == source) return;
    setState(() {
      _generation++;
      _source = source;
      _cursor = null;
      _page = null;
      _error = null;
      _pageNumber = 0;
    });
  }

  Future<void> _load({bool next = false}) async {
    if (_loading || (next && _cursor == null)) return;
    final source = _source;
    final targetId = widget.targetId;
    final cursor = next ? _cursor : null;
    final generation = ++_generation;
    setState(() { _loading = true; _error = null; });
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
          'action': 'financial_source_page',
          'targetId': targetId,
          'source': source,
          if (cursor != null) 'cursor': cursor,
        }),
      ).timeout(const Duration(seconds: 25));
      final body = jsonDecode(response.body);
      if (response.statusCode != 200 || body is! Map ||
          body['ok'] != true || body['searchedId'] != targetId ||
          body['source'] != source ||
          body['scope'] != 'one_buyer_source_page' ||
          body['pageLimit'] != 10 ||
          body['inspected'] is! int || body['verified'] is! int ||
          body['needsReview'] is! int ||
          (body['inspected'] as int) < 0 ||
          (body['inspected'] as int) > 10 ||
          body['verifiedPurchaseCoins'] is! int ||
          body['verifiedRenewalCoins'] is! int ||
          body['orphanOrConflicting'] is! int ||
          body['hasMore'] is! bool ||
          body['partialEvidenceOnly'] != true ||
          body['financialReportComplete'] != false ||
          body['netRevenueCertified'] != false ||
          body['refundSettlementCertified'] != false ||
          body['evidence'] is! List ||
          (body['evidence'] as List).length != body['inspected']) {
        throw const FormatException('invalid_source_report');
      }
      if (!mounted || generation != _generation ||
          widget.targetId != targetId || source != _source ||
          (next && _cursor != cursor)) return;
      setState(() {
        _page = Map<String, dynamic>.from(body);
        _cursor = body['nextCursor'] is String &&
                (body['nextCursor'] as String).isNotEmpty
            ? body['nextCursor'] as String : null;
        _pageNumber = next ? _pageNumber + 1 : 1;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() => _error =
        'تعذّر تدقيق مصدر السجلات. لم يحدث أي خصم أو تعديل مالي.');
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final report = _page;
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('كشف القيود والسجلات غير المطابقة',
            style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          const Text('تدقيق مستقل لكل مصدر لهذا الحساب فقط؛ '
            'يكشف العمليات أو قيود الخصم أو سجلات التدقيق '
            'التي لا تملك أدلة شراء كاملة. حتى 10 سجلات بالصفحة. '
            'لا يمثّل إجمالي مبيعات المتجر أو تسوية الاستردادات.'),
          const SizedBox(height: 8),
          Wrap(spacing: 5, runSpacing: 4, children: [
            for (final entry in _labels.entries)
              ChoiceChip(
                label: Text(entry.value),
                selected: _source == entry.key,
                onSelected: _loading ? null : (selected) {
                  if (selected) _selectSource(entry.key);
                },
              ),
          ]),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading ? null : () => _load(),
            icon: const Icon(Icons.fact_check_outlined),
            label: Text(_loading ? 'جارٍ التدقيق...' :
              'فحص أول 10 من ${_labels[_source]}'),
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Text(_error!, style: const TextStyle(
              color: Colors.orangeAccent)),
          if (report != null) ...[
            Text('الصفحة: $_pageNumber • '
              'فُحص: ${report['inspected']} • '
              'متطابق: ${report['verified']} • '
              'يحتاج مراجعة: ${report['needsReview']}'),
            Text('كوينز شراء مثبتة بهذه الصفحة: '
              '${report['verifiedPurchaseCoins']} • '
              'تجديد: ${report['verifiedRenewalCoins']}'),
            const SizedBox(height: 6),
            for (final item in report['evidence'] as List)
              if (item is Map)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(item['verified'] == true
                    ? 'مطابق: ${item['operationId']}'
                    : 'يحتاج مراجعة: ${item['operationId'] ?? 'سجل غير سليم'} '
                      '(${item['code'] ?? 'غير معروف'})'),
                ),
            if (report['hasMore'] == true && _cursor != null)
              OutlinedButton.icon(
                onPressed: _loading ? null : () => _load(next: true),
                icon: const Icon(Icons.navigate_next),
                label: const Text('تدقيق الصفحة التالية من هذا المصدر'),
              ),
            if (report['paginationBlocked'] == true)
              const Text('توقّف التنقل لأن مؤشّر الصفحة التالية غير '
                'موثوق. يحتاج السجل مراجعة منفصلة.'),
            const SizedBox(height: 6),
            const Text('حتى لو انتهت صفحات مصدر واحد، لا يعني ذلك '
              'اكتمال بقية المصادر أو اعتماد الإيرادات العامة.'),
          ],
        ],
      ),
    ));
  }
}
