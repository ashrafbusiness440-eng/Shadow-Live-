import 'package:flutter/material.dart';

import '../services/host_my_agency_service.dart';

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

  late HostMyAgencyCoreData _data;
  bool _refreshing = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _data = widget.initialCore;
  }

  @override
  void dispose() {
    _service.close();
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
      setState(() {
        _data = data;
        _refreshing = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _refreshing = false;
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

String _minutes(int seconds) {
  final minutes = (seconds / 60).floor();
  if (minutes >= 60) {
    final hours = minutes ~/ 60;
    final rest = minutes % 60;
    return rest == 0 ? '${hours}h' : '${hours}h ${rest}m';
  }
  return '${minutes}m';
}
