import 'dart:async';

import 'package:flutter/material.dart';

import '../services/agency_membership_service.dart';
import '../services/host_my_agency_service.dart';
import 'agency_application_page.dart';
import 'agency_search_page.dart';
import 'host_my_agency_page.dart';

class MyAgencyEntryPage extends StatefulWidget {
  const MyAgencyEntryPage({super.key});

  @override
  State<MyAgencyEntryPage> createState() => _MyAgencyEntryPageState();
}

class _MyAgencyEntryPageState extends State<MyAgencyEntryPage> {
  final HostMyAgencyService _hostService = HostMyAgencyService();
  final AgencyMembershipService _membershipService =
      AgencyMembershipService();

  HostMyAgencyCoreData? _core;
  AgencyJoinEligibility? _eligibility;
  bool _loading = true;
  bool _unjoined = false;
  bool _cooldownExceptionSubmitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _hostService.close();
    _membershipService.close();
    super.dispose();
  }

  String _code(Object error) =>
      error.toString().replaceFirst('Bad state: ', '').trim();

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final core = await _hostService.loadCore();
      if (!mounted) return;
      setState(() {
        _core = core;
        _eligibility = null;
        _unjoined = false;
        _loading = false;
      });
      return;
    } catch (error) {
      if (_code(error) != 'agency_host_not_found') {
        if (!mounted) return;
        setState(() {
          _error = _code(error);
          _loading = false;
        });
        return;
      }
    }

    try {
      final eligibility = await _membershipService.loadEligibility();
      if (!mounted) return;
      setState(() {
        _core = null;
        _eligibility = eligibility;
        _unjoined = true;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _code(error);
        _loading = false;
      });
    }
  }

  Future<void> _requestCooldownException() async {
    final cooldown = _eligibility?.cooldown;
    if (cooldown == null ||
        !cooldown.canRequestException ||
        _cooldownExceptionSubmitting) {
      return;
    }
    final controller = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('طلب استثناء فترة الانتظار'),
          content: TextField(
            controller: controller,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'سبب طلب الاستثناء',
              border: OutlineInputBorder(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (controller.text.trim().length >= 3) {
                  Navigator.pop(dialogContext, true);
                }
              },
              child: const Text('إرسال الطلب'),
            ),
          ],
        ),
      ),
    );
    final reason = controller.text.trim();
    controller.dispose();
    if (accepted != true || reason.length < 3 || !mounted) return;

    setState(() => _cooldownExceptionSubmitting = true);
    try {
      await _membershipService.requestCooldownException(reason: reason);
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم إرسال طلب الاستثناء إلى Shadow Live.'),
        ),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تعذر إرسال طلب الاستثناء حاليًا.'),
        ),
      );
    } finally {
      if (mounted) {
        setState(() => _cooldownExceptionSubmitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: Color(0xFF070914),
          body: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    final core = _core;
    if (core != null) {
      return HostMyAgencyPage(initialCore: core);
    }

    if (_error != null || !_unjoined) {
      return Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF070914),
          appBar: AppBar(
            title: const Text('وكالتي'),
            backgroundColor: const Color(0xFF0B1020),
          ),
          body: Center(
            child: FilledButton.icon(
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('تعذر تحميل حالة الوكالة — إعادة المحاولة'),
            ),
          ),
        ),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF070914),
          appBar: AppBar(
            backgroundColor: const Color(0xFF0B1020),
            title: const Text('وكالتي'),
            actions: [
              IconButton(
                tooltip: 'تحديث',
                onPressed: _load,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
            bottom: const TabBar(
              tabs: [
                Tab(
                  icon: Icon(Icons.group_add_rounded),
                  text: 'انضمام لوكالة',
                ),
                Tab(
                  icon: Icon(Icons.add_business_rounded),
                  text: 'إنشاء وكالة',
                ),
              ],
            ),
          ),
          body: TabBarView(
            children: [
              Column(
                children: [
                  if (_eligibility != null &&
                      !_eligibility!.canRequestJoin)
                    _EligibilityBanner(
                      eligibility: _eligibility!,
                      cooldownExceptionSubmitting:
                          _cooldownExceptionSubmitting,
                      onRequestCooldownException:
                          _requestCooldownException,
                    ),
                  Expanded(
                    child: AgencySearchPage(
                      embedded: true,
                      joinEnabled: _eligibility?.canRequestJoin ?? true,
                      joinBlockedReason: _eligibility != null &&
                              !_eligibility!.canRequestJoin
                          ? _agencyEligibilityMessage(_eligibility!)
                          : null,
                    ),
                  ),
                ],
              ),
              const AgencyApplicationPage(embedded: true),
            ],
          ),
        ),
      ),
    );
  }
}

String _agencyEligibilityMessage(AgencyJoinEligibility eligibility) {
  final linked = eligibility.linkedAgencyId;
  if (linked != null && linked.isNotEmpty) {
    return 'الحساب مرتبط حاليًا بالوكالة $linked. حدّث الصفحة لفتح معلومات الوكالة.';
  }
  final membership = eligibility.membershipReservation;
  if (membership != null) {
    final agencyId = membership.agencyId;
    return agencyId == null || agencyId.isEmpty
        ? 'لديك طلب أو دعوة وكالة قيد الانتظار.'
        : 'لديك طلب أو دعوة وكالة قيد الانتظار للوكالة $agencyId.';
  }
  if (eligibility.applicationReservation != null) {
    return 'حسابك مرتبط بطلب إنشاء وكالة حاليًا. لا يمكن إرسال طلب انضمام جديد حتى حسمه.';
  }
  return 'تعذر إرسال طلب انضمام جديد في الحالة الحالية.';
}

String _cooldownStatusText(AgencyCooldownExceptionStatus cooldown) {
  final seconds = cooldown.remainingSeconds < 0
      ? 0
      : cooldown.remainingSeconds;
  final days = seconds ~/ 86400;
  final hours = (seconds % 86400) ~/ 3600;
  final minutes = (seconds % 3600) ~/ 60;
  final parts = <String>[];
  if (days > 0) parts.add('$days يوم');
  if (hours > 0) parts.add('$hours ساعة');
  if (days == 0 && minutes > 0) parts.add('$minutes دقيقة');
  final remaining = parts.isEmpty ? 'أقل من دقيقة' : parts.join(' و');
  return 'فترة الانتظار المتبقية: $remaining.';
}

class _EligibilityBanner extends StatelessWidget {
  const _EligibilityBanner({
    required this.eligibility,
    required this.cooldownExceptionSubmitting,
    required this.onRequestCooldownException,
  });

  final AgencyJoinEligibility eligibility;
  final bool cooldownExceptionSubmitting;
  final VoidCallback onRequestCooldownException;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF2D2413),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.amberAccent.withValues(alpha: .35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.info_outline_rounded,
                color: Colors.amberAccent,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _agencyEligibilityMessage(eligibility),
                  style: const TextStyle(
                    color: Colors.white70,
                    height: 1.4,
                  ),
                ),
              ),
            ],
          ),
          if (eligibility.cooldown?.active == true) ...[
            const SizedBox(height: 10),
            Text(
              _cooldownStatusText(eligibility.cooldown!),
              style: const TextStyle(
                color: Colors.white60,
                fontSize: 12,
              ),
            ),
            if (eligibility.cooldown!.exceptionStatus == 'pending') ...[
              const SizedBox(height: 8),
              const Text(
                'طلب الاستثناء قيد مراجعة Shadow Live.',
                style: TextStyle(
                  color: Colors.amberAccent,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ] else if (eligibility.cooldown!.canRequestException) ...[
              const SizedBox(height: 8),
              OutlinedButton.icon(
                key: const Key('agency-cooldown-exception-request'),
                onPressed: cooldownExceptionSubmitting
                    ? null
                    : onRequestCooldownException,
                icon: cooldownExceptionSubmitting
                    ? const SizedBox.square(
                        dimension: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.hourglass_disabled_rounded),
                label: Text(
                  cooldownExceptionSubmitting
                      ? 'جارٍ إرسال الطلب…'
                      : 'طلب استثناء فترة الانتظار',
                ),
              ),
            ],
          ],
        ],
      ),
    );
  }
}
