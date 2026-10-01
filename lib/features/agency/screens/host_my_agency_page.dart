import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../../profile/services/profile_action_service.dart';
import '../services/host_my_agency_service.dart';
import '../services/public_agency_service.dart';
import 'agency_membership_review_page.dart';
import 'owner_agency_dashboard_page.dart';

class HostMyAgencyPage extends StatefulWidget {
  const HostMyAgencyPage({
    super.key,
    this.initialCore,
  });

  final HostMyAgencyCoreData? initialCore;

  @override
  State<HostMyAgencyPage> createState() => _HostMyAgencyPageState();
}

class _HostMyAgencyPageState extends State<HostMyAgencyPage> {
  final HostMyAgencyService _service = HostMyAgencyService();
  final PublicAgencyService _publicAgencyService = PublicAgencyService();

  HostMyAgencyCoreData? _data;
  PublicAgencyRankingData? _ranking;
  PublicAgencyArchiveData? _archive;
  HostAgencyLeaveStatus? _leaveStatus;
  bool _loading = true;
  bool _rankingLoading = false;
  bool _archiveLoading = false;
  bool _leaveStatusLoading = false;
  bool _leaveSubmitting = false;
  String? _error;
  String? _rankingError;
  String? _leaveStatusError;

  @override
  void initState() {
    super.initState();
    final initial = widget.initialCore;
    if (initial == null) {
      _load();
      return;
    }
    _data = initial;
    _loading = false;
    Future.microtask(() async {
      await _loadLeaveStatus(initial.agency.agencyId);
      await _loadRanking(initial.agency.agencyId);
    });
  }

  @override
  void dispose() {
    _service.close();
    _publicAgencyService.close();
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
      await _loadLeaveStatus(data.agency.agencyId);
      await _loadRanking(data.agency.agencyId);
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadRanking(String agencyId, {String? month}) async {
    if (_rankingLoading) return;
    setState(() {
      _rankingLoading = true;
      _rankingError = null;
    });
    try {
      final ranking = await _publicAgencyService.loadRanking(
        agencyId: agencyId,
        month: month,
      );
      if (!mounted) return;
      setState(() {
        _ranking = ranking;
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
    final data = _data;
    if (data == null || _archiveLoading) return;
    setState(() => _archiveLoading = true);
    try {
      final archive = _archive ??
          await _publicAgencyService.loadArchive(
            agencyId: data.agency.agencyId,
          );
      if (!mounted) return;
      setState(() {
        _archive = archive;
        _archiveLoading = false;
      });
      if (archive.months.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('لا يوجد سجل شهري مغلق بعد.')),
        );
        return;
      }
      final selected = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: const Color(0xFF0D1220),
        builder: (sheetContext) => SafeArea(
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 18),
              children: [
                const ListTile(
                  leading: Icon(Icons.history_rounded),
                  title: Text('السجل الشهري'),
                  subtitle: Text('آخر الأشهر المغلقة ذات النشاط'),
                ),
                ...archive.months.map(
                  (month) => ListTile(
                    title: Text(_monthLabel(month)),
                    trailing: const Icon(Icons.chevron_left_rounded),
                    onTap: () => Navigator.pop(sheetContext, month),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (selected != null && mounted) {
        await _loadRanking(data.agency.agencyId, month: selected);
      }
    } catch (_) {
      if (!mounted) return;
      setState(() => _archiveLoading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر تحميل السجل الشهري.')),
      );
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

  void _openRankingPerson(PublicAgencyPerson person) {
    if (person.uid.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: person.uid),
      ),
    );
  }

  Future<void> _contactOwner() async {
    final owner = _data?.owner;
    final me = FirebaseAuth.instance.currentUser?.uid ?? '';
    if (owner == null || owner.uid.isEmpty || owner.uid == me) return;
    await ProfileActionService.openChat(
      context,
      otherUid: owner.uid,
      otherName: owner.displayName,
      otherPhoto: owner.profileImageUrl ?? '',
    );
  }

  void _openAgencyRoom() {
    final data = _data;
    final roomId = data?.agency.roomId?.trim() ?? '';
    if (data == null ||
        data.agency.status != 'active' ||
        roomId.isEmpty) {
      return;
    }
    NavigationService.navigateTo(
      AppRoutes.voiceChatRoom,
      arguments: {'roomId': roomId},
    );
  }

  Future<void> _loadLeaveStatus(String agencyId) async {
    if (_leaveStatusLoading) return;
    setState(() {
      _leaveStatusLoading = true;
      _leaveStatusError = null;
    });
    try {
      final status = await _service.loadLeaveStatus(agencyId: agencyId);
      if (!mounted) return;
      setState(() {
        _leaveStatus = status;
        _leaveStatusLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _leaveStatusError = error.toString();
        _leaveStatusLoading = false;
      });
    }
  }

  Future<void> _requestLeave() async {
    final data = _data;
    final status = _leaveStatus;
    if (data == null ||
        _leaveSubmitting ||
        data.membershipRole == 'owner' ||
        status?.request?.status == 'pending') {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101522),
          title: const Text('طلب مغادرة الوكالة'),
          content: const Text(
            'سيتم إرسال طلب المغادرة للمراجعة. عضويتك تبقى نشطة إلى أن تتم معالجة الطلب.',
            style: TextStyle(color: Colors.white70, height: 1.5),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('إرسال الطلب'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _leaveSubmitting = true);
    try {
      final result = await _service.requestLeave(
        agencyId: data.agency.agencyId,
      );
      if (!mounted) return;
      setState(() {
        _leaveStatus = result;
        _leaveStatusError = null;
        _leaveSubmitting = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إرسال طلب مغادرة الوكالة.')),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _leaveSubmitting = false;
        _leaveStatusError = error.toString();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر إرسال طلب المغادرة حاليًا.')),
      );
    }
  }

  void _openWallet() {
    NavigationService.navigateTo(AppRoutes.recharge);
  }

  Future<void> _showTargetTable() async {
    final data = _data;
    if (data == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D1220),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: _TargetTableSheet(target: data.target),
      ),
    );
  }

  Future<void> _handleLeaveAction() async {
    final data = _data;
    if (data == null ||
        data.membershipRole == 'owner' ||
        _leaveSubmitting ||
        _leaveStatusLoading) {
      return;
    }
    if (_leaveStatusError != null || _leaveStatus == null) {
      await _loadLeaveStatus(data.agency.agencyId);
      return;
    }
    if (_leaveStatus?.request?.status == 'pending') return;
    if (_leaveStatus?.canRequestLeave == true) {
      await _requestLeave();
    }
  }

  void _openOwnerDashboard() {
    final data = _data;
    if (data == null || data.membershipRole != 'owner') return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OwnerAgencyDashboardPage(initialCore: data),
      ),
    );
  }

  void _openMembershipReview() {
    final data = _data;
    if (data == null || !data.canReviewMembershipRequests) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AgencyMembershipReviewPage(initialCore: data),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final showLeave = data != null && data.membershipRole != 'owner';
    final leavePending = _leaveStatus?.request?.status == 'pending';
    final canTapLeave = showLeave &&
        !_leaveStatusLoading &&
        !_leaveSubmitting &&
        !leavePending &&
        (_leaveStatus?.canRequestLeave == true ||
            _leaveStatusError != null ||
            _leaveStatus == null);

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070914),
        appBar: AppBar(
          title: const Text('معلومات وكالتي'),
          backgroundColor: const Color(0xFF0B1020),
          actions: [
            if (showLeave)
              IconButton(
                key: const Key('host-agency-leave-request-button'),
                tooltip: leavePending
                    ? 'طلب المغادرة قيد المراجعة'
                    : _leaveStatusError != null
                        ? 'إعادة تحميل حالة المغادرة'
                        : 'طلب مغادرة الوكالة',
                onPressed: canTapLeave ? _handleLeaveAction : null,
                icon: _leaveSubmitting || _leaveStatusLoading
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(
                        leavePending
                            ? Icons.schedule_rounded
                            : Icons.logout_rounded,
                      ),
              ),
          ],
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
      return _ErrorState(
        errorCode: _error,
        onRetry: _load,
      );
    }

    final data = _data!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 28),
        children: [
          _AgencyHeader(data: data),
          if (data.membershipRole == 'owner') ...[
            const SizedBox(height: 12),
            _OwnerDashboardEntry(onTap: _openOwnerDashboard),
          ] else if (data.canReviewMembershipRequests) ...[
            const SizedBox(height: 12),
            _AgencyReviewEntry(onTap: _openMembershipReview),
          ],
          const SizedBox(height: 16),
          _OwnerCard(owner: data.owner, onTap: _openOwner),
          const SizedBox(height: 12),
          _AgencyActionsCard(
            canEnterRoom:
                data.agency.status == 'active' &&
                (data.agency.roomId?.trim().isNotEmpty ?? false),
            canContactOwner:
                data.owner.uid.isNotEmpty &&
                data.owner.uid != (FirebaseAuth.instance.currentUser?.uid ?? ''),
            onEnterRoom: _openAgencyRoom,
            onContactOwner: _contactOwner,
          ),
          const SizedBox(height: 16),
          _TargetCard(target: data.target),
          const SizedBox(height: 16),
          _ActivityCard(activity: data.activity),
          const SizedBox(height: 16),
          _HostFinanceEntries(
            onWallet: _openWallet,
            onTargetTable: _showTargetTable,
          ),
          const SizedBox(height: 16),
          _HostRankingCard(
            data: _ranking,
            loading: _rankingLoading,
            archiveLoading: _archiveLoading,
            error: _rankingError,
            currentUid: FirebaseAuth.instance.currentUser?.uid ?? '',
            onRetry: () => _loadRanking(
              data.agency.agencyId,
              month: _ranking?.month,
            ),
            onArchive: _showArchive,
            onPersonTap: _openRankingPerson,
          ),
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


class _AgencyReviewEntry extends StatelessWidget {
  const _AgencyReviewEntry({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('agency-membership-review-entry'),
      decoration: _cardDecoration(),
      child: ListTile(
        onTap: onTap,
        leading: const CircleAvatar(
          backgroundColor: Color(0xFF31204F),
          child: Icon(
            Icons.rule_folder_rounded,
            color: Color(0xFFB99CFF),
          ),
        ),
        title: const Text(
          'إدارة الوكالة',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: const Text(
          'مراجعة طلبات الانضمام والمغادرة المعلّقة',
          style: TextStyle(color: Colors.white54),
        ),
        trailing: const Icon(Icons.chevron_left_rounded),
      ),
    );
  }
}

class _OwnerDashboardEntry extends StatelessWidget {
  const _OwnerDashboardEntry({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('owner-agency-dashboard-entry'),
      decoration: _cardDecoration(),
      child: ListTile(
        onTap: onTap,
        leading: const CircleAvatar(
          backgroundColor: Color(0xFF6E49D8),
          child: Icon(
            Icons.dashboard_customize_rounded,
            color: Colors.white,
          ),
        ),
        title: const Text(
          'لوحة مالك الوكالة',
          style: TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w800,
          ),
        ),
        subtitle: const Text(
          'أدائي كمضيف، ثم أرباح وأداء الوكالة وإدارتها ضمن Stage 12.',
          style: TextStyle(color: Colors.white60),
        ),
        trailing: const Icon(
          Icons.chevron_left_rounded,
          color: Colors.white38,
        ),
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

class _AgencyActionsCard extends StatelessWidget {
  const _AgencyActionsCard({
    required this.canEnterRoom,
    required this.canContactOwner,
    required this.onEnterRoom,
    required this.onContactOwner,
  });

  final bool canEnterRoom;
  final bool canContactOwner;
  final VoidCallback onEnterRoom;
  final Future<void> Function() onContactOwner;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: _cardDecoration(),
      child: Row(
        children: [
          Expanded(
            child: FilledButton.icon(
              key: const Key('host-agency-room-button'),
              onPressed: canEnterRoom ? onEnterRoom : null,
              icon: const Icon(Icons.meeting_room_rounded),
              label: Text(canEnterRoom ? 'دخول غرفة الوكالة' : 'لا توجد غرفة مرتبطة'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: OutlinedButton.icon(
              key: const Key('host-agency-contact-button'),
              onPressed: canContactOwner ? onContactOwner : null,
              icon: const Icon(Icons.chat_bubble_outline_rounded),
              label: Text(canContactOwner ? 'مراسلة المالك' : 'أنت مالك الوكالة'),
            ),
          ),
        ],
      ),
    );
  }
}


class _HostFinanceEntries extends StatelessWidget {
  const _HostFinanceEntries({
    required this.onWallet,
    required this.onTargetTable,
  });

  final VoidCallback onWallet;
  final Future<void> Function() onTargetTable;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const Key('host-agency-finance-entries'),
      padding: const EdgeInsets.all(12),
      decoration: _cardDecoration(),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton.icon(
              key: const Key('host-agency-wallet-entry'),
              onPressed: onWallet,
              icon: const Icon(Icons.account_balance_wallet_rounded),
              label: const Text('المحفظة/الألماس'),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: FilledButton.icon(
              key: const Key('host-agency-target-table-entry'),
              onPressed: onTargetTable,
              icon: const Icon(Icons.table_chart_rounded),
              label: const Text('جدول الـTarget'),
            ),
          ),
        ],
      ),
    );
  }
}

class _TargetTableSheet extends StatelessWidget {
  const _TargetTableSheet({required this.target});

  final HostAgencyTarget target;

  @override
  Widget build(BuildContext context) {
    final levels = target.levels;
    return SafeArea(
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: .72,
        minChildSize: .45,
        maxChildSize: .92,
        builder: (context, controller) => ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 24),
          children: [
            const ListTile(
              contentPadding: EdgeInsets.zero,
              leading: Icon(Icons.table_chart_rounded),
              title: Text(
                'جدول الـTarget',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: Text(
                'القيم تخص المضيف فقط وتأتي من إعدادات الوكالات المعتمدة.',
              ),
            ),
            Card(
              color: const Color(0xFF11182A),
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  'المحتسب هذا الشهر: ${_formatCoins(target.progressCoins)} Coins'
                  '${target.remainingCoins > 0 ? ' • المتبقي: ${_formatCoins(target.remainingCoins)}' : ''}',
                  style: const TextStyle(
                    color: Colors.white70,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
            const SizedBox(height: 8),
            if (levels.isEmpty)
              const Padding(
                padding: EdgeInsets.all(18),
                child: Text(
                  'لا توجد مستويات Target متاحة حاليًا.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white60),
                ),
              )
            else
              ...levels.map((level) {
                final achieved =
                    target.progressCoins >= level.thresholdCoins;
                final current = target.currentLevel?.id == level.id;
                final next = target.nextLevel?.id == level.id;
                final status = current
                    ? 'الحالي / محقق'
                    : next
                        ? 'التالي'
                        : achieved
                            ? 'محقق'
                            : 'لاحق';
                return Card(
                  color: const Color(0xFF11182A),
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: current
                          ? Colors.green.withValues(alpha: .18)
                          : next
                              ? Colors.amber.withValues(alpha: .18)
                              : Colors.white10,
                      child: Icon(
                        achieved
                            ? Icons.check_rounded
                            : Icons.flag_outlined,
                        color: achieved
                            ? Colors.greenAccent
                            : next
                                ? Colors.amberAccent
                                : Colors.white54,
                      ),
                    ),
                    title: Text(
                      _levelLabel(level),
                      style: const TextStyle(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    subtitle: Text(
                      'Target: ${_formatCoins(level.thresholdCoins)} Coins'
                      ' • راتب المضيف: ${level.salaryDiamonds} Diamonds',
                    ),
                    trailing: Text(
                      status,
                      style: TextStyle(
                        color: current
                            ? Colors.greenAccent
                            : next
                                ? Colors.amberAccent
                                : Colors.white54,
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                );
              }),
          ],
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
    final ratio =
        (target.progressCoins / denominator).clamp(0.0, 1.0).toDouble();
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
    final ratio =
        (activity.qualifiedDays / requiredDays).clamp(0.0, 1.0).toDouble();

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

class _HostRankingCard extends StatelessWidget {
  const _HostRankingCard({
    required this.data,
    required this.loading,
    required this.archiveLoading,
    required this.error,
    required this.currentUid,
    required this.onRetry,
    required this.onArchive,
    required this.onPersonTap,
  });

  final PublicAgencyRankingData? data;
  final bool loading;
  final bool archiveLoading;
  final String? error;
  final String currentUid;
  final Future<void> Function() onRetry;
  final Future<void> Function() onArchive;
  final void Function(PublicAgencyPerson) onPersonTap;

  @override
  Widget build(BuildContext context) {
    final ranking = data;
    PublicAgencyRankingEntry? ownEntry;
    if (ranking != null && currentUid.isNotEmpty) {
      for (final entry in ranking.top10) {
        if (entry.person.uid == currentUid) {
          ownEntry = entry;
          break;
        }
      }
    }

    return Container(
      key: const Key('host-agency-ranking-card'),
      padding: const EdgeInsets.all(16),
      decoration: _cardDecoration(),
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
                  'ترتيب الدعم الشهري',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
              TextButton.icon(
                key: const Key('host-agency-archive-button'),
                onPressed: archiveLoading ? null : onArchive,
                icon: archiveLoading
                    ? const SizedBox.square(
                        dimension: 15,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.history_rounded, size: 18),
                label: const Text('السجل'),
              ),
            ],
          ),
          if (ranking != null) ...[
            Text(
              _monthLabel(ranking.month) +
                  (ranking.month == ranking.currentMonth
                      ? ' • الشهر الحالي'
                      : ' • سجل'),
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              decoration: BoxDecoration(
                color: Colors.black26,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                ownEntry == null
                    ? 'ترتيبك: خارج Top 10'
                    : 'ترتيبك: #${ownEntry.rank} • ${_formatCoins(ownEntry.supportCoins)} Coins',
                style: const TextStyle(
                  color: Color(0xFFB99CFF),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
          const SizedBox(height: 10),
          if (loading && ranking == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 18),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (error != null && ranking == null)
            Column(
              children: [
                const Text(
                  'تعذر تحميل الترتيب.',
                  style: TextStyle(color: Colors.white54),
                ),
                TextButton(
                  onPressed: onRetry,
                  child: const Text('إعادة المحاولة'),
                ),
              ],
            )
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
              (entry) => _HostRankingTile(
                entry: entry,
                isCurrentUser: entry.person.uid == currentUid,
                onTap: () => onPersonTap(entry.person),
              ),
            ),
          if (loading && ranking != null)
            const LinearProgressIndicator(minHeight: 2),
        ],
      ),
    );
  }
}

class _HostRankingTile extends StatelessWidget {
  const _HostRankingTile({
    required this.entry,
    required this.isCurrentUser,
    required this.onTap,
  });

  final PublicAgencyRankingEntry entry;
  final bool isCurrentUser;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final person = entry.person;
    final image = person.profileImageUrl?.trim() ?? '';
    return ListTile(
      dense: true,
      onTap: onTap,
      tileColor: isCurrentUser ? Colors.white10 : Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
      ),
      leading: SizedBox(
        width: 42,
        child: Text(
          '#${entry.rank}',
          textDirection: TextDirection.ltr,
          style: TextStyle(
            color: isCurrentUser
                ? const Color(0xFFFFD875)
                : Colors.white60,
            fontWeight: FontWeight.w800,
          ),
        ),
      ),
      title: Row(
        children: [
          CircleAvatar(
            radius: 15,
            backgroundColor: const Color(0xFF2A3150),
            backgroundImage: image.isEmpty ? null : NetworkImage(image),
            child: image.isEmpty
                ? const Icon(Icons.person_rounded, size: 16, color: Colors.white70)
                : null,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              person.displayName + (isCurrentUser ? ' • أنت' : ''),
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
              'ID ${person.publicId}',
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
  const _ErrorState({
    required this.errorCode,
    required this.onRetry,
  });

  final String? errorCode;
  final Future<void> Function() onRetry;

  String get _message {
    final code = errorCode ?? '';
    if (code.contains('agency_host_auth_timeout')) {
      return 'انتهت مهلة تحديث جلسة الدخول. تحقق من الاتصال ثم أعد المحاولة.';
    }
    if (code.contains('agency_host_core_timeout')) {
      return 'الخادم تأخر في تحميل معلومات الوكالة. أعد المحاولة بعد التحقق من الاتصال.';
    }
    if (code.contains('agency_host_not_found') ||
        code.contains('agency_host_not_active')) {
      return 'عضويتك في الوكالة لم تكتمل بشكل صحيح. حدّث الصفحة، وإذا استمرت المشكلة راجع الإدارة.';
    }
    return 'تعذر تحميل معلومات الوكالة.';
  }

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
            Text(
              _message,
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white70, height: 1.45),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('إعادة المحاولة'),
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

String _monthLabel(String value) {
  final parts = value.split('-');
  if (parts.length != 2) return value;
  final year = int.tryParse(parts[0]);
  final month = int.tryParse(parts[1]);
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
  if (year == null || month == null || month < 1 || month > 12) {
    return value;
  }
  return '${names[month - 1]} $year';
}

String _formatDuration(int seconds) {
  final safe = seconds < 0 ? 0 : seconds;
  final hours = safe ~/ 3600;
  final minutes = (safe % 3600) ~/ 60;
  if (hours <= 0) return '$minutes دقيقة';
  if (minutes <= 0) return '$hours ساعة';
  return '$hours ساعة و$minutes دقيقة';
}
