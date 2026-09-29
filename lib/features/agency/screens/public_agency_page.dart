import 'package:flutter/material.dart';

import '../../profile/screens/public_profile_screen.dart';
import '../services/public_agency_service.dart';

class PublicAgencyPage extends StatefulWidget {
  const PublicAgencyPage({
    super.key,
    required this.agencyId,
  });

  final String agencyId;

  @override
  State<PublicAgencyPage> createState() => _PublicAgencyPageState();
}

class _PublicAgencyPageState extends State<PublicAgencyPage> {
  final PublicAgencyService _service = PublicAgencyService();

  PublicAgencyPageData? _data;
  final List<PublicAgencyPerson> _hosts = <PublicAgencyPerson>[];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  String? _nextCursor;
  bool _hasMore = false;

  @override
  void initState() {
    super.initState();
    _loadFirstPage();
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  Future<void> _loadFirstPage() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await _service.load(agencyId: widget.agencyId);
      if (!mounted) return;
      setState(() {
        _data = data;
        _hosts
          ..clear()
          ..addAll(data.hosts);
        _nextCursor = data.nextCursor;
        _hasMore = data.hasMore;
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

  Future<void> _loadMore() async {
    final cursor = _nextCursor;
    if (_loadingMore || !_hasMore || cursor == null) return;
    setState(() => _loadingMore = true);
    try {
      final page = await _service.load(
        agencyId: widget.agencyId,
        cursor: cursor,
      );
      if (!mounted) return;
      final known = _hosts.map((item) => item.uid).toSet();
      setState(() {
        _hosts.addAll(page.hosts.where((item) => known.add(item.uid)));
        _nextCursor = page.nextCursor;
        _hasMore = page.hasMore;
        _loadingMore = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _loadingMore = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تحميل المزيد: $error')),
      );
    }
  }

  void _openProfile(PublicAgencyPerson person) {
    if (person.uid.isEmpty) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: person.uid),
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
          title: const Text('صفحة الوكالة'),
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
      return _ErrorState(onRetry: _loadFirstPage);
    }

    final data = _data!;
    return RefreshIndicator(
      onRefresh: _loadFirstPage,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
        children: [
          _AgencyIdentityCard(agency: data.agency),
          const SizedBox(height: 16),
          const _SectionTitle(
            icon: Icons.workspace_premium_rounded,
            title: 'صاحب الوكالة',
          ),
          const SizedBox(height: 8),
          _PersonTile(
            person: data.owner,
            label: 'Owner',
            onTap: () => _openProfile(data.owner),
          ),
          const SizedBox(height: 20),
          _SectionTitle(
            icon: Icons.groups_rounded,
            title: 'Hosts (' + data.agency.hostCount.toString() + ')',
          ),
          const SizedBox(height: 8),
          if (_hosts.isEmpty)
            const _EmptyHosts()
          else
            ..._hosts.map(
              (person) => Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: _PersonTile(
                  person: person,
                  label: 'Host',
                  onTap: () => _openProfile(person),
                ),
              ),
            ),
          if (_hasMore) ...[
            const SizedBox(height: 8),
            Center(
              child: FilledButton.icon(
                onPressed: _loadingMore ? null : _loadMore,
                icon: _loadingMore
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.expand_more_rounded),
                label: Text(
                  _loadingMore ? 'جاري التحميل…' : 'تحميل المزيد',
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _AgencyIdentityCard extends StatelessWidget {
  const _AgencyIdentityCard({required this.agency});

  final PublicAgencyIdentity agency;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(22),
        gradient: const LinearGradient(
          begin: Alignment.topRight,
          end: Alignment.bottomLeft,
          colors: [
            Color(0xFF24133F),
            Color(0xFF11172A),
          ],
        ),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        children: [
          const CircleAvatar(
            radius: 34,
            backgroundColor: Color(0xFF6E49D8),
            child: Icon(
              Icons.apartment_rounded,
              size: 36,
              color: Colors.white,
            ),
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
            'Agency ID: ' + agency.publicId,
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
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _Metric(
                  value: agency.memberCount.toString(),
                  label: 'الأعضاء',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _Metric(
                  value: agency.hostCount.toString(),
                  label: 'Hosts',
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
  const _Metric({
    required this.value,
    required this.label,
  });

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        color: Colors.black26,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 18,
            ),
          ),
          const SizedBox(height: 2),
          Text(label, style: const TextStyle(color: Colors.white60)),
        ],
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({
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

class _PersonTile extends StatelessWidget {
  const _PersonTile({
    required this.person,
    required this.label,
    required this.onTap,
  });

  final PublicAgencyPerson person;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final imageUrl = person.profileImageUrl?.trim() ?? '';
    return Material(
      color: const Color(0xFF111526),
      borderRadius: BorderRadius.circular(16),
      child: ListTile(
        onTap: onTap,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
        ),
        leading: CircleAvatar(
          backgroundColor: const Color(0xFF2A3150),
          backgroundImage: imageUrl.isEmpty ? null : NetworkImage(imageUrl),
          child: imageUrl.isEmpty
              ? const Icon(Icons.person_rounded, color: Colors.white70)
              : null,
        ),
        title: Text(
          person.displayName,
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
        subtitle: Text(
          person.publicId == null
              ? label
              : label + ' • ID ' + person.publicId!,
          textDirection: TextDirection.ltr,
          style: const TextStyle(color: Colors.white54),
        ),
        trailing: const Icon(
          Icons.chevron_left_rounded,
          color: Colors.white38,
        ),
      ),
    );
  }
}

class _EmptyHosts extends StatelessWidget {
  const _EmptyHosts();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF111526),
        borderRadius: BorderRadius.circular(16),
      ),
      child: const Text(
        'لا يوجد Hosts ظاهرون حالياً.',
        textAlign: TextAlign.center,
        style: TextStyle(color: Colors.white54),
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
              color: Colors.white38,
              size: 50,
            ),
            const SizedBox(height: 12),
            const Text(
              'تعذر تحميل صفحة الوكالة.',
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
