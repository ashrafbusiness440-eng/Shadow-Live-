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
  OwnerAgencyMembersData? _membersData;
  List<OwnerAgencyPendingRequest>? _pendingRequests;
  bool _refreshing = false;
  bool _performanceLoading = false;
  bool _statementLoading = false;
  bool _managementLoading = false;
  bool _managementBusy = false;
  String? _error;
  String? _performanceError;
  String? _statementError;
  String? _managementError;

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

  Future<void> _loadManagement() async {
    if (_managementLoading) return;
    setState(() {
      _managementLoading = true;
      _managementError = null;
    });
    try {
      final agencyId = _data.agency.agencyId;
      final members = await _ownerService.loadMembers(agencyId);
      final pending = await _ownerService.loadPending(agencyId);
      if (!mounted) return;
      setState(() {
        _membersData = members;
        _pendingRequests = pending;
        _managementLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _managementError = error.toString();
        _managementLoading = false;
      });
    }
  }

  String _operationKey(String prefix) =>
      '${prefix}_${DateTime.now().microsecondsSinceEpoch}';

  Future<String?> _textDialog({
    required String title,
    required String hint,
    bool digitsOnly = false,
  }) async {
    final controller = TextEditingController();
    final value = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: TextField(
          controller: controller,
          keyboardType: digitsOnly ? TextInputType.number : TextInputType.text,
          decoration: InputDecoration(hintText: hint),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    controller.dispose();
    return value?.trim();
  }

  Future<void> _runManagementAction(
    Future<void> Function() action,
  ) async {
    if (_managementBusy) return;
    setState(() {
      _managementBusy = true;
      _managementError = null;
    });
    try {
      await action();
      if (!mounted) return;
      setState(() => _managementBusy = false);
      await _loadManagement();
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _managementError = error.toString();
        _managementBusy = false;
      });
    }
  }

  Future<void> _inviteHost() async {
    final publicId = await _textDialog(
      title: 'دعوة مضيف',
      hint: 'Public ID من 6 أرقام',
      digitsOnly: true,
    );
    if (publicId == null || !RegExp(r'^\d{6}$').hasMatch(publicId)) return;
    await _runManagementAction(
      () => _ownerService.inviteHost(
        agencyId: _data.agency.agencyId,
        targetPublicId: publicId,
        idempotencyKey: _operationKey('owner_invite'),
      ),
    );
  }

  Future<void> _setMemberRole(
    OwnerAgencyMember member,
    String role,
  ) async {
    if (member.role == role || member.role == 'owner') return;
    await _runManagementAction(
      () => _ownerService.setManagerRole(
        agencyId: _data.agency.agencyId,
        targetUid: member.uid,
        targetRole: role,
        idempotencyKey: _operationKey('owner_role'),
      ),
    );
  }

  Future<void> _removeMember(OwnerAgencyMember member) async {
    if (member.role == 'owner') return;
    final reason = await _textDialog(
      title: 'إزالة عضو من الوكالة',
      hint: 'السبب',
    );
    if (reason == null) return;
    await _runManagementAction(
      () => _ownerService.removeMember(
        agencyId: _data.agency.agencyId,
        targetUid: member.uid,
        idempotencyKey: _operationKey('owner_remove'),
        reason: reason,
      ),
    );
  }

  Future<void> _respondPending(
    OwnerAgencyPendingRequest request,
    String decision,
  ) async {
    final reason = decision == 'reject'
        ? await _textDialog(
            title: request.type == 'leave'
                ? 'رفض طلب المغادرة'
                : 'رفض طلب الانضمام',
            hint: 'السبب',
          )
        : null;
    if (decision == 'reject' && reason == null) return;
    await _runManagementAction(() {
      if (request.type == 'leave') {
        return _ownerService.respondLeave(
          requestId: request.requestId,
          decision: decision,
          idempotencyKey: _operationKey('owner_leave_response'),
          reason: reason,
        );
      }
      return _ownerService.respondJoin(
        requestId: request.requestId,
        decision: decision,
        idempotencyKey: _operationKey('owner_join_response'),
        reason: reason,
      );
    });
  }

  Future<void> _cancelInvite(OwnerAgencyPendingRequest request) async {
    await _runManagementAction(
      () => _ownerService.cancelRequest(
        requestId: request.requestId,
        idempotencyKey: _operationKey('owner_invite_cancel'),
        reason: 'owner_cancelled_invite',
      ),
    );
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
                    const SizedBox(height: 18),
                    const _SectionTitle(
                      icon: Icons.manage_accounts_rounded,
                      title: 'إدارة الوكالة',
                    ),
                    const SizedBox(height: 10),
                    _AgencyManagementCard(
                      data: _membersData,
                      pending: _pendingRequests,
                      loading: _managementLoading,
                      busy: _managementBusy,
                      error: _managementError,
                      onLoad: _loadManagement,
                      onInvite: _inviteHost,
                      onSetRole: _setMemberRole,
                      onRemove: _removeMember,
                      onRespond: _respondPending,
                      onCancelInvite: _cancelInvite,
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

class _AgencyManagementCard extends StatelessWidget {
  const _AgencyManagementCard({
    required this.data,
    required this.pending,
    required this.loading,
    required this.busy,
    required this.error,
    required this.onLoad,
    required this.onInvite,
    required this.onSetRole,
    required this.onRemove,
    required this.onRespond,
    required this.onCancelInvite,
  });

  final OwnerAgencyMembersData? data;
  final List<OwnerAgencyPendingRequest>? pending;
  final bool loading;
  final bool busy;
  final String? error;
  final Future<void> Function() onLoad;
  final Future<void> Function() onInvite;
  final Future<void> Function(OwnerAgencyMember, String) onSetRole;
  final Future<void> Function(OwnerAgencyMember) onRemove;
  final Future<void> Function(OwnerAgencyPendingRequest, String) onRespond;
  final Future<void> Function(OwnerAgencyPendingRequest) onCancelInvite;

  @override
  Widget build(BuildContext context) {
    if (data == null) {
      return Container(
        key: const Key('owner-agency-management-lazy'),
        padding: const EdgeInsets.all(18),
        decoration: _cardDecoration(),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'الأعضاء والطلبات لا يتم تحميلهم تلقائيًا لتخفيف الضغط.',
              style: TextStyle(color: Colors.white70, height: 1.4),
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              key: const Key('owner-agency-management-load'),
              onPressed: loading ? null : onLoad,
              icon: const Icon(Icons.manage_accounts_rounded),
              label: Text(loading ? 'جارٍ التحميل...' : 'فتح إدارة الوكالة'),
            ),
            if (error != null) ...[
              const SizedBox(height: 8),
              const Text(
                'تعذر تحميل إدارة الوكالة.',
                style: TextStyle(color: Colors.redAccent),
              ),
            ],
          ],
        ),
      );
    }

    final requests = pending ?? const <OwnerAgencyPendingRequest>[];
    return Container(
      key: const Key('owner-agency-management-card'),
      padding: const EdgeInsets.all(18),
      decoration: _cardDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(child: _Metric(label: 'الأعضاء', value: '${data!.memberCount}')),
              const SizedBox(width: 8),
              Expanded(child: _Metric(label: 'Hosts', value: '${data!.hostCount}')),
              const SizedBox(width: 8),
              Expanded(
                child: _Metric(
                  label: 'الإدارة',
                  value: '${data!.managerCount + data!.seniorManagerCount}',
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  key: const Key('owner-agency-invite-host'),
                  onPressed: busy ? null : onInvite,
                  icon: const Icon(Icons.person_add_alt_1_rounded),
                  label: const Text('دعوة مضيف'),
                ),
              ),
              const SizedBox(width: 8),
              IconButton(
                key: const Key('owner-agency-management-refresh'),
                onPressed: loading || busy ? null : onLoad,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
          ),
          if (data!.truncated) ...[
            const SizedBox(height: 8),
            const Text(
              'المعروض أول 25 عضو فقط.',
              style: TextStyle(color: Colors.amberAccent, fontSize: 12),
            ),
          ],
          const SizedBox(height: 14),
          const Text(
            'الأعضاء',
            style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          ...data!.members.map(
            (member) => _MemberManagementTile(
              member: member,
              busy: busy,
              onSetRole: onSetRole,
              onRemove: onRemove,
            ),
          ),
          const Divider(color: Color(0x22FFFFFF), height: 26),
          Text(
            'الطلبات المعلّقة (${requests.length})',
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 6),
          if (requests.isEmpty)
            const Text(
              'لا توجد طلبات معلّقة.',
              style: TextStyle(color: Colors.white54),
            )
          else
            ...requests.map(
              (request) => _PendingManagementTile(
                request: request,
                busy: busy,
                onRespond: onRespond,
                onCancelInvite: onCancelInvite,
              ),
            ),
          if (error != null) ...[
            const SizedBox(height: 8),
            const Text(
              'آخر عملية لم تكتمل. أعد التحديث قبل المحاولة مجددًا.',
              style: TextStyle(color: Colors.redAccent, fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }
}

class _MemberManagementTile extends StatelessWidget {
  const _MemberManagementTile({
    required this.member,
    required this.busy,
    required this.onSetRole,
    required this.onRemove,
  });

  final OwnerAgencyMember member;
  final bool busy;
  final Future<void> Function(OwnerAgencyMember, String) onSetRole;
  final Future<void> Function(OwnerAgencyMember) onRemove;

  @override
  Widget build(BuildContext context) {
    final owner = member.role == 'owner';
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(
        member.displayName ?? member.publicId ?? member.uid,
        style: const TextStyle(color: Colors.white),
      ),
      subtitle: Text(
        '${member.publicId ?? '—'} • ${_roleLabel(member.role)}',
        style: const TextStyle(color: Colors.white54),
      ),
      trailing: owner
          ? const Icon(Icons.workspace_premium_rounded, color: Color(0xFFFFD875))
          : Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                PopupMenuButton<String>(
                  key: Key('owner-member-role-${member.uid}'),
                  enabled: !busy,
                  onSelected: (role) => onSetRole(member, role),
                  itemBuilder: (_) => const [
                    PopupMenuItem(value: 'host', child: Text('Host')),
                    PopupMenuItem(value: 'manager', child: Text('Manager')),
                    PopupMenuItem(
                      value: 'senior_manager',
                      child: Text('Senior Manager'),
                    ),
                  ],
                  icon: const Icon(Icons.admin_panel_settings_rounded),
                ),
                IconButton(
                  key: Key('owner-member-remove-${member.uid}'),
                  onPressed: busy ? null : () => onRemove(member),
                  icon: const Icon(Icons.person_remove_alt_1_rounded),
                ),
              ],
            ),
    );
  }
}

class _PendingManagementTile extends StatelessWidget {
  const _PendingManagementTile({
    required this.request,
    required this.busy,
    required this.onRespond,
    required this.onCancelInvite,
  });

  final OwnerAgencyPendingRequest request;
  final bool busy;
  final Future<void> Function(OwnerAgencyPendingRequest, String) onRespond;
  final Future<void> Function(OwnerAgencyPendingRequest) onCancelInvite;

  @override
  Widget build(BuildContext context) {
    final label = request.type == 'leave'
        ? 'طلب مغادرة'
        : request.type == 'join'
            ? 'طلب انضمام'
            : 'دعوة معلّقة';
    return ListTile(
      dense: true,
      contentPadding: EdgeInsets.zero,
      title: Text(
        request.userPublicId ?? request.uid,
        style: const TextStyle(color: Colors.white),
      ),
      subtitle: Text(label, style: const TextStyle(color: Colors.white54)),
      trailing: request.type == 'invite'
          ? TextButton(
              onPressed: busy ? null : () => onCancelInvite(request),
              child: const Text('إلغاء'),
            )
          : Wrap(
              spacing: 4,
              children: [
                TextButton(
                  onPressed: busy ? null : () => onRespond(request, 'reject'),
                  child: const Text('رفض'),
                ),
                FilledButton(
                  onPressed: busy ? null : () => onRespond(request, 'accept'),
                  child: const Text('قبول'),
                ),
              ],
            ),
    );
  }
}

String _roleLabel(String role) {
  switch (role) {
    case 'owner':
      return 'Owner';
    case 'senior_manager':
      return 'Senior Manager';
    case 'manager':
      return 'Manager';
    default:
      return 'Host';
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
