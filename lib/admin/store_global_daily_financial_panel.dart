import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

/// Read-only Owner daily financial investigation across ALL Store buyers.
/// Not a revenue report. Server rechecks Owner and recent authentication.
class StoreGlobalDailyFinancialPanel extends StatefulWidget {
  const StoreGlobalDailyFinancialPanel({super.key});
  @override
  State<StoreGlobalDailyFinancialPanel> createState() =>
      _StoreGlobalDailyFinancialPanelState();
}

class _StoreGlobalDailyFinancialPanelState
    extends State<StoreGlobalDailyFinancialPanel> {
  static const labels = <String, String>{
    'receipts': 'الإيصالات',
    'operations': 'العمليات',
    'ledger': 'قيود الكوينز',
    'audit': 'سجل التدقيق',
  };
  late DateTime _selectedDay;
  String _source = 'receipts';
  bool _loading = false;
  String? _error;
  String? _cursor;
  Map<String, dynamic>? _page;
  int _pageNumber = 0;
  int _generation = 0;
  int _coverageGeneration = 0;
  int _statementGeneration = 0;
  bool _loadingStatement = false;
  Map<String, dynamic>? _statement;
  String? _statementError;
  bool _loadingCoverage = false;
  Map<String, dynamic>? _coverage;
  String? _coverageError;

  @override
  void initState() {
    super.initState();
    final utc = DateTime.now().toUtc();
    _selectedDay = DateTime.utc(utc.year, utc.month, utc.day)
      .subtract(const Duration(days: 1));
  }

  @override
  void dispose() {
    _generation++;
    _coverageGeneration++;
    _statementGeneration++;
    super.dispose();
  }

  String _dayString() {
    final d = _selectedDay;
    return '${d.year.toString().padLeft(4, '0')}-'
        '${d.month.toString().padLeft(2, '0')}-'
        '${d.day.toString().padLeft(2, '0')}';
  }

  void _clearPage() {
    _generation++;
    _coverageGeneration++;
    _statementGeneration++;
    _statement = null;
    _statementError = null;
    _coverage = null;
    _coverageError = null;
    _page = null;
    _cursor = null;
    _error = null;
    _pageNumber = 0;
  }

  Future<void> _chooseDay() async {
    if (_loading || _loadingCoverage || _loadingStatement) return;
    final utc = DateTime.now().toUtc();
    final yesterday = DateTime.utc(utc.year, utc.month, utc.day)
      .subtract(const Duration(days: 1));
    final first = yesterday.subtract(const Duration(days: 364));
    final d = await showDatePicker(
      context: context,initialDate: _selectedDay.isBefore(first)
        ? first : _selectedDay.isAfter(yesterday) ? yesterday : _selectedDay,
      firstDate: first,lastDate: yesterday,
      helpText: 'اختر يوم التدقيق (بالتوقيت العالمي)',
    );
    if (!mounted || d == null) return;
    setState(() {
      _selectedDay = DateTime.utc(d.year, d.month, d.day);
      _clearPage();
    });
  }

  Future<void> _loadDailySettlement() async {
    if (_loading || _loadingCoverage || _loadingStatement) return;
    final day = _dayString();
    final generation = ++_statementGeneration;
    setState(() {
      _loadingStatement = true;
      _statement = null;
      _statementError = null;
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
          'action': 'global_financial_day_settlement',
          'day': day,
        }),
      ).timeout(const Duration(seconds: 40));
      final body = jsonDecode(response.body);
      if (response.statusCode != 200 || body is! Map ||
          body['ok'] != true ||
          body['scope'] !=
            'all_buyers_one_completed_utc_day_four_source_settlement' ||
          body['day'] != day ||
          body['perSourceLimit'] != 20 ||
          body['sourceCounts'] is! Map ||
          body['reviewStatus'] is! String ||
          body['periodAmountsAvailable'] is! bool ||
          body['snapshotIsolationCertified'] != false ||
          body['historicalDateCoverageCertified'] != false ||
          body['externalChargebacksCertified'] != false ||
          body['fullPeriodSettlementCertified'] != false ||
          body['financialReportComplete'] != false ||
          body['netRevenueCertified'] != false ||
          body['refundSettlementCertified'] != false ||
          body['productionFinancialWritesPerformed'] != false ||
          (body['reviewStatus'] != 'reviewed' &&
              body['reviewStatus'] != 'blocked')) {
        throw const FormatException('invalid_store_daily_statement');
      }
      final reviewed = body['reviewStatus'] == 'reviewed';
      if (reviewed != (body['periodAmountsAvailable'] == true) ||
          (reviewed && (
            body['inspected'] is! int ||
            body['verified'] != body['inspected'] ||
            body['inspected'] < 0 || body['inspected'] > 20 ||
            [body['reviewedGrossCoins'],body['reviewedRefundedCoins'],
              body['reviewedNetCoins'],body['reviewedPurchases'],
              body['reviewedRenewals']]
              .any((x) => x is! int || x < 0) ||
            body['reviewedGrossCoins'] !=
              body['reviewedRefundedCoins'] + body['reviewedNetCoins'])) ||
          (!reviewed && [
            body['reviewedGrossCoins'],body['reviewedRefundedCoins'],
            body['reviewedNetCoins'],
          ].any((x) => x != null))) {
        throw const FormatException('inconsistent_store_daily_statement');
      }
      if (!mounted || generation != _statementGeneration ||
          day != _dayString()) return;
      setState(() => _statement = Map<String, dynamic>.from(body));
    } catch (_) {
      if (!mounted || generation != _statementGeneration) return;
      setState(() => _statementError =
        'تعذّرت مراجعة عمليات اليوم بالكامل، ولم تُعدّل أي أرصدة.');
    } finally {
      if (mounted && generation == _statementGeneration) {
        setState(() => _loadingStatement = false);
      }
    }
  }

  Future<void> _loadCoverage() async {
    if (_loadingCoverage || _loading || _loadingStatement) return;
    final day = _dayString();
    final generation = ++_coverageGeneration;
    setState(() {
      _loadingCoverage = true;
      _coverageError = null;
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
          'action': 'global_financial_day_coverage',
          'day': day,
        }),
      ).timeout(const Duration(seconds: 25));
      final body = jsonDecode(response.body);
      if (response.statusCode != 200 || body is! Map ||
          body['ok'] != true ||
          body['scope'] != 'all_buyers_one_utc_day_indexed_counts' ||
          body['day'] != day ||
          body['countCap'] != 501 ||
          body['counts'] is! Map ||
          (body['counts'] as Map).length != 4 ||
          !labels.keys.every((key) =>
            body['counts'][key] is int &&
            body['counts'][key] >= 0 &&
            body['counts'][key] <= 501) ||
          body['cappedSources'] is! List ||
          body['cardinalitiesComparable'] is! bool ||
          body['sourceCountsEqual'] is! bool ||
          body['countMismatch'] is! bool ||
          body['historicalRowsWithoutDateNotCovered'] != true ||
          body['sourceCompletenessCertified'] != false ||
          body['recordsIndividuallyReconciled'] != false ||
          body['legacyBackfillCertified'] != false ||
          body['partialEvidenceOnly'] != true ||
          body['financialReportComplete'] != false ||
          body['netRevenueCertified'] != false ||
          body['refundSettlementCertified'] != false) {
        throw const FormatException('invalid_global_financial_coverage');
      }
      if (!mounted || generation != _coverageGeneration ||
          day != _dayString()) return;
      setState(() => _coverage = Map<String, dynamic>.from(body));
    } catch (_) {
      if (!mounted || generation != _coverageGeneration) return;
      setState(() => _coverageError =
        'تعذّرت مقارنة أعداد السجلات لهذا اليوم؛ لم يُعدّل أي رصيد.');
    } finally {
      if (mounted && generation == _coverageGeneration) {
        setState(() => _loadingCoverage = false);
      }
    }
  }

  Future<void> _load({bool next = false}) async {
    if (_loading || _loadingCoverage || _loadingStatement ||
        (next && _cursor == null)) return;
    final day = _dayString(),source = _source;
    final cursor = next ? _cursor : null;
    final generation = ++_generation;
    setState(() {_loading = true; _error = null;});
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
          'action': 'global_financial_day_page',
          'day': day,'source': source,
          if (cursor != null) 'cursor': cursor,
        }),
      ).timeout(const Duration(seconds: 25));
      final body = jsonDecode(response.body);
      if (response.statusCode != 200 || body is! Map ||
          body['ok'] != true ||
          body['scope'] != 'all_buyers_one_day_one_source_page' ||
          body['day'] != day || body['source'] != source ||
          body['pageLimit'] != 10 ||
          body['inspected'] is! int ||
          (body['inspected'] as int) < 0 ||
          (body['inspected'] as int) > 10 ||
          body['verified'] is! int || body['needsReview'] is! int ||
          body['verifiedPurchaseCoins'] is! int ||
          body['verifiedRenewalCoins'] is! int ||
          body['hasMore'] is! bool ||
          body['missingDateFieldsNotCovered'] != true ||
          body['sourceCompletenessCertified'] != false ||
          body['legacyBackfillCertified'] != false ||
          body['partialEvidenceOnly'] != true ||
          body['financialReportComplete'] != false ||
          body['netRevenueCertified'] != false ||
          body['refundSettlementCertified'] != false ||
          body['evidence'] is! List ||
          (body['evidence'] as List).length != body['inspected']) {
        throw const FormatException('invalid_store_global_daily_page');
      }
      if (!mounted || generation != _generation ||
          day != _dayString() || source != _source ||
          (next && cursor != _cursor)) return;
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
        'تعذّر فحص هذا اليوم. لم يُجرَ أي تعديل مالي.');
    } finally {
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final data = _page;
    return Card(child: Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('تدقيق مالي يومي — كل الحسابات',
            style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          const Text('يفحص سجلات يوم مكتمل عبر جميع المستخدمين، '
            'مصدرًا واحدًا في كل مرة وحتى 10 سجلات في الصفحة. '
            'قد لا تظهر السجلات القديمة التي تفتقد التاريخ المطلوب. '
            'المبالغ المثبتة هنا للصفحة فقط، وليست إيرادات المتجر.'),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading || _loadingCoverage || _loadingStatement
              ? null : _chooseDay,
            icon: const Icon(Icons.calendar_today_outlined),
            label: Text('اليوم (UTC): ${_dayString()}'),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading || _loadingCoverage || _loadingStatement
              ? null : _loadCoverage,
            icon: const Icon(Icons.compare_arrows_outlined),
            label: Text(_loadingCoverage
              ? 'جارٍ مقارنة أعداد المصادر...'
              : 'قارن عدد السجلات لهذا اليوم عبر المتجر'),
          ),
          if (_loadingCoverage) const LinearProgressIndicator(),
          if (_coverageError != null)
            Text(_coverageError!,
              style: const TextStyle(color: Colors.orangeAccent)),
          if (_coverage != null) ...[
            Wrap(spacing: 6,runSpacing: 4,children: [
              for (final entry in labels.entries)
                Chip(label: Text(
                  '${entry.value}: ${_coverage!['counts'][entry.key]}')),
            ]),
            Text(_coverage!['cardinalitiesComparable'] != true
              ? 'مصدر واحد أو أكثر وصل للحد (501). '
                'لا يمكن إثبات تساوي الأعداد؛ يلزم تدقيق مفصّل.'
              : _coverage!['countMismatch'] == true
                ? 'يوجد اختلاف في عدد السجلات بين المصادر لهذا اليوم. '
                  'راجع العمليات والقيود والإيصالات كلّاً على حدة.'
                : 'أعداد المصادر متساوية ضمن اليوم؛ '
                  'لكن لا يعني ذلك أن كل عملية مطابقة أو مكتملة.'),
            const Text('لا تُشمل السجلات التي لا تحمل تاريخًا مفهرسًا. '
              'هذه ليست إيرادات المتجر ولا صافي كوينز معتمدًا.'),
          ],
          const SizedBox(height: 12),
          Text('ملخص إجمالي ومسترد وصافي اليوم',
            style: Theme.of(context).textTheme.titleMedium),
          const Text('يطابق الإيصالات والعمليات وقيود الكوينز '
            'وسجلات التدقيق حسب رقم العملية لكل الحسابات، '
            'ويتحقق من إثبات الاسترداد بشكل منفصل. '
            'بحد 20 عملية لليوم؛ إذا زاد العدد أو نقص دليل '
            'فلا تُعرض مبالغ.'),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading || _loadingCoverage || _loadingStatement
              ? null : _loadDailySettlement,
            icon: const Icon(Icons.account_balance_outlined),
            label: Text(_loadingStatement
              ? 'جارٍ مطابقة العمليات والاستردادات...'
              : 'إعداد كشف اليوم من جميع المصادر'),
          ),
          if (_loadingStatement) const LinearProgressIndicator(),
          if (_statementError != null)
            Text(_statementError!,style: const TextStyle(
              color: Colors.orangeAccent)),
          if (_statement != null) ...[
            if (_statement!['reviewStatus'] == 'reviewed') ...[
              Text('عمليات متطابقة: ${_statement!['verified']}'),
              Text('إجمالي كوينز الشراء: '
                '${_statement!['reviewedGrossCoins']}'),
              Text('كوينز مستردة بإثبات: '
                '${_statement!['reviewedRefundedCoins']}'),
              Text('الصافي المراجع لهذا اليوم: '
                '${_statement!['reviewedNetCoins']}'),
              Text('شراء: ${_statement!['reviewedPurchases']} • '
                'تجديد: ${_statement!['reviewedRenewals']}'),
            ] else const Text('تعذّر إثبات تطابق جميع مصادر اليوم '
              'أو تجاوز عدد العمليات حد الفحص. '
              'تم حجب إجمالي وصافي الكوينز حتى المراجعة.'),
            const Text('هذا كشف مراجعة ليوم مكتمل ضمن السجلات '
              'المفهرسة فقط؛ لا يُثبت الإغلاق المحاسبي '
              'أو عدم وجود معاملات أو استردادات متأخرة '
              'أو اعتراضات مالية خارج النظام.'),
          ],
          const SizedBox(height: 8),
          Wrap(spacing: 5,runSpacing: 4,children: [
            for (final source in labels.entries)
              ChoiceChip(
                label: Text(source.value),
                selected: _source == source.key,
                onSelected: _loading || _loadingCoverage || _loadingStatement
                    ? null : (checked) {
                  if (!checked) return;
                  setState(() {
                    _source = source.key;
                    _clearPage();
                  });
                },
              ),
          ]),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: _loading || _loadingStatement
              ? null : () => _load(),
            icon: const Icon(Icons.fact_check_outlined),
            label: Text(_loading
              ? 'جارٍ التحقق...' : 'فحص أول 10 سجلات لهذا المصدر'),
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Text(_error!, style: const TextStyle(
              color: Colors.orangeAccent)),
          if (data != null) ...[
            const SizedBox(height: 8),
            Text('الصفحة: $_pageNumber • '
              'تم فحص: ${data['inspected']} • '
              'مطابق: ${data['verified']} • '
              'يحتاج مراجعة: ${data['needsReview']}'),
            Text('كوينز الشراء المثبتة بهذه الصفحة: '
              '${data['verifiedPurchaseCoins']} • '
              'التجديد: ${data['verifiedRenewalCoins']}'),
            for (final row in data['evidence'] as List)
              if (row is Map)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 3),
                  child: Text(row['verified'] == true
                    ? 'مطابق: ${row['buyerUid']} / '
                      '${row['operationId']}'
                    : 'يحتاج مراجعة: '
                      '${row['buyerUid'] ?? 'سجل'} / '
                      '${row['operationId'] ?? 'بدون رقم صالح'} '
                      '(${row['code'] ?? 'غير معلوم'})'),
                ),
            if (data['hasMore'] == true && _cursor != null)
              OutlinedButton.icon(
                onPressed: _loading ? null : () => _load(next: true),
                icon: const Icon(Icons.navigate_next),
                label: const Text('فحص 10 سجلات إضافية'),
              ),
            if (data['paginationBlocked'] == true)
              const Text('تم إيقاف المتابعة بسبب سجل غير سليم. '
                'لا يجوز اعتبار فحص اليوم مكتملًا.'),
            const SizedBox(height: 8),
            const Text('التدقيق اليومي لا يشمل السجلات التي بلا تاريخ '
              'مفهرس أو عمليات الاسترداد غير الموثّقة؛ '
              'ولا يعتمد إجمالي الإيرادات أو صافي الكوينز.'),
          ],
        ],
      ),
    ));
  }
}
