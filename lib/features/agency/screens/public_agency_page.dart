import 'dart:async';

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
  PublicAgencyRankingData? _ranking;
  PublicAgencyArchiveData? _archive;
  bool _rankingLoading = true;
  bool _archiveLoading = false;
  String? _rankingError;

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
      unawaited(_loadRanking(month: _ranking?.month));
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

  Future<void> _loadRanking({String? month}) async {
    if (_rankingLoading && _ranking != null) return;
    setState(() {
      _rankingLoading = true;
      _rankingError = null;
    });
    try {
      final data = await _service.loadRanking(
        agencyId: widget.agencyId,
        month: month,
      );
      if (!mounted) return;
      setState(() {
        _ranking = data;
        _rankingLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _rankingError = error.toString();
        _rankingLoading = false;
      });
    }
  }

  Future<void> _showArchive() async {
    if (_archiveLoading) return;
    setState(() => _archiveLoading = true);
    try {
      final archive = _archive ??
          await _service.loadArchive(agencyId: widget.agencyId);
      if (!mounted) return;
      setState(() {
        _archive = archive;
        _archiveLoading = false;
      });

      final selected = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: const Color(0xFF0D1120),
        showDragHandle: true,
        builder: (sheetContext) {
          final months = archive.months;
          return Directionality(
            textDirection: TextDirection.rtl,
            child: SafeArea(
              child: ListView(
                shrinkWrap: true,
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 22),
                children: [
                  const Text(
                    'الأرشيف الشهري',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 10),
                  ListTile(
                    leading: const Icon(
                      Icons.bolt_rounded,
                      color: Color(0xFFB99CFF),
                    ),
                    title: Text(
                      'الشهر الحالي — ' + _monthLabel(archive.currentMonth),
                      style: const TextStyle(color: Colors.white),
                    ),
                    onTap: () =>
                        Navigator.pop(sheetContext, archive.currentMonth),
                  ),
                  if (months.isEmpty)
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: 18),
                      child: Text(
                        'لا يوجد أرشيف شهري سابق فيه نشاط حتى الآن.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: Colors.white54),
                      ),
                    )
                  else
                    ...months.map(
                      (month) => ListTile(
                        leading: const Icon(
                          Icons.history_rounded,
                          color: Colors.white54,
                        ),
                        title: Text(
                          _monthLabel(month),
                          style: const TextStyle(color: Colors.white),
                        ),
                        onTap: () => Navigator.pop(sheetContext, month),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      );
      if (selected != null && mounted) {
        unawaited(_loadRanking(month: selected));
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _archiveLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تحميل الأرشيف: $error')),
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
          _RankingSection(
            data: _ranking,
            loading: _rankingLoading,
            archiveLoading: _archiveLoading,
            error: _rankingError,
            onRetry: () => _loadRanking(month: _ranking?.month),
            onArchive: _showArchive,
            onPersonTap: _openProfile,
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

class _RankingSection extends StatelessWidget {
  const _RankingSection({
    required this.data,
    required this.loading,
    required this.archiveLoading,
    required this.error,
    required this.onRetry,
    required this.onArchive,
    required this.onPersonTap,
  });

  final PublicAgencyRankingData? data;
  final bool loading;
  final bool archiveLoading;
  final String? error;
  final Future<void> Function() onRetry;
  final Future<void> Function() onArchive;
  final void Function(PublicAgencyPerson) onPersonTap;

  @override
  Widget build(BuildContext context) {
    final ranking = data;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0E1324),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(
                Icons.emoji_events_rounded,
                color: Color(0xFFFFD875),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'Top 10 — الترتيب',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              TextButton.icon(
                onPressed: archiveLoading ? null : onArchive,
                icon: archiveLoading
                    ? const SizedBox.square(
                        dimension: 15,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.history_rounded, size: 18),
                label: const Text('الأرشيف'),
              ),
            ],
          ),
          if (ranking != null) ...[
            const SizedBox(height: 2),
            Text(
              _monthLabel(ranking.month) +
                  (ranking.month == ranking.currentMonth
                      ? ' • الشهر الحالي'
                      : ' • أرشيف'),
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 12,
              ),
            ),
          ],
          const SizedBox(height: 10),
          if (loading && ranking == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (error != null && ranking == null)
            _RankingError(onRetry: onRetry)
          else if (ranking == null || ranking.top10.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Text(
                'لا يوجد ترتيب لهذا الشهر بعد.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white54),
              ),
            )
          else
            ...ranking.top10.map(
              (entry) => Padding(
                padding: const EdgeInsets.only(bottom: 7),
                child: _RankingTile(
                  entry: entry,
                  onTap: () => onPersonTap(entry.person),
                ),
              ),
            ),
          if (loading && ranking != null)
            const LinearProgressIndicator(minHeight: 2),
        ],
      ),
    );
  }
}

class _RankingTile extends StatelessWidget {
  const _RankingTile({
    required this.entry,
    required this.onTap,
  });

  final PublicAgencyRankingEntry entry;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final person = entry.person;
    final imageUrl = person.profileImageUrl?.trim() ?? '';
    return Material(
      color: Colors.black26,
      borderRadius: BorderRadius.circular(13),
      child: ListTile(
        dense: true,
        onTap: onTap,
        leading: SizedBox(
          width: 42,
          child: Text(
            '#' + entry.rank.toString(),
            textDirection: TextDirection.ltr,
            style: TextStyle(
              color: entry.rank <= 3
                  ? const Color(0xFFFFD875)
                  : Colors.white60,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
        title: Row(
          children: [
            CircleAvatar(
              radius: 16,
              backgroundColor: const Color(0xFF2A3150),
              backgroundImage:
                  imageUrl.isEmpty ? null : NetworkImage(imageUrl),
              child: imageUrl.isEmpty
                  ? const Icon(
                      Icons.person_rounded,
                      size: 17,
                      color: Colors.white70,
                    )
                  : null,
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                person.displayName,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
        subtitle: person.publicId == null
            ? null
            : Text(
                'ID ' + person.publicId!,
                textDirection: TextDirection.ltr,
                style: const TextStyle(color: Colors.white38),
              ),
        trailing: Text(
          _formatCoins(entry.supportCoins),
          textDirection: TextDirection.ltr,
          style: const TextStyle(
            color: Color(0xFFB99CFF),
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
    );
  }
}

class _RankingError extends StatelessWidget {
  const _RankingError({required this.onRetry});

  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        const Text(
          'تعذر تحميل الترتيب.',
          style: TextStyle(color: Colors.white54),
        ),
        const SizedBox(height: 6),
        TextButton(
          onPressed: onRetry,
          child: const Text('إعادة المحاولة'),
        ),
      ],
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


String _formatCoins(int value) {
  if (value >= 1000000000) {
    final amount = value / 1000000000;
    return amount.toStringAsFixed(value % 1000000000 == 0 ? 0 : 1) + 'B';
  }
  if (value >= 1000000) {
    final amount = value / 1000000;
    return amount.toStringAsFixed(value % 1000000 == 0 ? 0 : 1) + 'M';
  }
  if (value >= 1000) {
    final amount = value / 1000;
    return amount.toStringAsFixed(value % 1000 == 0 ? 0 : 1) + 'K';
  }
  return value.toString();
}

String _monthLabel(String value) {
  final parts = value.split('-');
  if (parts.length != 2) return value;
  final month = int.tryParse(parts[1]);
  final year = int.tryParse(parts[0]);
  const names = <String>[
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر',
  ];
  if (month == null || month < 1 || month > 12 || year == null) {
    return value;
  }
  return names[month - 1] + ' ' + year.toString();
}
