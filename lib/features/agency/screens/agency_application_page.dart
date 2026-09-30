import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../services/navigation_service.dart';
import '../services/agency_application_service.dart';

class AgencyApplicationPage extends StatefulWidget {
  const AgencyApplicationPage({super.key});

  @override
  State<AgencyApplicationPage> createState() => _AgencyApplicationPageState();
}

class _AgencyApplicationPageState extends State<AgencyApplicationPage> {
  final AgencyApplicationService _service = AgencyApplicationService();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _country = TextEditingController();
  late final List<TextEditingController> _hosts =
      List.generate(5, (_) => TextEditingController());

  AgencyApplicationStatus? _status;
  bool _loading = true;
  bool _submitting = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_loadStatus());
  }

  @override
  void dispose() {
    _service.close();
    _name.dispose();
    _country.dispose();
    for (final controller in _hosts) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _loadStatus() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final status = await _service.loadStatus();
      if (!mounted) return;
      setState(() {
        _status = status;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _messageFor(error);
        _loading = false;
      });
    }
  }

  String? _validate() {
    if (_name.text.trim().isEmpty) {
      return 'اكتب اسم الوكالة.';
    }
    final ids = _hosts.map((controller) => controller.text.trim()).toList();
    for (var index = 0; index < ids.length; index += 1) {
      if (!RegExp(r'^\d{6}$').hasMatch(ids[index])) {
        return 'ID المضيف رقم ${index + 1} يجب أن يكون 6 أرقام.';
      }
    }
    if (ids.toSet().length != ids.length) {
      return 'لا يمكن تكرار نفس المضيف أكثر من مرة.';
    }
    return null;
  }

  Future<void> _submit() async {
    if (_submitting) return;
    final validation = _validate();
    if (validation != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(validation)),
      );
      return;
    }

    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await _service.submit(
        name: _name.text,
        country: _country.text,
        hostIds: _hosts.map((controller) => controller.text).toList(),
      );
      if (!mounted) return;
      await _loadStatus();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم إرسال طلب إنشاء الوكالة للإدارة.'),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _messageFor(error);
      });
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  String _messageFor(Object error) {
    final code = error is AgencyApplicationException
        ? error.code
        : error.toString().replaceFirst('Bad state: ', '');
    switch (code) {
      case 'not_signed_in':
        return 'سجّل الدخول بحساب حقيقي أولًا.';
      case 'account_required':
        return 'حساب الضيف لا يستطيع إنشاء وكالة.';
      case 'applicant_already_in_agency':
        return 'أنت منضم إلى وكالة بالفعل.';
      case 'agency_application_already_pending':
        return 'لديك طلب إنشاء وكالة قيد المراجعة بالفعل.';
      case 'agency_application_participation_conflict':
        return 'حسابك مرتبط حاليًا بطلب وكالة آخر.';
      case 'agency_host_id_not_found':
        return 'أحد معرفات المضيفين غير موجود.';
      case 'agency_host_unavailable':
        return 'أحد المضيفين غير متاح حاليًا.';
      case 'agency_host_already_in_agency':
        return 'أحد المضيفين منضم إلى وكالة أخرى بالفعل.';
      case 'agency_host_application_conflict':
        return 'أحد المضيفين مرتبط بطلب وكالة آخر حاليًا.';
      case 'duplicate_agency_application_host':
        return 'لا يمكن تكرار نفس المضيف في الطلب.';
      case 'applicant_cannot_be_application_host':
        return 'لا تضع ID حسابك ضمن المضيفين الخمسة.';
      case 'agency_reapply_blocked':
        return 'إعادة التقديم مقفلة حاليًا حسب قرار الإدارة.';
      case 'agency_reapply_too_early':
        return 'موعد إعادة التقديم لم يحن بعد.';
      case 'invalid_agency_name':
        return 'اسم الوكالة غير صالح.';
      case 'invalid_agency_country':
        return 'اسم الدولة غير صالح.';
      case 'invalid_agency_application_hosts':
        return 'يجب إدخال خمسة مضيفين بالضبط.';
      case 'invalid_agency_application_host_id':
        return 'كل ID مضيف يجب أن يكون 6 أرقام.';
      default:
        return 'تعذر تنفيذ الطلب الآن. حاول مرة أخرى.';
    }
  }

  String _remaining(int seconds) {
    if (seconds <= 0) return 'متاح الآن';
    final days = seconds ~/ 86400;
    final hours = (seconds % 86400) ~/ 3600;
    final minutes = (seconds % 3600) ~/ 60;
    if (days > 0) return '$days يوم و$hours ساعة';
    if (hours > 0) return '$hours ساعة و$minutes دقيقة';
    return '$minutes دقيقة';
  }

  Widget _statusCard(AgencyApplicationStatus status) {
    if (status.isPending) {
      final reviewing = status.status == 'under_review';
      return _StateCard(
        icon:
            reviewing ? Icons.manage_search_rounded : Icons.hourglass_top_rounded,
        color: Colors.amberAccent,
        title: reviewing ? 'الطلب قيد المراجعة' : 'تم إرسال الطلب',
        body: reviewing
            ? 'الإدارة تراجع طلب إنشاء الوكالة الآن. لا تحتاج لإرسال طلب جديد.'
            : 'طلبك مسجل وينتظر مراجعة الإدارة. سنحتفظ بنفس الطلب حتى يتم اتخاذ القرار.',
      );
    }

    if (status.isApproved) {
      return _StateCard(
        icon: Icons.check_circle_rounded,
        color: Colors.greenAccent,
        title: 'تمت الموافقة على الوكالة',
        body:
            'تم قبول الطلب. ارجع للملف الشخصي ثم افتح «وكالتي» لإدارة الوكالة.',
        action: FilledButton.icon(
          onPressed: () => Navigator.pop(context, true),
          icon: const Icon(Icons.arrow_back_rounded),
          label: const Text('العودة للملف الشخصي'),
        ),
      );
    }

    if (status.isRejected && !status.canReapply) {
      final manual = status.reapplyMode == 'manual';
      final reason = status.rejectionReason;
      return _StateCard(
        icon: Icons.cancel_outlined,
        color: Colors.redAccent,
        title: 'تم رفض الطلب',
        body: [
          if (reason != null) 'السبب: $reason',
          if (manual)
            'إعادة التقديم غير متاحة حتى تسمح الإدارة بها.'
          else
            'يمكنك إعادة التقديم بعد ${_remaining(status.remainingSeconds)}.',
        ].join('\n'),
      );
    }

    if (status.isRejected && status.canReapply) {
      return _StateCard(
        icon: Icons.restart_alt_rounded,
        color: Colors.amberAccent,
        title: 'يمكنك إعادة التقديم',
        body: status.rejectionReason == null
            ? 'الطلب السابق مرفوض، وإعادة التقديم متاحة الآن.'
            : 'سبب رفض الطلب السابق: ${status.rejectionReason}\nإعادة التقديم متاحة الآن.',
      );
    }

    return const SizedBox.shrink();
  }

  bool get _showForm {
    final status = _status;
    if (status == null || status.status == 'none') return true;
    return status.isRejected && status.canReapply;
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF070914),
        appBar: AppBar(
          title: const Text('طلب إنشاء وكالة'),
          backgroundColor: const Color(0xFF0B1020),
          actions: [
            IconButton(
              tooltip: 'تحديث حالة الطلب',
              onPressed: _loading || _submitting ? null : _loadStatus,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        body: _loading
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
                children: [
                  const _IntroCard(),
                  if (_status != null) ...[
                    const SizedBox(height: 12),
                    _statusCard(_status!),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 12),
                    _ErrorCard(message: _error!),
                  ],
                  if (_showForm) ...[
                    const SizedBox(height: 16),
                    _form(),
                  ],
                  const SizedBox(height: 12),
                  OutlinedButton.icon(
                    onPressed: () =>
                        Navigator.pushNamed(context, AppRoutes.agencySearch),
                    icon: const Icon(Icons.travel_explore_rounded),
                    label: const Text('البحث عن وكالة موجودة'),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _form() {
    return Card(
      color: const Color(0xFF111526),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'بيانات الطلب',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 6),
            const Text(
              'يلزم خمسة مضيفين غير منضمين لأي وكالة وغير مرتبطين بطلب وكالة آخر.',
              style: TextStyle(color: Colors.white60, height: 1.45),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _name,
              maxLength: 80,
              enabled: !_submitting,
              decoration: const InputDecoration(
                labelText: 'اسم الوكالة *',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.apartment_rounded),
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _country,
              maxLength: 64,
              enabled: !_submitting,
              decoration: const InputDecoration(
                labelText: 'الدولة (اختياري)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.public_rounded),
              ),
            ),
            const SizedBox(height: 8),
            const Text(
              'المضيفون الخمسة',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 8),
            for (var index = 0; index < _hosts.length; index += 1) ...[
              TextField(
                controller: _hosts[index],
                enabled: !_submitting,
                keyboardType: TextInputType.number,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: 'ID المضيف ${index + 1} *',
                  hintText: '6 أرقام',
                  counterText: '',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.person_add_alt_1_rounded),
                ),
              ),
              if (index != _hosts.length - 1) const SizedBox(height: 8),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              key: const Key('agency-application-submit'),
              onPressed: _submitting ? null : _submit,
              icon: _submitting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send_rounded),
              label: Text(
                _submitting ? 'جار إرسال الطلب...' : 'إرسال طلب إنشاء الوكالة',
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _IntroCard extends StatelessWidget {
  const _IntroCard();

  @override
  Widget build(BuildContext context) {
    return const Card(
      color: Color(0xFF111526),
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.info_outline_rounded, color: Color(0xFFFFD54A)),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'من هنا تقدم طلب إنشاء وكالة جديدة. بعد الإرسال يصل الطلب للإدارة للمراجعة والموافقة أو الرفض. لا يتم إنشاء الوكالة قبل موافقة الإدارة.',
                style: TextStyle(height: 1.5),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StateCard extends StatelessWidget {
  const _StateCard({
    required this.icon,
    required this.color,
    required this.title,
    required this.body,
    this.action,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF111526),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 30),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: color,
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(body, style: const TextStyle(height: 1.5)),
                  if (action != null) ...[
                    const SizedBox(height: 12),
                    action!,
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Colors.red.withValues(alpha: .12),
      child: ListTile(
        leading:
            const Icon(Icons.error_outline_rounded, color: Colors.redAccent),
        title: const Text(
          'تعذر إكمال العملية',
          style: TextStyle(fontWeight: FontWeight.w900),
        ),
        subtitle: Text(message),
      ),
    );
  }
}
