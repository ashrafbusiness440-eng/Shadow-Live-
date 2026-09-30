import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../services/navigation_service.dart';
import '../../../shared/widgets/country_selector.dart';
import '../services/agency_application_service.dart';

class AgencyApplicationPage extends StatefulWidget {
  const AgencyApplicationPage({super.key});

  @override
  State<AgencyApplicationPage> createState() => _AgencyApplicationPageState();
}

class _AgencyApplicationPageState extends State<AgencyApplicationPage> {
  final AgencyApplicationService _service = AgencyApplicationService();
  final TextEditingController _name = TextEditingController();

  List<TextEditingController> _hosts = <TextEditingController>[];
  List<AgencyApplicationHost?> _verifiedHosts =
      <AgencyApplicationHost?>[];
  List<bool> _verifyingHosts = <bool>[];

  AgencyApplicationStatus? _status;
  ShadowCountryOption? _country;
  int _requiredHostCount = 5;
  String? _reservationKey;
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
    for (final controller in _hosts) {
      controller.dispose();
    }
    super.dispose();
  }

  String _newReservationKey() {
    return 'agency_apply_${DateTime.now().microsecondsSinceEpoch}';
  }

  void _configureHostSlots(AgencyApplicationStatus status) {
    final count = status.requiredHostCount.clamp(0, 30).toInt();
    for (final controller in _hosts) {
      controller.dispose();
    }

    _requiredHostCount = count;
    _hosts = List<TextEditingController>.generate(
      count,
      (_) => TextEditingController(),
    );
    _verifiedHosts = List<AgencyApplicationHost?>.filled(count, null);
    _verifyingHosts = List<bool>.filled(count, false);

    final reserved = status.reservedHosts.take(count).toList(growable: false);
    for (var index = 0; index < reserved.length; index += 1) {
      _hosts[index].text = reserved[index].publicId;
      _verifiedHosts[index] = reserved[index];
    }

    _reservationKey = status.reservationKey;
    if (_reservationKey == null &&
        (status.status == 'none' ||
            status.status == 'draft' ||
            (status.isRejected && status.canReapply))) {
      _reservationKey = _newReservationKey();
    }
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
      _configureHostSlots(status);
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
    if (_hosts.length != _requiredHostCount ||
        _verifiedHosts.length != _requiredHostCount) {
      return 'عدد المضيفين تغيّر. حدّث الصفحة وحاول مرة ثانية.';
    }

    final ids = <String>[];
    for (var index = 0; index < _hosts.length; index += 1) {
      final id = _hosts[index].text.trim();
      if (!RegExp(r'^\d{3,8}$').hasMatch(id)) {
        return 'ID المضيف رقم ${index + 1} يجب أن يكون من 3 إلى 8 أرقام.';
      }
      final verified = _verifiedHosts[index];
      if (verified == null || verified.publicId != id) {
        return 'اضغط «تم» للتحقق من المضيف رقم ${index + 1} أولًا.';
      }
      ids.add(id);
    }
    if (ids.toSet().length != ids.length) {
      return 'لا يمكن تكرار نفس المضيف أكثر من مرة.';
    }
    return null;
  }

  Future<void> _verifyHost(int index) async {
    if (_submitting ||
        index < 0 ||
        index >= _hosts.length ||
        _verifyingHosts[index]) {
      return;
    }

    final hostId = _hosts[index].text.trim();
    if (!RegExp(r'^\d{3,8}$').hasMatch(hostId)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('ID المضيف يجب أن يكون من 3 إلى 8 أرقام.'),
        ),
      );
      return;
    }

    for (var other = 0; other < _hosts.length; other += 1) {
      if (other != index && _hosts[other].text.trim() == hostId) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم إدخال هذا المضيف مسبقًا في نفس الطلب.'),
          ),
        );
        return;
      }
    }

    final key = _reservationKey ??= _newReservationKey();
    setState(() {
      _verifyingHosts[index] = true;
      _error = null;
    });

    try {
      final result = await _service.reserveHost(
        hostId: hostId,
        idempotencyKey: key,
      );
      if (!mounted) return;

      if (result.requiredHostCount != _requiredHostCount) {
        await _loadStatus();
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'تم تحديث عدد المضيفين المطلوب من لوحة التحكم. راجع الخانات.',
            ),
          ),
        );
        return;
      }

      setState(() {
        _verifiedHosts[index] = result.host;
        _hosts[index].text = result.host.publicId;
      });
    } catch (error) {
      if (!mounted) return;
      final message = _messageFor(error);
      setState(() => _error = message);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted && index < _verifyingHosts.length) {
        setState(() => _verifyingHosts[index] = false);
      }
    }
  }

  Future<void> _removeVerifiedHost(int index) async {
    if (_submitting ||
        index < 0 ||
        index >= _verifiedHosts.length ||
        _verifyingHosts[index]) {
      return;
    }
    final verified = _verifiedHosts[index];
    final key = _reservationKey;
    if (verified == null || key == null) return;

    setState(() => _verifyingHosts[index] = true);
    try {
      await _service.releaseHost(
        hostId: verified.publicId,
        idempotencyKey: key,
      );
      if (!mounted) return;
      setState(() {
        _verifiedHosts[index] = null;
        _hosts[index].clear();
      });
    } catch (error) {
      if (!mounted) return;
      final message = _messageFor(error);
      setState(() => _error = message);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted && index < _verifyingHosts.length) {
        setState(() => _verifyingHosts[index] = false);
      }
    }
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

    final key = _reservationKey ??= _newReservationKey();
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await _service.submit(
        name: _name.text,
        country: _country?.nameAr ?? '',
        hostIds: _verifiedHosts
            .whereType<AgencyApplicationHost>()
            .map((host) => host.publicId)
            .toList(growable: false),
        idempotencyKey: key,
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
        return 'الحساب غير موجود.';
      case 'agency_host_unavailable':
        return 'الحساب غير متاح حاليًا.';
      case 'agency_host_already_in_agency':
        return 'الحساب غير متاح — داخل وكالة بالفعل.';
      case 'agency_host_application_conflict':
        return 'الحساب غير متاح — محجوز أو مرتبط بطلب وكالة آخر.';
      case 'duplicate_agency_application_host':
        return 'تمت إضافة هذا المضيف مسبقًا.';
      case 'applicant_cannot_be_application_host':
        return 'لا يمكنك إضافة حسابك ضمن المضيفين.';
      case 'agency_host_reservation_missing':
        return 'يجب التحقق من كل مضيف بزر «تم» قبل إرسال الطلب.';
      case 'agency_application_host_limit_reached':
        return 'اكتمل عدد المضيفين المطلوب لهذا الطلب.';
      case 'agency_application_hosts_not_required':
        return 'لوحة التحكم مضبوطة حاليًا على 0 مضيفين.';
      case 'agency_application_draft_not_editable':
      case 'agency_host_reservation_not_editable':
        return 'لم يعد بالإمكان تعديل هذا المضيف بعد إرسال الطلب.';
      case 'agency_reapply_blocked':
        return 'إعادة التقديم مقفلة حاليًا حسب قرار الإدارة.';
      case 'agency_reapply_too_early':
        return 'موعد إعادة التقديم لم يحن بعد.';
      case 'invalid_agency_name':
        return 'اسم الوكالة غير صالح.';
      case 'invalid_agency_country':
        return 'اسم الدولة غير صالح.';
      case 'invalid_agency_application_hosts':
        return 'يجب التحقق من جميع المضيفين المطلوبين قبل الإرسال.';
      case 'invalid_agency_application_host_count':
        return 'عدد المضيفين المطلوب يجب أن يكون من 0 إلى 30.';
      case 'invalid_agency_application_host_id':
        return 'ID المضيف يجب أن يكون من 3 إلى 8 أرقام.';
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
    if (status.status == 'draft') {
      return _StateCard(
        icon: Icons.lock_clock_rounded,
        color: Colors.lightBlueAccent,
        title: 'الطلب قيد التجهيز',
        body:
            'تم حجز ${status.reservedHosts.length} من ${status.requiredHostCount} مضيف. أكمل التحقق ثم أرسل الطلب.',
      );
    }

    if (status.isPending) {
      final reviewing = status.status == 'under_review';
      return _StateCard(
        icon:
            reviewing ? Icons.manage_search_rounded : Icons.hourglass_top_rounded,
        color: Colors.amberAccent,
        title: reviewing ? 'الطلب قيد المراجعة' : 'تم إرسال الطلب',
        body: reviewing
            ? 'الإدارة تراجع طلب إنشاء الوكالة الآن. لا تحتاج لإرسال طلب جديد.'
            : 'طلبك مسجل وينتظر مراجعة الإدارة. المضيفون محجوزون لهذا الطلب حتى يصدر القرار.',
      );
    }

    if (status.isApproved) {
      return _StateCard(
        icon: Icons.check_circle_rounded,
        color: Colors.greenAccent,
        title: 'تمت الموافقة على الوكالة',
        body:
            'تم قبول الطلب وإضافة المضيفين المحجوزين تلقائيًا إلى الوكالة.',
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
          'تم فك حجز المضيفين.',
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
    if (status == null || status.status == 'none' || status.status == 'draft') {
      return true;
    }
    return status.isRejected && status.canReapply;
  }

  int get _verifiedCount =>
      _verifiedHosts.whereType<AgencyApplicationHost>().length;

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
            Text(
              _requiredHostCount == 0
                  ? 'لا يطلب النظام مضيفين حاليًا. يمكنك إرسال الطلب مباشرة بعد تعبئة بيانات الوكالة.'
                  : 'يلزم $_requiredHostCount مضيف. كل ID يقبل من 3 إلى 8 أرقام، ويجب الضغط على «تم» للتحقق وحجز الحساب للطلب.',
              style: const TextStyle(color: Colors.white60, height: 1.45),
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
            ShadowCountryField(
              value: _country,
              enabled: !_submitting,
              onChanged: (country) => setState(() => _country = country),
            ),
            if (_requiredHostCount > 0) ...[
              const SizedBox(height: 14),
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'المضيفون',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                  ),
                  Text(
                    '$_verifiedCount / $_requiredHostCount تم التحقق',
                    style: const TextStyle(
                      color: Colors.white60,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              for (var index = 0; index < _hosts.length; index += 1) ...[
                _hostSlot(index),
                if (index != _hosts.length - 1) const SizedBox(height: 10),
              ],
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

  Widget _hostSlot(int index) {
    final verified = _verifiedHosts[index];
    final busy = _verifyingHosts[index];

    if (verified != null) {
      return Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(color: Colors.greenAccent.withValues(alpha: .45)),
          borderRadius: BorderRadius.circular(10),
          color: Colors.greenAccent.withValues(alpha: .06),
        ),
        child: Row(
          children: [
            _HostAvatar(host: verified),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    verified.displayName.isEmpty
                        ? 'مضيف معتمد'
                        : verified.displayName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'ID: ${verified.publicId}',
                    style: const TextStyle(color: Colors.white60),
                  ),
                ],
              ),
            ),
            const Icon(Icons.verified_rounded, color: Colors.greenAccent),
            const SizedBox(width: 4),
            IconButton(
              tooltip: 'تغيير المضيف',
              onPressed: busy || _submitting
                  ? null
                  : () => _removeVerifiedHost(index),
              icon: busy
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.close_rounded),
            ),
          ],
        ),
      );
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: TextField(
            controller: _hosts[index],
            enabled: !_submitting && !busy,
            keyboardType: TextInputType.number,
            maxLength: 8,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(
              labelText: 'ID المضيف ${index + 1} *',
              hintText: '3 إلى 8 أرقام',
              counterText: '',
              border: const OutlineInputBorder(),
              prefixIcon: const Icon(Icons.person_add_alt_1_rounded),
            ),
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          height: 56,
          child: FilledButton(
            onPressed: _submitting || busy ? null : () => _verifyHost(index),
            child: busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('تم'),
          ),
        ),
      ],
    );
  }
}

class _HostAvatar extends StatelessWidget {
  const _HostAvatar({required this.host});

  final AgencyApplicationHost host;

  @override
  Widget build(BuildContext context) {
    final photo = host.photoUrl;
    if (photo == null || photo.isEmpty) {
      return const CircleAvatar(
        radius: 24,
        child: Icon(Icons.person_rounded),
      );
    }
    return ClipOval(
      child: Image.network(
        photo,
        width: 48,
        height: 48,
        fit: BoxFit.cover,
        errorBuilder: (_, __, ___) => const CircleAvatar(
          radius: 24,
          child: Icon(Icons.person_rounded),
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
                'من هنا تقدم طلب إنشاء وكالة جديدة. عند اعتماد أي مضيف يتم حجز حسابه لهذا الطلب. عند الموافقة ينضم تلقائيًا للوكالة، وعند الرفض يُفك الحجز.',
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
