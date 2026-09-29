import 'package:flutter/material.dart';

import '../services/host_my_agency_service.dart';
import '../services/owner_agency_service.dart';

class OwnerAgencyDashboardPage extends StatefulWidget {
  const OwnerAgencyDashboardPage({
    super.key,
    required this.initialCore,
  });

  final HostMyAgencyCoreData initialCore;

  @override
  State<OwnerAgencyDashboardPage> createState() =>
      _OwnerAgencyDashboardPageState();
}

class _OwnerAgencyDashboardPageState extends State<OwnerAgencyDashboardPage> {
  final HostMyAgencyService _service = HostMyAgencyService();
  final OwnerAgencyService _ownerService = OwnerAgencyService();

  late HostMyAgencyCoreData _data;
  OwnerAgencyPerformanceData? _performance;
  OwnerAgencyStatement? _statement;
  bool _refreshing = false;
  bool _performanceLoading = false;
  bool _statementLoading = false;
  String? _error;
  String? _performanceError;
  String? _statementError;

  @override
  void initState() {
    super.initState();
    _data = widget.initialCore;
    Future.microtask(_loadPerformance);
  }

  @override
  void dispose() {
    _service.close();
    _ownerService.close();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_refreshing) return;
    setState(() {
      _refreshing = true;
      _error = null;
    });
    try {
      final data = await _service.loadCore();
      if (!mounted) return;
      if (data.membershipRole != 'owner') {
        setState(() {
          _error = 'agency_owner_required';
          _refreshing = false;
        });
        return;
      }
      setState(() => _data = data);
      await _loadPerformance();
      if (!mounted) return;
      setState(() => _refreshing = false);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _refreshing = false;
      });
    }
  }

  Future<void> _loadPerformance() async {
    if (_performanceLoading) return;
    setState(() {
      _performanceLoading = true;
      _performanceError = null;
    });
    try {
      final data = await _ownerService.loadPerformance();
      if (!mounted) return;
      setState(() {
        _performance = data;
        _performanceLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _performanceError = error.toString();
        _performanceLoading = false;
      });
    }
  }

  Future<void> _loadPreviousStatement() async {
    if (_statementLoading) return;
    final month = _performance?.current.month;
    if (month == null || month.isEmpty) return;
    setState(() {
      _statementLoading = true;
      _statementError = null;
    });
    try {
      final statement =
          await _ownerService.loadStatement(_previousMonth(month));
      if (!mounted) return;
      setState(() {
        _statement = statement;
        _statementLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _statementError = error.toString();
        _statementLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final ownerAllowed = _data.membershipRole == 'owner';

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070914),
        appBar: AppBar(
          title: const Text('لوحة مالك الوكالة'),
          backgroundColor: const Color(0xFF0B1020),
        ),
        body: !ownerAllowed
            ? const _OwnerGuard()
            : RefreshIndicator(
                onRefresh: _refresh,
                child: ListView(
                  key: const Key('owner-agency-dashboard'),
                  padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
                  children: [
                    _AgencyIdentityCard(data: _data),
                    const SizedBox(height: 16),
                    const _SectionTitle(
                      icon: Icons.person_pin_circle_rounded,
                      title: 'أدائي كمضيف',
                    ),
                    const SizedBox(height: 10),
                    _OwnerHostPerformanceCard(data: _data),
                    const SizedBox(height: 18),
                    const _SectionTitle(
                      icon: Icons.insights_rounded,
                      title: 'أرباح وأداء وكالتي',
                    ),
                    const SizedBox(height: 10),
                    _AgencyPerformanceCard(
                      data: _performance,
                      loading: _performanceLoading,
                      error: _performanceError,
                      onRetry: _loadPerformance,
                    ),
                    const SizedBox(height: 10),
                    _AgencyStatementCard(
                      statement: _statement,
                      loading: _statementLoading,
                      error: _statementError,
                      onLoad: _loadPreviousStatement,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      _RefreshErrorCard(onRetry: _refresh),
                    ],
                  ],
                ),
              ),
      ),
    );
  }
}

class _OwnerGuard extends StatelessWidget {
  const _OwnerGuard();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Text(
          'هذه الصفحة متاحة لمالك الوكالة فقط.',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.white70, fontSize: 16),
        ),
      ),
    );
  }
}

class _AgencyIdentityCard extends StatelessWidget {
  const _AgencyIdentityCard({required this.data});

  final HostMyAgencyCoreData data;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Row(
        children: [
          const CircleAvatar(
            radius: 28,
            backgroundColor: Color(0xFF6E49D8),
            child: Icon(
              Icons.apartment_rounded,
              color: Colors.white,
              size: 30,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  data.agency.name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 19,
                  ),
                ),
                const SizedBox(height: 5),
                Text(
                  'Agency ID: ${data.agency.publicId}',
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(color: Colors.white60),
                ),
              ],
            ),
          ),
          const Chip(
            avatar: Icon(
              Icons.workspace_premium_rounded,
              size: 17,
              color: Color(0xFFFFD875),
            ),
            label: Text('Owner'),
          ),
        ],
      ),
    );
  }
}

class _OwnerHostPerformanceCard extends StatelessWidget {
  const _OwnerHostPerformanceCard({required this.data});

  final HostMyAgencyCoreData data;

  @override
  Widget build(BuildContext context) {
    final target = data.target;
    final activity = data.activity;
    final denominator = target.targetCoins <= 0 ? 1 : target.targetCoins;
    final ratio =
        (target.progressCoins / denominator).clamp(0.0, 1.0).toDouble();

    return Container(
      key: const Key('owner-host-performance-card'),
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'التقدم',
                  value: _compact(target.progressCoins),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'الهدف',
                  value: _compact(target.targetCoins),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'Diamonds المدفوعة',
                  value: target.paidDiamonds.toString(),
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          LinearProgressIndicator(
            value: ratio,
            minHeight: 8,
            borderRadius: BorderRadius.circular(8),
          ),
          const SizedBox(height: 12),
          Text(
            target.nextLevel == null
                ? 'تم الوصول إلى أعلى Target متاح.'
                : 'يلزم للمستوى التالي: ${_compact(target.remainingCoins)} Coins',
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          const Divider(color: Color(0x22FFFFFF)),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'أيام النشاط',
                  value:
                      '${activity.qualifiedDays}/${activity.requiredQualifiedDays}',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'وقت المايك',
                  value: _minutes(activity.micSecondsMonth),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'المطلوب يوميًا',
                  value: '${activity.requiredMinutesPerDay}m',
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AgencyPerformanceCard extends StatelessWidget {
  const _AgencyPerformanceCard({
    required this.data,
    required this.loading,
    required this.error,
    required this.onRetry,
  });

  final OwnerAgencyPerformanceData? data;
  final bool loading;
  final String? error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading && data == null) {
      return Container(
        key: const Key('owner-agency-performance-loading'),
        padding: const EdgeInsets.all(18),
        decoration: _cardDecoration(),
        child: const Center(child: CircularProgressIndicator()),
      );
    }
    if (data == null) {
      return Container(
        key: const Key('owner-agency-performance-error'),
        padding: const EdgeInsets.all(18),
        decoration: _cardDecoration(),
        child: Column(
          children: [
            const Text(
              'تعذر تحميل أرباح وأداء الوكالة.',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: onRetry,
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }

    final current = data!.current;
    final bonus = current.bonus;
    return Container(
      key: const Key('owner-agency-performance-card'),
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'الشهر ${current.month}',
            style: const TextStyle(
              color: Color(0xFFB99CFF),
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'دعم الوكالة',
                  value: _compact(current.supportCoins),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'حصة الوكالة',
                  value: _compact(current.agencyBaseShareCoins),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'تقديري + Bonus',
                  value: _compact(current.estimatedAgencyPayableCoins),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'Hosts نشطون',
                  value:
                      '${current.activeHostCount}/${bonus.requiredActiveHosts}',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'عدد الهدايا',
                  value: _compact(current.giftCount),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'Bonus تقديري',
                  value: _compact(bonus.estimatedCoins),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            bonus.eligible
                ? 'Bonus الوكالة مؤهل حاليًا (${_bps(bonus.bps)}). يثبت نهائيًا عند إغلاق الشهر.'
                : 'Bonus الوكالة غير مؤهل حاليًا. التقييم النهائي يتم عند إغلاق الشهر.',
            style: const TextStyle(color: Colors.white70, height: 1.4),
          ),
          const SizedBox(height: 14),
          const Divider(color: Color(0x22FFFFFF)),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  label: 'محفظة الوكالة',
                  value: '${current.wallet.diamonds} D',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'Carryover Coins',
                  value: _compact(current.wallet.remainderCoins),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'Lifetime Diamonds',
                  value: current.wallet.lifetimeDiamonds.toString(),
                ),
              ),
            ],
          ),
          if (error != null) ...[
            const SizedBox(height: 10),
            const Text(
              'آخر تحديث لم يكتمل؛ المعروض هو آخر بيانات ناجحة.',
              style: TextStyle(color: Colors.amberAccent, fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }
}

class _AgencyStatementCard extends StatelessWidget {
  const _AgencyStatementCard({
    required this.statement,
    required this.loading,
    required this.error,
    required this.onLoad,
  });

  final OwnerAgencyStatement? statement;
  final bool loading;
  final String? error;
  final Future<void> Function() onLoad;

  @override
  Widget build(BuildContext context) {
    final value = statement;
    return Container(
      key: const Key('owner-agency-statement-card'),
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'كشف الشهر السابق',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 8),
          if (value == null && !loading)
            const Text(
              'لا يتم تحميل الكشف تلقائيًا لتخفيف الضغط. افتحه عند الحاجة.',
              style: TextStyle(color: Colors.white60, height: 1.4),
            )
          else if (loading)
            const Center(child: CircularProgressIndicator())
          else if (value != null && !value.settled)
            Text(
              'الشهر ${value.month}: لا يوجد كشف مقفل حتى الآن.',
              style: const TextStyle(color: Colors.white70),
            )
          else if (value != null) ...[
            Text(
              'الشهر ${value.month}',
              style: const TextStyle(color: Color(0xFFB99CFF)),
            ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: _Metric(
                    label: 'Base Share',
                    value: _compact(value.agencyBaseShareCoins),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _Metric(
                    label: 'Bonus',
                    value: _compact(value.agencyBonusCoins),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: _Metric(
                    label: 'Diamonds',
                    value: value.agencyDiamonds.toString(),
                  ),
                ),
              ],
            ),
          ],
          if (error != null) ...[
            const SizedBox(height: 8),
            const Text(
              'تعذر تحميل الكشف.',
              style: TextStyle(color: Colors.redAccent),
            ),
          ],
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('owner-agency-load-statement'),
            onPressed: loading ? null : onLoad,
            icon: const Icon(Icons.receipt_long_rounded),
            label: Text(loading ? 'جارٍ التحميل...' : 'تحميل كشف الشهر السابق'),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  const _Metric({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF11182A),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          Text(
            value,
            textDirection: TextDirection.ltr,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white54, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.icon, required this.title});

  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: const Color(0xFFB99CFF)),
        const SizedBox(width: 8),
        Text(
          title,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 18,
            fontWeight: FontWeight.w800,
          ),
        ),
      ],
    );
  }
}

class _RefreshErrorCard extends StatelessWidget {
  const _RefreshErrorCard({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: _cardDecoration(),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              'تعذر تحديث بيانات الأداء.',
              style: TextStyle(color: Colors.white70),
            ),
          ),
          TextButton(
            onPressed: onRetry,
            child: const Text('إعادة المحاولة'),
          ),
        ],
      ),
    );
  }
}

BoxDecoration _cardDecoration() => BoxDecoration(
      color: const Color(0xFF0D1220),
      borderRadius: BorderRadius.circular(18),
      border: Border.all(color: const Color(0x223D5AFE)),
    );

String _compact(int value) {
  if (value >= 1000000) {
    final n = value / 1000000;
    return '${n.toStringAsFixed(n >= 10 || n % 1 == 0 ? 0 : 1)}M';
  }
  if (value >= 1000) {
    final n = value / 1000;
    return '${n.toStringAsFixed(n >= 10 || n % 1 == 0 ? 0 : 1)}K';
  }
  return value.toString();
}

String _bps(int bps) {
  final value = bps / 100;
  return value % 1 == 0 ? '${value.toInt()}%' : '${value.toStringAsFixed(2)}%';
}

String _previousMonth(String month) {
  final parts = month.split('-');
  if (parts.length != 2) return month;
  final year = int.tryParse(parts[0]);
  final monthNumber = int.tryParse(parts[1]);
  if (year == null || monthNumber == null || monthNumber < 1 || monthNumber > 12) {
    return month;
  }
  final previous = DateTime.utc(year, monthNumber, 0);
  return "${previous.year.toString().padLeft(4, '0')}-${previous.month.toString().padLeft(2, '0')}";
}

String _minutes(int seconds) {
  final minutes = (seconds / 60).floor();
  if (minutes >= 60) {
    final hours = minutes ~/ 60;
    final rest = minutes % 60;
    return rest == 0 ? '${hours}h' : '${hours}h ${rest}m';
  }
  return '${minutes}m';
}
