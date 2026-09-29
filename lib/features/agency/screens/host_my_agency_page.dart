import 'package:flutter/material.dart';

import '../../profile/screens/public_profile_screen.dart';
import '../services/host_my_agency_service.dart';

class HostMyAgencyPage extends StatefulWidget {
  const HostMyAgencyPage({super.key});

  @override
  State<HostMyAgencyPage> createState() => _HostMyAgencyPageState();
}

class _HostMyAgencyPageState extends State<HostMyAgencyPage> {
  final HostMyAgencyService _service = HostMyAgencyService();

  HostMyAgencyCoreData? _data;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _service.loadCore();
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  void _openOwner() {
    final owner = _data?.owner;
    if (owner == null || owner.uid.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: owner.uid),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070914),
        appBar: AppBar(
          title: const Text('معلومات وكالتي'),
          backgroundColor: const Color(0xFF0B1020),
        ),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null || _data == null) {
      return _ErrorState(onRetry: _load);
    }

    final data = _data!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
        children: [
          _AgencyHeader(data: data),
          const SizedBox(height: 16),
          _OwnerCard(owner: data.owner, onTap: _openOwner),
          const SizedBox(height: 16),
          _TargetCard(target: data.target),
          const SizedBox(height: 16),
          _ActivityCard(activity: data.activity),
        ],
      ),
    );
  }
}

class _AgencyHeader extends StatelessWidget {
  const _AgencyHeader({required this.data});

  final HostMyAgencyCoreData data;

  @override
  Widget build(BuildContext context) {
    final agency = data.agency;
    final active = data.membershipStatus == 'active';
    final logo = agency.logoUrl?.trim() ?? '';

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        children: [
          CircleAvatar(
            radius: 38,
            backgroundColor: const Color(0xFF6E49D8),
            backgroundImage: logo.isEmpty ? null : NetworkImage(logo),
            child: logo.isEmpty
                ? const Icon(
                    Icons.apartment_rounded,
                    size: 40,
                    color: Colors.white,
                  )
                : null,
          ),
          const SizedBox(height: 12),
          Text(
            agency.name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 23,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 5),
          Text(
            'Agency ID: ${agency.publicId}',
            textDirection: TextDirection.ltr,
            style: const TextStyle(color: Colors.white60),
          ),
          if (agency.country != null) ...[
            const SizedBox(height: 5),
            Text(
              agency.country!,
              style: const TextStyle(color: Colors.white70),
            ),
          ],
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            alignment: WrapAlignment.center,
            children: [
              _StatusChip(
                icon: active
                    ? Icons.check_circle_rounded
                    : Icons.info_rounded,
                label: active ? 'عضوية نشطة' : data.membershipStatus,
              ),
              _StatusChip(
                icon: Icons.badge_rounded,
                label: _roleLabel(data.membershipRole),
              ),
              _StatusChip(
                icon: Icons.apartment_rounded,
                label: _agencyStatusLabel(agency.status),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _OwnerCard extends StatelessWidget {
  const _OwnerCard({
    required this.owner,
    required this.onTap,
  });

  final HostAgencyOwner owner;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final image = owner.profileImageUrl?.trim() ?? '';
    return Container(
      decoration: _cardDecoration(),
      child: ListTile(
        onTap: onTap,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 8,
        ),
        leading: CircleAvatar(
          radius: 26,
          backgroundColor: const Color(0xFF2A3150),
          backgroundImage: image.isEmpty ? null : NetworkImage(image),
          child: image.isEmpty
              ? const Icon(Icons.person_rounded, color: Colors.white70)
              : null,
        ),
        title: const Text(
          'مالك الوكالة',
          style: TextStyle(
            color: Color(0xFFB99CFF),
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text(
            owner.publicId == null
                ? owner.displayName
                : '${owner.displayName} • ID ${owner.publicId}',
            textDirection: TextDirection.rtl,
            style: const TextStyle(color: Colors.white),
          ),
        ),
        trailing: const Icon(
          Icons.chevron_left_rounded,
          color: Colors.white38,
        ),
      ),
    );
  }
}

class _TargetCard extends StatelessWidget {
  const _TargetCard({required this.target});

  final HostAgencyTarget target;

  @override
  Widget build(BuildContext context) {
    final denominator = target.targetCoins <= 0 ? 1 : target.targetCoins;
    final ratio = (target.progressCoins / denominator).clamp(0.0, 1.0);
    final current = target.currentLevel;
    final next = target.nextLevel;

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionHeader(
            icon: Icons.flag_rounded,
            title: 'Target هذا الشهر',
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ValueTile(
                  label: 'التقدم',
                  value: _formatCoins(target.progressCoins),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ValueTile(
                  label: 'الهدف',
                  value: _formatCoins(target.targetCoins),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: LinearProgressIndicator(
              minHeight: 10,
              value: ratio,
              backgroundColor: Colors.white12,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            target.remainingCoins > 0
                ? 'باقي للمستوى التالي: ${_formatCoins(target.remainingCoins)} Coins'
                : 'وصلت لأعلى Target متاح حاليًا.',
            style: const TextStyle(color: Colors.white70),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ValueTile(
                  label: 'المستوى الحالي',
                  value: current == null ? '—' : _levelLabel(current),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ValueTile(
                  label: 'المستوى التالي',
                  value: next == null ? '—' : _levelLabel(next),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          _ValueTile(
            label: 'Diamonds المدفوعة من Targets',
            value: target.paidDiamonds.toString(),
            icon: Icons.diamond_rounded,
          ),
        ],
      ),
    );
  }
}

class _ActivityCard extends StatelessWidget {
  const _ActivityCard({required this.activity});

  final HostAgencyActivity activity;

  @override
  Widget build(BuildContext context) {
    final requiredDays = activity.requiredQualifiedDays <= 0
        ? 1
        : activity.requiredQualifiedDays;
    final ratio = (activity.qualifiedDays / requiredDays).clamp(0.0, 1.0);

    return Container(
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const _SectionHeader(
            icon: Icons.mic_rounded,
            title: 'النشاط الشهري',
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _ValueTile(
                  label: 'الأيام المحققة',
                  value:
                      '${activity.qualifiedDays}/${activity.requiredQualifiedDays}',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _ValueTile(
                  label: 'شرط اليوم',
                  value: '${activity.requiredMinutesPerDay} دقيقة',
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: LinearProgressIndicator(
              minHeight: 10,
              value: ratio,
              backgroundColor: Colors.white12,
            ),
          ),
          const SizedBox(height: 12),
          Text(
            'إجمالي وقت المايك هذا الشهر: ${_formatDuration(activity.micSecondsMonth)}',
            style: const TextStyle(color: Colors.white70),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({
    required this.icon,
    required this.title,
  });

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

class _ValueTile extends StatelessWidget {
  const _ValueTile({
    required this.label,
    required this.value,
    this.icon,
  });

  final String label;
  final String value;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.black26,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          if (icon != null) ...[
            Icon(icon, size: 20, color: const Color(0xFFB99CFF)),
            const SizedBox(height: 4),
          ],
          Text(
            value,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 17,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Colors.white54, fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({
    required this.icon,
    required this.label,
  });

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: Colors.black26,
        borderRadius: BorderRadius.circular(99),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 15, color: const Color(0xFFB99CFF)),
          const SizedBox(width: 5),
          Text(label, style: const TextStyle(color: Colors.white70)),
        ],
      ),
    );
  }
}

class _ErrorState extends StatelessWidget {
  const _ErrorState({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.apartment_rounded,
              size: 52,
              color: Colors.white38,
            ),
            const SizedBox(height: 12),
            const Text(
              'تعذر تحميل معلومات الوكالة.',
              style: TextStyle(color: Colors.white70),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: onRetry,
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      ),
    );
  }
}

BoxDecoration _cardDecoration() {
  return BoxDecoration(
    color: const Color(0xFF111526),
    borderRadius: BorderRadius.circular(18),
    border: Border.all(color: Colors.white12),
  );
}

String _roleLabel(String role) {
  switch (role) {
    case 'owner':
      return 'Owner / Host';
    case 'host':
      return 'Host';
    default:
      return role.isEmpty ? 'Host' : role;
  }
}

String _agencyStatusLabel(String status) {
  switch (status) {
    case 'active':
      return 'الوكالة مفعلة';
    case 'suspended':
      return 'الوكالة موقوفة';
    case 'closed':
      return 'الوكالة مغلقة';
    default:
      return status.isEmpty ? 'الوكالة' : status;
  }
}

String _levelLabel(HostAgencyLevel level) {
  final tier = level.tierId.isEmpty
      ? ''
      : level.tierId[0].toUpperCase() + level.tierId.substring(1);
  if (level.rank == 'DIAMOND') return 'Diamond';
  if (tier.isEmpty) return level.rank;
  return '$tier ${level.rank}';
}

String _formatCoins(int value) {
  if (value >= 1000000000) {
    final amount = value / 1000000000;
    return '${amount.toStringAsFixed(value % 1000000000 == 0 ? 0 : 1)}B';
  }
  if (value >= 1000000) {
    final amount = value / 1000000;
    return '${amount.toStringAsFixed(value % 1000000 == 0 ? 0 : 1)}M';
  }
  if (value >= 1000) {
    final amount = value / 1000;
    return '${amount.toStringAsFixed(value % 1000 == 0 ? 0 : 1)}K';
  }
  return value.toString();
}

String _formatDuration(int seconds) {
  final safe = seconds < 0 ? 0 : seconds;
  final hours = safe ~/ 3600;
  final minutes = (safe % 3600) ~/ 60;
  if (hours <= 0) return '$minutes دقيقة';
  if (minutes <= 0) return '$hours ساعة';
  return '$hours ساعة و$minutes دقيقة';
}
