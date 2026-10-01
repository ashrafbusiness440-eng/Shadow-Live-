import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../profile/screens/public_profile_screen.dart';
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
  int? _pendingNextOffset;
  bool _pendingHasMore = false;
  bool _pendingTruncated = false;
  bool _pendingLoadingMore = false;
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
      final pending = await _ownerService.loadPendingPage(agencyId);
      if (!mounted) return;
      setState(() {
        _membersData = members;
        _pendingRequests = pending.requests;
        _pendingNextOffset = pending.nextOffset;
        _pendingHasMore = pending.hasMore;
        _pendingTruncated = pending.truncated;
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

  Future<void> _loadMorePending() async {
    final offset = _pendingNextOffset;
    if (_pendingLoadingMore || !_pendingHasMore || offset == null) return;
    setState(() {
      _pendingLoadingMore = true;
      _managementError = null;
    });
    try {
      final page = await _ownerService.loadPendingPage(
        _data.agency.agencyId,
        offset: offset,
      );
      if (!mounted) return;
      final existing = {
        for (final item in _pendingRequests ?? const <OwnerAgencyPendingRequest>[])
          item.requestId: item,
      };
      for (final item in page.requests) {
        existing[item.requestId] = item;
      }
      final merged = existing.values.toList()
        ..sort((a, b) {
          final left = a.createdAt?.millisecondsSinceEpoch ?? 0;
          final right = b.createdAt?.millisecondsSinceEpoch ?? 0;
          return right.compareTo(left);
        });
      setState(() {
        _pendingRequests = merged;
        _pendingNextOffset = page.nextOffset;
        _pendingHasMore = page.hasMore;
        _pendingTruncated = page.truncated;
        _pendingLoadingMore = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _managementError = error.toString();
        _pendingLoadingMore = false;
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
      hint: 'Public ID من 3 إلى 8 أرقام',
      digitsOnly: true,
    );
    if (publicId == null || !RegExp(r'^\d{3,8}$').hasMatch(publicId)) return;
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

  Future<void> _showHostPerformance(
    OwnerAgencyMember member,
  ) async {
    if (member.role == 'owner' || member.uid.isEmpty) return;
    final future = _ownerService.loadHostPerformance(member.uid);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D1220),
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: _HostPerformanceSheet(
          future: future,
        ),
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
                      pendingHasMore: _pendingHasMore,
                      pendingLoadingMore: _pendingLoadingMore,
                      pendingTruncated: _pendingTruncated,
                      loading: _managementLoading,
                      busy: _managementBusy,
                      error: _managementError,
                      onLoad: _loadManagement,
                      onLoadMorePending: _loadMorePending,
                      onInvite: _inviteHost,
                      onSetRole: _setMemberRole,
                      onRemove: _removeMember,
                      onPerformance: _showHostPerformance,
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
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        'Agency ID: ${data.agency.publicId}',
                        key: const Key('owner-agency-public-id'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(color: Colors.white60),
                      ),
                    ),
                    const SizedBox(width: 4),
                    IconButton(
                      key: const Key('owner-agency-copy-id'),
                      tooltip: 'نسخ Agency ID',
                      visualDensity: VisualDensity.compact,
                      constraints:
                          const BoxConstraints(minWidth: 30, minHeight: 30),
                      padding: EdgeInsets.zero,
                      onPressed: () async {
                        await Clipboard.setData(
                          ClipboardData(text: data.agency.publicId),
                        );
                        if (!context.mounted) return;
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('تم نسخ Agency ID')),
                        );
                      },
                      icon: const Icon(Icons.copy_rounded, size: 16),
                    ),
                  ],
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
                  value: current.activeHostCount.toString(),
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
                  label: 'Agency Bonus',
                  value: '${_bps(bonus.bps)} / Host مؤهل',
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Text(
            'Agency Performance Bonus يُحسب مرة واحدة لكل Host مؤهل على أعلى Target محقق، بشرط 14 يوم × 120 دقيقة، ويُجمع للوكالة عند إغلاق الشهر.',
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
    required this.pendingHasMore,
    required this.pendingLoadingMore,
    required this.pendingTruncated,
    required this.loading,
    required this.busy,
    required this.error,
    required this.onLoad,
    required this.onLoadMorePending,
    required this.onInvite,
    required this.onSetRole,
    required this.onRemove,
    required this.onPerformance,
    required this.onRespond,
    required this.onCancelInvite,
  });

  final OwnerAgencyMembersData? data;
  final List<OwnerAgencyPendingRequest>? pending;
  final bool pendingHasMore;
  final bool pendingLoadingMore;
  final bool pendingTruncated;
  final bool loading;
  final bool busy;
  final String? error;
  final Future<void> Function() onLoad;
  final Future<void> Function() onLoadMorePending;
  final Future<void> Function() onInvite;
  final Future<void> Function(OwnerAgencyMember, String) onSetRole;
  final Future<void> Function(OwnerAgencyMember) onRemove;
  final Future<void> Function(OwnerAgencyMember) onPerformance;
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
              onPerformance: onPerformance,
            ),
          ),
          const Divider(color: Color(0x22FFFFFF), height: 26),
          Row(
            children: [
              const Text(
                'الطلبات المعلّقة',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(width: 8),
              if (requests.isNotEmpty)
                Container(
                  key: const Key('owner-agency-pending-badge'),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: Colors.redAccent,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    '${requests.length}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                      fontSize: 12,
                    ),
                  ),
                ),
            ],
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
          if (pendingHasMore) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              key: const Key('owner-agency-pending-load-more'),
              onPressed:
                  pendingLoadingMore || busy ? null : onLoadMorePending,
              icon: pendingLoadingMore
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.expand_more_rounded),
              label: Text(
                pendingLoadingMore ? 'جارٍ التحميل…' : 'تحميل المزيد',
              ),
            ),
          ],
          if (pendingTruncated) ...[
            const SizedBox(height: 8),
            const Text(
              'تم الوصول إلى حد نافذة الطلبات الآمنة. حدّث القائمة بعد حسم الطلبات الحالية.',
              style: TextStyle(color: Colors.amberAccent, fontSize: 12),
            ),
          ],
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
    required this.onPerformance,
  });

  final OwnerAgencyMember member;
  final bool busy;
  final Future<void> Function(OwnerAgencyMember, String) onSetRole;
  final Future<void> Function(OwnerAgencyMember) onRemove;
  final Future<void> Function(OwnerAgencyMember) onPerformance;

  @override
  Widget build(BuildContext context) {
    final owner = member.role == 'owner';
    final image = member.profileImageUrl?.trim() ?? '';
    final publicId = member.publicId?.trim() ?? '';
    final displayName =
        member.displayName ?? (publicId.isEmpty ? member.uid : publicId);

    void openProfile() {
      if (member.uid.isEmpty) return;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PublicProfileScreen(userId: member.uid),
        ),
      );
    }

    return Card(
      key: Key('owner-agency-member-${member.uid}'),
      color: const Color(0xFF11182A),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                InkWell(
                  onTap: openProfile,
                  borderRadius: BorderRadius.circular(999),
                  child: CircleAvatar(
                    key: Key('owner-member-avatar-${member.uid}'),
                    radius: 24,
                    backgroundColor: const Color(0xFF2A3150),
                    backgroundImage:
                        image.isEmpty ? null : NetworkImage(image),
                    child: image.isEmpty
                        ? const Icon(Icons.person_rounded)
                        : null,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      InkWell(
                        onTap: openProfile,
                        child: Text(
                          displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      if (publicId.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                'ID: $publicId',
                                key: Key('owner-member-id-${member.uid}'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                textDirection: TextDirection.ltr,
                                style: const TextStyle(
                                  color: Colors.white54,
                                  fontSize: 13,
                                ),
                              ),
                            ),
                            const SizedBox(width: 4),
                            IconButton(
                              key: Key('owner-member-copy-id-${member.uid}'),
                              tooltip: 'نسخ Public ID',
                              visualDensity: VisualDensity.compact,
                              constraints: const BoxConstraints(
                                minWidth: 28,
                                minHeight: 28,
                              ),
                              padding: EdgeInsets.zero,
                              onPressed: () async {
                                await Clipboard.setData(
                                  ClipboardData(text: publicId),
                                );
                                if (!context.mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(content: Text('تم نسخ ID')),
                                );
                              },
                              icon: const Icon(Icons.copy_rounded, size: 16),
                            ),
                          ],
                        ),
                      ],
                      const SizedBox(height: 2),
                      Text(
                        '${_roleLabel(member.role)} • العضوية: ${member.status == 'active' ? 'نشطة' : member.status} • الحساب: ${_accountStatusLabel(member.accountStatus)}',
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white54,
                          fontSize: 12,
                          height: 1.35,
                        ),
                      ),
                    ],
                  ),
                ),
                if (owner) ...[
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.workspace_premium_rounded,
                    color: Color(0xFFFFD875),
                  ),
                ],
              ],
            ),
            if (!owner) ...[
              const SizedBox(height: 8),
              const Divider(height: 1, color: Colors.white12),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  IconButton(
                    key: Key('owner-member-performance-${member.uid}'),
                    tooltip: 'الأداء',
                    visualDensity: VisualDensity.compact,
                    onPressed: busy ? null : () => onPerformance(member),
                    icon: const Icon(
                      Icons.query_stats_rounded,
                      size: 20,
                    ),
                  ),
                  PopupMenuButton<String>(
                    key: Key('owner-member-role-${member.uid}'),
                    enabled: !busy,
                    tooltip: 'تغيير الدور',
                    onSelected: (role) => onSetRole(member, role),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'host', child: Text('مضيف')),
                      PopupMenuItem(value: 'manager', child: Text('مدير')),
                      PopupMenuItem(
                        value: 'senior_manager',
                        child: Text('مدير أول'),
                      ),
                    ],
                    icon: const Icon(
                      Icons.admin_panel_settings_rounded,
                      size: 20,
                    ),
                  ),
                  IconButton(
                    key: Key('owner-member-remove-${member.uid}'),
                    tooltip: 'إزالة من الوكالة',
                    visualDensity: VisualDensity.compact,
                    onPressed: busy ? null : () => onRemove(member),
                    icon: const Icon(
                      Icons.person_remove_alt_1_rounded,
                      size: 20,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _HostPerformanceSheet extends StatelessWidget {
  const _HostPerformanceSheet({
    required this.future,
  });

  final Future<OwnerHostPerformanceData> future;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * .82,
        child: FutureBuilder<OwnerHostPerformanceData>(
          future: future,
          builder: (context, snapshot) {
            if (snapshot.connectionState != ConnectionState.done) {
              return const Center(child: CircularProgressIndicator());
            }
            if (snapshot.hasError || snapshot.data == null) {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Text(
                    'تعذر تحميل أداء المضيف حاليًا.',
                    style: TextStyle(color: Colors.white70),
                  ),
                ),
              );
            }

            final data = snapshot.data!;
            final image = data.profileImageUrl?.trim() ?? '';
            final denominator =
                data.targetCoins <= 0 ? 1 : data.targetCoins;
            final ratio =
                (data.progressCoins / denominator).clamp(0.0, 1.0).toDouble();
            final activityComplete =
                data.qualifiedDays >= data.requiredQualifiedDays &&
                data.micSecondsMonth >= data.requiredMicSecondsMonth;
            final progressPercent = (ratio * 100).round();
            final statusText = data.currentLevel != null && !activityComplete
                ? data.remainingCoins > 0
                    ? 'الـTarget الحالي محقق والنشاط ناقص • باقي ${_compact(data.remainingCoins)} Coins للـTarget التالي'
                    : 'الـTarget محقق والنشاط ناقص'
                : data.remainingCoins > 0
                    ? 'باقي ${_compact(data.remainingCoins)} Coins للـTarget التالي'
                    : data.currentLevel != null
                        ? 'الـTarget والنشاط مكتملان'
                        : 'ابدأ التقدم نحو أول Target';

            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 26),
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 30,
                      backgroundColor: const Color(0xFF2A3150),
                      backgroundImage:
                          image.isEmpty ? null : NetworkImage(image),
                      child: image.isEmpty
                          ? const Icon(Icons.person_rounded)
                          : null,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            data.displayName,
                            style: const TextStyle(
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          Text(
                            'ID: ${data.publicId ?? '—'} • ${_roleLabel(data.role)}',
                            style: const TextStyle(color: Colors.white54),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.query_stats_rounded,
                      color: Colors.amberAccent,
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: _cardDecoration(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        statusText,
                        style: const TextStyle(
                          color: Colors.amberAccent,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      const SizedBox(height: 12),
                      LinearProgressIndicator(
                        value: ratio,
                        minHeight: 9,
                        borderRadius: BorderRadius.circular(20),
                      ),
                      const SizedBox(height: 12),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _PerformancePill(
                            label: 'نسبة التقدم',
                            value: '$progressPercent%',
                          ),
                          _PerformancePill(
                            label: 'المحتسب',
                            value: '${_compact(data.progressCoins)} Coins',
                          ),
                          _PerformancePill(
                            label: 'المتبقي',
                            value: '${_compact(data.remainingCoins)} Coins',
                          ),
                          _PerformancePill(
                            label: 'الحالي',
                            value: _ownerHostLevelWithTarget(data.currentLevel),
                          ),
                          _PerformancePill(
                            label: 'التالي',
                            value: _ownerHostLevelWithTarget(data.nextLevel),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: _cardDecoration(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'النشاط هذا الشهر',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        'الأيام المحققة: ${data.qualifiedDays} / ${data.requiredQualifiedDays}',
                      ),
                      const SizedBox(height: 5),
                      Text(
                        'وقت المايك: ${(data.micSecondsMonth / 60).floor()} / ${(data.requiredMicSecondsMonth / 60).floor()} دقيقة',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: _cardDecoration(),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const Text(
                        'Targets المحققة هذا الشهر',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 8),
                      if (data.achievements.isEmpty)
                        const Text(
                          'لا يوجد Target محقق مسجل لهذا الشهر بعد.',
                          style: TextStyle(color: Colors.white54),
                        )
                      else
                        ...data.achievements.reversed.map(
                          (item) => ListTile(
                            dense: true,
                            contentPadding: EdgeInsets.zero,
                            leading: const Icon(
                              Icons.check_circle_rounded,
                              color: Colors.greenAccent,
                            ),
                            title: Text(
                              '${item.tierId} ${item.rank}'.trim(),
                            ),
                            subtitle: Text(
                              '${_compact(item.thresholdCoins)} Coins',
                            ),
                            trailing: Text(
                              _achievementDateLabel(item.achievedAt),
                              style: const TextStyle(
                                color: Colors.white54,
                                fontSize: 12,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                const Text(
                  'لا تعرض هذه الصفحة رصيد المضيف أو تحويلاته أو بيانات الشحن/السحب أو نسب التقسيم.',
                  style: TextStyle(
                    color: Colors.white38,
                    fontSize: 11,
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _PerformancePill extends StatelessWidget {
  const _PerformancePill({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(minWidth: 128),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.white54, fontSize: 11),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

String _ownerHostLevelLabel(OwnerHostPerformanceLevel? level) {
  if (level == null) return '—';
  final tier = level.tierId.trim();
  final rank = level.rank.trim();
  return [tier, rank].where((part) => part.isNotEmpty).join(' ');
}

String _ownerHostLevelWithTarget(OwnerHostPerformanceLevel? level) {
  if (level == null) return '—';
  final label = _ownerHostLevelLabel(level);
  return '$label • ${_compact(level.thresholdCoins)}';
}

String _achievementDateLabel(DateTime? value) {
  if (value == null) return '—';
  final local = value.toLocal();
  String two(int n) => n.toString().padLeft(2, '0');
  return '${local.year}/${two(local.month)}/${two(local.day)}';
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
    final publicId = request.userPublicId?.trim() ?? '';
    final image = request.profileImageUrl?.trim() ?? '';
    final statusLabel = _pendingConflictLabel(request);
    final displayName =
        request.displayName ?? (publicId.isEmpty ? request.uid : publicId);

    void openProfile() {
      if (request.uid.isEmpty) return;
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (_) => PublicProfileScreen(userId: request.uid),
        ),
      );
    }

    return Card(
      key: Key('owner-agency-pending-${request.requestId}'),
      color: const Color(0xFF11182A),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 12, 10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                InkWell(
                  onTap: request.uid.isEmpty ? null : openProfile,
                  borderRadius: BorderRadius.circular(999),
                  child: CircleAvatar(
                    radius: 24,
                    backgroundColor: const Color(0xFF31204F),
                    backgroundImage:
                        image.isEmpty ? null : NetworkImage(image),
                    child: image.isEmpty
                        ? const Icon(
                            Icons.person_rounded,
                            color: Colors.white70,
                          )
                        : null,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: InkWell(
                    onTap: request.uid.isEmpty ? null : openProfile,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (publicId.isNotEmpty)
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  'ID: $publicId',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  textDirection: TextDirection.ltr,
                                  style: const TextStyle(
                                    color: Colors.white54,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 2),
                              IconButton(
                                key: Key(
                                  'owner-pending-copy-id-${request.requestId}',
                                ),
                                tooltip: 'نسخ ID',
                                visualDensity: VisualDensity.compact,
                                constraints: const BoxConstraints(
                                  minWidth: 28,
                                  minHeight: 28,
                                ),
                                padding: EdgeInsets.zero,
                                onPressed: () async {
                                  await Clipboard.setData(
                                    ClipboardData(text: publicId),
                                  );
                                  if (!context.mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('تم نسخ ID المستخدم.'),
                                    ),
                                  );
                                },
                                icon: const Icon(
                                  Icons.copy_rounded,
                                  size: 16,
                                ),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 6),
                _PendingTypeChip(label: label),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                _PendingMetaChip(
                  icon: Icons.badge_outlined,
                  text: _roleLabel(request.targetRole),
                ),
                _PendingMetaChip(
                  icon: Icons.schedule_rounded,
                  text: _relativeWait(request.createdAt),
                ),
                _PendingMetaChip(
                  icon: Icons.person_outline_rounded,
                  text: _accountStatusLabel(request.accountStatus),
                ),
                _PendingMetaChip(
                  icon: Icons.apartment_rounded,
                  text: _agencyLinkStatusLabel(request),
                ),
              ],
            ),
            const SizedBox(height: 7),
            Text(
              'وقت الطلب: ${_createdAtLabel(request.createdAt)}',
              style: const TextStyle(
                color: Colors.white38,
                fontSize: 12,
              ),
            ),
            if (statusLabel != null) ...[
              const SizedBox(height: 4),
              Text(
                statusLabel,
                style: const TextStyle(
                  color: Colors.amberAccent,
                  fontSize: 12,
                ),
              ),
            ],
            const SizedBox(height: 10),
            const Divider(color: Color(0x22FFFFFF), height: 1),
            const SizedBox(height: 8),
            if (request.type == 'invite')
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  onPressed:
                      busy ? null : () => onCancelInvite(request),
                  icon: const Icon(Icons.close_rounded, size: 18),
                  label: const Text('إلغاء الدعوة'),
                ),
              )
            else
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed:
                          busy ? null : () => onRespond(request, 'reject'),
                      child: const Text('رفض'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: busy || !request.canAccept
                          ? null
                          : () => onRespond(request, 'accept'),
                      child: const Text('قبول'),
                    ),
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}

class _PendingTypeChip extends StatelessWidget {
  const _PendingTypeChip({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: const Color(0xFF2A2142),
        borderRadius: BorderRadius.circular(99),
      ),
      child: Text(
        label,
        maxLines: 1,
        style: const TextStyle(
          color: Color(0xFFB99CFF),
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _PendingMetaChip extends StatelessWidget {
  const _PendingMetaChip({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .05),
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: Colors.white54),
          const SizedBox(width: 4),
          Text(
            text,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white60,
              fontSize: 11,
            ),
          ),
        ],
      ),
    );
  }
}

String _roleLabel(String role) {
  switch (role) {
    case 'owner':
      return 'مالك الوكالة';
    case 'senior_manager':
      return 'مدير أول';
    case 'manager':
      return 'مدير';
    default:
      return 'مضيف';
  }
}

String _relativeWait(DateTime? createdAt) {
  if (createdAt == null) return 'وقت الإرسال غير متاح';
  final diff = DateTime.now().difference(createdAt.toLocal());
  if (diff.isNegative) return 'الآن';
  if (diff.inMinutes < 1) return 'الآن';
  if (diff.inHours < 1) return 'منذ ${diff.inMinutes} د';
  if (diff.inDays < 1) return 'منذ ${diff.inHours} س';
  return 'منذ ${diff.inDays} ي';
}

String _createdAtLabel(DateTime? createdAt) {
  if (createdAt == null) return '—';
  final value = createdAt.toLocal();
  String two(int number) => number.toString().padLeft(2, '0');
  return '${two(value.day)}/${two(value.month)}/${value.year} '
      '${two(value.hour)}:${two(value.minute)}';
}

String _accountStatusLabel(String status) {
  switch (status) {
    case 'active':
      return 'نشط';
    case 'suspended':
      return 'موقوف';
    case 'disabled':
      return 'معطّل';
    case 'banned':
      return 'محظور';
    default:
      return status.isEmpty ? 'غير متاح' : status;
  }
}

String _agencyLinkStatusLabel(OwnerAgencyPendingRequest request) {
  switch (request.conflictStatus) {
    case 'none':
      return request.type == 'leave' ? 'عضو حالي' : 'غير مرتبط';
    case 'already_in_agency':
      return 'عضو بوكالة أخرى';
    case 'reserved_other_request':
      return 'محجوز بطلب آخر';
    case 'membership_changed':
      return 'تغيّرت العضوية';
    case 'user_missing':
      return 'غير متاح';
    case 'account_inactive':
      return 'يلزم التحقق';
    default:
      return request.conflictStatus;
  }
}

String? _pendingConflictLabel(OwnerAgencyPendingRequest request) {
  switch (request.conflictStatus) {
    case 'account_inactive':
      return 'الحساب غير نشط — يلزم التحقق قبل القبول.';
    case 'user_missing':
      return 'الحساب غير متاح.';
    case 'already_in_agency':
      return 'المستخدم مرتبط بوكالة حاليًا.';
    case 'reserved_other_request':
      return 'لدى المستخدم طلب/دعوة وكالة أخرى محجوزة.';
    case 'membership_changed':
      return 'حالة العضوية تغيّرت منذ إرسال الطلب.';
    default:
      return request.accountStatus == 'active' ? null : 'حالة الحساب: ${request.accountStatus}';
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
