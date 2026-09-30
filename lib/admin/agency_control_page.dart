import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';
import 'agency_policy_control_page.dart';
import '../shared/widgets/country_selector.dart';

class AgencyControlPage extends StatefulWidget {
  const AgencyControlPage({super.key});

  @override
  State<AgencyControlPage> createState() => _AgencyControlPageState();
}

class _AgencyControlPageState extends State<AgencyControlPage> {
  bool loading = true;
  bool busy = false;
  bool canDirectCreate = false;
  bool canManageExisting = false;
  bool canTransferOwnership = false;
  bool canManagePolicies = false;
  bool canManageMemberships = false;
  bool canSuspendAgencies = false;
  bool canCloseAgencies = false;
  bool canSetApplicationHostCount = false;
  int applicationHostCount = 5;
  final TextEditingController agencyLookup = TextEditingController();
  Map<String, dynamic>? managedAgency;
  List<Map<String, dynamic>> applications = [];
  List<Map<String, dynamic>> manualBlocks = [];

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    agencyLookup.dispose();
    super.dispose();
  }

  String operationKey(String prefix) {
    final uid = controlAuth.currentUser?.uid ?? 'control';
    final safeUid = uid.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return '${prefix}_${safeUid}_${DateTime.now().microsecondsSinceEpoch}';
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final user = controlAuth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('empty_token');
    final response = await http
        .post(
          shadowApiEndpoint('agency-control'),
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer $token',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 25));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['ok'] != true) {
      throw StateError((body['code'] ?? 'request_failed').toString());
    }
    return body;
  }

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final body = await post({'action': 'listReviewQueue', 'limit': 50});
      final rows = body['applications'] is List
          ? (body['applications'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final blocks = body['manualBlocks'] is List
          ? (body['manualBlocks'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final permissions = body['permissions'] is Map
          ? Map<String, dynamic>.from(body['permissions'] as Map)
          : <String, dynamic>{};
      final applicationSettings = body['applicationSettings'] is Map
          ? Map<String, dynamic>.from(body['applicationSettings'] as Map)
          : <String, dynamic>{};
      final parsedHostCount =
          int.tryParse((applicationSettings['requiredHostCount'] ?? 5).toString()) ?? 5;
      if (!mounted) return;
      setState(() {
        applications = rows;
        manualBlocks = blocks;
        canDirectCreate = permissions['canDirectCreate'] == true;
        canManageExisting = permissions['canManageExisting'] == true;
        canTransferOwnership = permissions['canTransferOwnership'] == true;
        canManagePolicies = permissions['canManagePolicies'] == true;
        canManageMemberships = permissions['canManageMemberships'] == true;
        canSuspendAgencies = permissions['canSuspendAgencies'] == true;
        canCloseAgencies = permissions['canCloseAgencies'] == true;
        canSetApplicationHostCount =
            permissions['canSetApplicationHostCount'] == true;
        applicationHostCount = parsedHostCount.clamp(0, 30);
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تحميل طلبات الوكالات: $e')),
      );
    }
  }

  Future<void> saveApplicationHostCount(int value) async {
    if (busy || !canSetApplicationHostCount) return;
    final next = value.clamp(0, 30);
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'setApplicationHostCount',
        'requiredHostCount': next,
        'idempotencyKey': operationKey('agency_application_host_count'),
      });
      if (!mounted) return;
      setState(() {
        applicationHostCount =
            int.tryParse((body['requiredHostCount'] ?? next).toString()) ?? next;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            applicationHostCount == 0
                ? 'تم ضبط طلب إنشاء الوكالة بدون مضيفين.'
                : 'تم ضبط عدد المضيفين المطلوب على $applicationHostCount.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث عدد المضيفين: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> startReview(Map<String, dynamic> application) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await post({
        'action': 'startReview',
        'applicationId': (application['applicationId'] ?? '').toString(),
      });
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر بدء المراجعة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> approve(Map<String, dynamic> application) async {
    final agencyId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('الموافقة وإنشاء الوكالة'),
        content: TextField(
          controller: agencyId,
          keyboardType: TextInputType.number,
          maxLength: 8,
          decoration: const InputDecoration(
            labelText: 'Agency ID — اختياري',
            hintText: 'فارغ = توليد تلقائي من 6 أرقام',
            border: OutlineInputBorder(),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('موافقة'),
          ),
        ],
      ),
    );
    final chosenId = agencyId.text.trim();
    agencyId.dispose();
    if (accepted != true || busy) return;
    if (chosenId.isNotEmpty && !RegExp(r'^\d{3,8}$').hasMatch(chosenId)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Agency ID يجب أن يكون من 3 إلى 8 أرقام.')),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'approve',
        'applicationId': (application['applicationId'] ?? '').toString(),
        'agencyId': chosenId,
        'idempotencyKey': operationKey('agency_approve'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم إنشاء الوكالة — ID ${(body['agencyId'] ?? '').toString()}'),
        ),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر اعتماد الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> rejectApplication(Map<String, dynamic> application) async {
    final reason = TextEditingController();
    var selectedMode = 'immediate';
    final result = await showDialog<Map<String, String>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('رفض طلب إنشاء الوكالة'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: reason,
                  minLines: 2,
                  maxLines: 4,
                  maxLength: 500,
                  decoration: const InputDecoration(
                    labelText: 'سبب الرفض *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  initialValue: selectedMode,
                  decoration: const InputDecoration(
                    labelText: 'إعادة التقديم',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'immediate',
                      child: Text('فوري'),
                    ),
                    DropdownMenuItem(
                      value: '24h',
                      child: Text('بعد 24 ساعة'),
                    ),
                    DropdownMenuItem(
                      value: '3d',
                      child: Text('بعد 3 أيام'),
                    ),
                    DropdownMenuItem(
                      value: '7d',
                      child: Text('بعد 7 أيام'),
                    ),
                    DropdownMenuItem(
                      value: '30d',
                      child: Text('بعد 30 يوم'),
                    ),
                    DropdownMenuItem(
                      value: 'manual',
                      child: Text('منع حتى رفع الحظر يدويًا'),
                    ),
                  ],
                  onChanged: (value) {
                    if (value != null) {
                      setDialogState(() => selectedMode = value);
                    }
                  },
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final text = reason.text.trim();
                if (text.length < 3) return;
                Navigator.pop(dialogContext, {
                  'rejectionReason': text,
                  'reapplyMode': selectedMode,
                });
              },
              child: const Text('تأكيد الرفض'),
            ),
          ],
        ),
      ),
    );
    reason.dispose();
    if (result == null || busy) return;

    setState(() => busy = true);
    try {
      final response = await post({
        'action': 'reject',
        'applicationId': (application['applicationId'] ?? '').toString(),
        'rejectionReason': result['rejectionReason'],
        'reapplyMode': result['reapplyMode'],
        'idempotencyKey': operationKey('agency_reject'),
      });
      if (!mounted) return;
      final mode = (response['reapplyMode'] ?? '').toString();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم رفض الطلب — إعادة التقديم: $mode'),
        ),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر رفض الطلب: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> allowReapply(Map<String, dynamic> block) async {
    if (busy) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('السماح بإعادة التقديم'),
        content: Text(
          'رفع المنع اليدوي عن طلب ' +
              (block['name'] ?? '').toString() +
              '؟',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('رفع الحظر'),
          ),
        ],
      ),
    );
    if (confirmed != true || busy) return;
    setState(() => busy = true);
    try {
      await post({
        'action': 'allowReapply',
        'applicationId': (block['applicationId'] ?? '').toString(),
        'idempotencyKey': operationKey('agency_allow_reapply'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم السماح بإعادة التقديم فورًا.')),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر رفع منع إعادة التقديم: ' + e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> loadManagedAgency() async {
    if (busy || !canManageExisting) return;
    final agencyId = agencyLookup.text.trim();
    if (!RegExp(r'^\d{3,8}$').hasMatch(agencyId)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Agency ID يجب أن يكون من 3 إلى 8 أرقام.')),
      );
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({'action': 'getAgency', 'agencyId': agencyId});
      final agency = body['agency'] is Map
          ? Map<String, dynamic>.from(body['agency'] as Map)
          : <String, dynamic>{};
      final permissions = body['permissions'] is Map
          ? Map<String, dynamic>.from(body['permissions'] as Map)
          : <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        managedAgency = agency;
        canTransferOwnership = permissions['canTransferOwnership'] == true;
        canManagePolicies = permissions['canManagePolicies'] == true;
        canManageMemberships = permissions['canManageMemberships'] == true;
        canSuspendAgencies = permissions['canSuspendAgencies'] == true;
        canCloseAgencies = permissions['canCloseAgencies'] == true;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => managedAgency = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تحميل الوكالة: $e')),
      );
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> editManagedAgencyIdentity() async {
    final agency = managedAgency;
    if (agency == null || busy) return;
    final publicId = TextEditingController(
      text: (agency['publicId'] ?? agency['agencyId'] ?? '').toString(),
    );
    final name = TextEditingController(text: (agency['name'] ?? '').toString());
    var selectedCountry =
        shadowCountryByName((agency['country'] ?? '').toString());
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('تعديل بيانات الوكالة'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: publicId,
                  keyboardType: TextInputType.number,
                  maxLength: 8,
                  decoration: const InputDecoration(
                    labelText: 'Agency / Room ID *',
                    hintText: 'من 3 إلى 8 أرقام',
                  ),
                ),
                TextField(
                  controller: name,
                  maxLength: 80,
                  decoration:
                      const InputDecoration(labelText: 'اسم الوكالة *'),
                ),
                const SizedBox(height: 10),
                ShadowCountryField(
                  value: selectedCountry,
                  onChanged: (value) =>
                      setDialogState(() => selectedCountry = value),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
    final nextPublicId = publicId.text.trim();
    final nextName = name.text.trim();
    final nextCountry = selectedCountry?.nameAr ?? '';
    publicId.dispose();
    name.dispose();
    if (accepted != true || nextName.isEmpty || busy) return;
    if (!RegExp(r'^\d{3,8}() async {
    final agency = managedAgency;
    if (agency == null || busy || !canTransferOwnership) return;
    final publicId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('نقل ملكية الوكالة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'المالك الجديد يجب أن يكون عضوًا نشطًا في نفس الوكالة. '
              'المالك السابق يأخذ دور العضو الجديد السابق للمحافظة على العدادات.',
            ),
            TextField(
              controller: publicId,
              keyboardType: TextInputType.number,
              maxLength: 8,
              decoration:
                  const InputDecoration(labelText: 'Public ID للمالك الجديد'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('نقل الملكية'),
          ),
        ],
      ),
    );
    final nextOwner = publicId.text.trim();
    publicId.dispose();
    if (accepted != true ||
        !RegExp(r'^\d{3,8}$').hasMatch(nextOwner) ||
        busy) {
      return;
    }
    setState(() => busy = true);
    try {
      await post({
        'action': 'transferOwnership',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'newOwnerPublicId': nextOwner,
        'idempotencyKey': operationKey('agency_owner_transfer'),
      });
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم نقل ملكية الوكالة.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر نقل الملكية: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> changeManagedAgencyStatus(String status) async {
    final agency = managedAgency;
    if (agency == null || busy) return;
    final isClose = status == 'closed';
    final isResume = status == 'active';
    if (isClose ? !canCloseAgencies : !canSuspendAgencies) return;
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          isClose
              ? 'إغلاق الوكالة نهائيًا'
              : isResume
                  ? 'إعادة تفعيل الوكالة'
                  : 'تعليق الوكالة مؤقتًا',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isClose
                  ? 'الإغلاق دائم ومتاح للـOwner فقط. لن تُحذف البيانات أو الأرباح أو حقوق وسجل Hosts.'
                  : isResume
                      ? 'سيُعاد السماح بإدارة الوكالة وقبول Hosts جدد.'
                      : 'سيُوقف قبول Hosts جدد وتُقيّد الإدارة، مع الحفاظ على البيانات والأرباح والحقوق.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'السبب *',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () {
              if (reason.text.trim().length >= 3) Navigator.pop(context, true);
            },
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (accepted != true || text.length < 3 || busy) return;
    setState(() => busy = true);
    try {
      await post({
        'action': 'changeStatus',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'status': status,
        'reason': text,
        'idempotencyKey': operationKey('agency_status_$status'),
      });
      if (mounted) {
        setState(() {
          managedAgency = <String, dynamic>{...agency, 'status': status};
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(isClose
              ? 'تم إغلاق الوكالة نهائيًا.'
              : isResume
                  ? 'تمت إعادة تفعيل الوكالة.'
                  : 'تم تعليق الوكالة مؤقتًا.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تغيير حالة الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> directCreate() async {
    final name = TextEditingController();
    final ownerPublicId = TextEditingController();
    final agencyId = TextEditingController();
    ShadowCountryOption? selectedCountry;
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('إنشاء وكالة مباشرة'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: name,
                  decoration: const InputDecoration(
                    labelText: 'اسم الوكالة *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                ShadowCountryField(
                  value: selectedCountry,
                  onChanged: (value) =>
                      setDialogState(() => selectedCountry = value),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: ownerPublicId,
                  keyboardType: TextInputType.number,
                  maxLength: 8,
                  decoration: const InputDecoration(
                    labelText: 'Public ID لصاحب الوكالة *',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: agencyId,
                  keyboardType: TextInputType.number,
                  maxLength: 8,
                  decoration: const InputDecoration(
                    labelText: 'Agency ID — اختياري',
                    hintText: 'فارغ = توليد تلقائي فريد من 6 أرقام',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('إنشاء'),
            ),
          ],
        ),
      ),
    );
    final payload = {
      'name': name.text.trim(),
      'country': selectedCountry?.nameAr ?? '',
      'ownerPublicId': ownerPublicId.text.trim(),
      'agencyId': agencyId.text.trim(),
    };
    name.dispose();
    ownerPublicId.dispose();
    agencyId.dispose();
    if (accepted != true || busy) return;
    if ((payload['name'] ?? '').isEmpty ||
        !RegExp(r'^\d{3,8}
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الوكالات'),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      floatingActionButton: canDirectCreate
          ? FloatingActionButton.extended(
              onPressed: busy ? null : directCreate,
              icon: const Icon(Icons.add_business),
              label: const Text('إنشاء مباشر'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.security),
                      title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. الموافقة تنشئ Agency ID فريد وعضوية Owner فقط؛ الـ5 Hosts لا يُضافون تلقائيًا.',
                      ),
                    ),
                  ),
                  if (canManageExisting) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'إدارة وكالة موجودة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: agencyLookup,
                                    keyboardType: TextInputType.number,
                                    maxLength: 8,
                                    decoration: const InputDecoration(
                                      labelText: 'Agency ID',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(
                                  onPressed: busy ? null : loadManagedAgency,
                                  child: const Text('تحميل'),
                                ),
                              ],
                            ),
                            if (managedAgency case final agency?) ...[
                              const Divider(height: 24),
                              Text(
                                (agency['name'] ?? '').toString(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text('Agency / Room ID: ' +
                                  (agency['publicId'] ?? agency['agencyId'] ?? '').toString()),
                              Text('الدولة: ' +
                                  (agency['country'] ?? '—').toString()),
                              Text('الحالة: ' +
                                  (agency['status'] ?? '').toString()),
                              Text('Owner: ' +
                                  (agency['ownerPublicId'] ??
                                          agency['ownerUid'] ??
                                          '')
                                      .toString()),
                              Text(
                                'الأعضاء: ' +
                                    (agency['memberCount'] ?? 0).toString() +
                                    ' • Hosts: ' +
                                    (agency['hostCount'] ?? 0).toString() +
                                    ' • Managers: ' +
                                    (agency['managerCount'] ?? 0).toString() +
                                    ' • Senior: ' +
                                    (agency['seniorManagerCount'] ?? 0)
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : editManagedAgencyIdentity,
                                    icon: const Icon(Icons.edit_outlined),
                                    label: const Text('تعديل الاسم/الدولة'),
                                  ),
                                  if (canTransferOwnership)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : transferManagedAgencyOwnership,
                                      icon: const Icon(
                                        Icons.manage_accounts_outlined,
                                      ),
                                      label: const Text('نقل الملكية'),
                                    ),
                                  if (canManagePolicies ||
                                      canManageMemberships)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final id =
                                                  (agency['agencyId'] ?? '')
                                                      .toString();
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      AgencyPolicyControlPage(
                                                    agencyId: id,
                                                    canManagePolicies:
                                                        canManagePolicies,
                                                    canManageMemberships:
                                                        canManageMemberships,
                                                  ),
                                                ),
                                              );
                                            },
                                      icon: const Icon(
                                        Icons.tune_outlined,
                                      ),
                                      label: const Text(
                                        'السياسات والاستثناءات',
                                      ),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'active' &&
                                      canSuspendAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'suspended',
                                              ),
                                      icon: const Icon(Icons.pause_circle_outline),
                                      label: const Text('تعليق مؤقت'),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'suspended' &&
                                      canSuspendAgencies)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'active',
                                              ),
                                      icon: const Icon(Icons.play_circle_outline),
                                      label: const Text('إعادة التفعيل'),
                                    ),
                                  if ((agency['status'] ?? '').toString() !=
                                          'closed' &&
                                      canCloseAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'closed',
                                              ),
                                      icon: const Icon(Icons.block_outlined),
                                      label: const Text('إغلاق نهائي'),
                                    ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (applications.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.inbox_outlined),
                        title: Text('لا توجد طلبات بانتظار المراجعة'),
                      ),
                    ),
                  ...applications.map((application) {
                    final hostIds = application['hostIds'] is List
                        ? (application['hostIds'] as List)
                            .map((e) => e.toString())
                            .join('، ')
                        : '';
                    final status = (application['status'] ?? '').toString();
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              (application['name'] ?? '').toString(),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('الحالة: $status'),
                            Text(
                              'مقدم الطلب: ${(application['applicantPublicId'] ?? application['applicantUid'] ?? '').toString()}',
                            ),
                            if ((application['country'] ?? '').toString().isNotEmpty)
                              Text('الدولة: ${(application['country'] ?? '').toString()}'),
                            Text('Host IDs: $hostIds'),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (status == 'pending')
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => startReview(application),
                                    icon: const Icon(Icons.fact_check_outlined),
                                    label: const Text('بدء المراجعة'),
                                  ),
                                FilledButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => approve(application),
                                  icon: const Icon(Icons.check_circle_outline),
                                  label: const Text('موافقة وإنشاء'),
                                ),
                                OutlinedButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => rejectApplication(application),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: const Text('رفض'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  const Text(
                    'منع إعادة التقديم اليدوي',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (manualBlocks.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.lock_open_outlined),
                        title: Text('لا توجد طلبات محظورة يدويًا'),
                      ),
                    ),
                  ...manualBlocks.map(
                    (block) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text((block['name'] ?? '').toString()),
                        subtitle: Text(
                          'المستخدم: ' +
                              (block['applicantPublicId'] ??
                                      block['applicantUid'] ??
                                      '')
                                  .toString() +
                              '\nالسبب: ' +
                              (block['rejectionReason'] ?? '').toString(),
                        ),
                        isThreeLine: true,
                        trailing: FilledButton(
                          onPressed: busy ? null : () => allowReapply(block),
                          child: const Text('رفع الحظر'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
).hasMatch(nextPublicId)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Agency / Room ID يجب أن يكون من 3 إلى 8 أرقام.'),
          ),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'updateIdentity',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'publicId': nextPublicId,
        'name': nextName,
        'country': nextCountry,
        'idempotencyKey': operationKey('agency_identity'),
      });
      agencyLookup.text = (body['publicId'] ?? nextPublicId).toString();
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تحديث بيانات وAgency / Room ID للوكالة.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث بيانات الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> transferManagedAgencyOwnership() async {
    final agency = managedAgency;
    if (agency == null || busy || !canTransferOwnership) return;
    final publicId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('نقل ملكية الوكالة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'المالك الجديد يجب أن يكون عضوًا نشطًا في نفس الوكالة. '
              'المالك السابق يأخذ دور العضو الجديد السابق للمحافظة على العدادات.',
            ),
            TextField(
              controller: publicId,
              keyboardType: TextInputType.number,
              maxLength: 8,
              decoration:
                  const InputDecoration(labelText: 'Public ID للمالك الجديد'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('نقل الملكية'),
          ),
        ],
      ),
    );
    final nextOwner = publicId.text.trim();
    publicId.dispose();
    if (accepted != true ||
        !RegExp(r'^\d{3,8}$').hasMatch(nextOwner) ||
        busy) {
      return;
    }
    setState(() => busy = true);
    try {
      await post({
        'action': 'transferOwnership',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'newOwnerPublicId': nextOwner,
        'idempotencyKey': operationKey('agency_owner_transfer'),
      });
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم نقل ملكية الوكالة.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر نقل الملكية: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> changeManagedAgencyStatus(String status) async {
    final agency = managedAgency;
    if (agency == null || busy) return;
    final isClose = status == 'closed';
    final isResume = status == 'active';
    if (isClose ? !canCloseAgencies : !canSuspendAgencies) return;
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          isClose
              ? 'إغلاق الوكالة نهائيًا'
              : isResume
                  ? 'إعادة تفعيل الوكالة'
                  : 'تعليق الوكالة مؤقتًا',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isClose
                  ? 'الإغلاق دائم ومتاح للـOwner فقط. لن تُحذف البيانات أو الأرباح أو حقوق وسجل Hosts.'
                  : isResume
                      ? 'سيُعاد السماح بإدارة الوكالة وقبول Hosts جدد.'
                      : 'سيُوقف قبول Hosts جدد وتُقيّد الإدارة، مع الحفاظ على البيانات والأرباح والحقوق.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'السبب *',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () {
              if (reason.text.trim().length >= 3) Navigator.pop(context, true);
            },
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (accepted != true || text.length < 3 || busy) return;
    setState(() => busy = true);
    try {
      await post({
        'action': 'changeStatus',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'status': status,
        'reason': text,
        'idempotencyKey': operationKey('agency_status_$status'),
      });
      if (mounted) {
        setState(() {
          managedAgency = <String, dynamic>{...agency, 'status': status};
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(isClose
              ? 'تم إغلاق الوكالة نهائيًا.'
              : isResume
                  ? 'تمت إعادة تفعيل الوكالة.'
                  : 'تم تعليق الوكالة مؤقتًا.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تغيير حالة الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> directCreate() async {
    final name = TextEditingController();
    final country = TextEditingController();
    final ownerPublicId = TextEditingController();
    final agencyId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('إنشاء وكالة مباشرة'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(
                  labelText: 'اسم الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: country,
                decoration: const InputDecoration(
                  labelText: 'الدولة',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ownerPublicId,
                keyboardType: TextInputType.number,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: 'Public ID لصاحب الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: agencyId,
                keyboardType: TextInputType.number,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: 'Agency ID — اختياري',
                  hintText: 'فارغ = توليد تلقائي فريد من 6 أرقام',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('إنشاء'),
          ),
        ],
      ),
    );
    final payload = {
      'name': name.text.trim(),
      'country': country.text.trim(),
      'ownerPublicId': ownerPublicId.text.trim(),
      'agencyId': agencyId.text.trim(),
    };
    name.dispose();
    country.dispose();
    ownerPublicId.dispose();
    agencyId.dispose();
    if (accepted != true || busy) return;
    if ((payload['name'] ?? '').isEmpty ||
        !RegExp(r'^\d{3,8}$').hasMatch(payload['ownerPublicId'] ?? '') ||
        ((payload['agencyId'] ?? '').isNotEmpty &&
            !RegExp(r'^\d{3,8}$').hasMatch(payload['agencyId'] ?? ''))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تحقق من الاسم، User Public ID (3–8)، وAgency ID (3–8 أو فارغ للتوليد 6).')),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'directCreate',
        ...payload,
        'idempotencyKey': operationKey('agency_direct_create'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم إنشاء الوكالة مباشرة — ID ${(body['agencyId'] ?? '').toString()}'),
        ),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر إنشاء الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الوكالات'),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      floatingActionButton: canDirectCreate
          ? FloatingActionButton.extended(
              onPressed: busy ? null : directCreate,
              icon: const Icon(Icons.add_business),
              label: const Text('إنشاء مباشر'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.security),
                      title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. الموافقة تنشئ Agency ID فريد وعضوية Owner فقط؛ الـ5 Hosts لا يُضافون تلقائيًا.',
                      ),
                    ),
                  ),
                  if (canManageExisting) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'إدارة وكالة موجودة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: agencyLookup,
                                    keyboardType: TextInputType.number,
                                    maxLength: 8,
                                    decoration: const InputDecoration(
                                      labelText: 'Agency ID',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(
                                  onPressed: busy ? null : loadManagedAgency,
                                  child: const Text('تحميل'),
                                ),
                              ],
                            ),
                            if (managedAgency case final agency?) ...[
                              const Divider(height: 24),
                              Text(
                                (agency['name'] ?? '').toString(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text('Agency / Room ID: ' +
                                  (agency['publicId'] ?? agency['agencyId'] ?? '').toString()),
                              Text('الدولة: ' +
                                  (agency['country'] ?? '—').toString()),
                              Text('الحالة: ' +
                                  (agency['status'] ?? '').toString()),
                              Text('Owner: ' +
                                  (agency['ownerPublicId'] ??
                                          agency['ownerUid'] ??
                                          '')
                                      .toString()),
                              Text(
                                'الأعضاء: ' +
                                    (agency['memberCount'] ?? 0).toString() +
                                    ' • Hosts: ' +
                                    (agency['hostCount'] ?? 0).toString() +
                                    ' • Managers: ' +
                                    (agency['managerCount'] ?? 0).toString() +
                                    ' • Senior: ' +
                                    (agency['seniorManagerCount'] ?? 0)
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : editManagedAgencyIdentity,
                                    icon: const Icon(Icons.edit_outlined),
                                    label: const Text('تعديل الاسم/الدولة'),
                                  ),
                                  if (canTransferOwnership)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : transferManagedAgencyOwnership,
                                      icon: const Icon(
                                        Icons.manage_accounts_outlined,
                                      ),
                                      label: const Text('نقل الملكية'),
                                    ),
                                  if (canManagePolicies ||
                                      canManageMemberships)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final id =
                                                  (agency['agencyId'] ?? '')
                                                      .toString();
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      AgencyPolicyControlPage(
                                                    agencyId: id,
                                                    canManagePolicies:
                                                        canManagePolicies,
                                                    canManageMemberships:
                                                        canManageMemberships,
                                                  ),
                                                ),
                                              );
                                            },
                                      icon: const Icon(
                                        Icons.tune_outlined,
                                      ),
                                      label: const Text(
                                        'السياسات والاستثناءات',
                                      ),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'active' &&
                                      canSuspendAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'suspended',
                                              ),
                                      icon: const Icon(Icons.pause_circle_outline),
                                      label: const Text('تعليق مؤقت'),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'suspended' &&
                                      canSuspendAgencies)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'active',
                                              ),
                                      icon: const Icon(Icons.play_circle_outline),
                                      label: const Text('إعادة التفعيل'),
                                    ),
                                  if ((agency['status'] ?? '').toString() !=
                                          'closed' &&
                                      canCloseAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'closed',
                                              ),
                                      icon: const Icon(Icons.block_outlined),
                                      label: const Text('إغلاق نهائي'),
                                    ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (applications.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.inbox_outlined),
                        title: Text('لا توجد طلبات بانتظار المراجعة'),
                      ),
                    ),
                  ...applications.map((application) {
                    final hostIds = application['hostIds'] is List
                        ? (application['hostIds'] as List)
                            .map((e) => e.toString())
                            .join('، ')
                        : '';
                    final status = (application['status'] ?? '').toString();
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              (application['name'] ?? '').toString(),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('الحالة: $status'),
                            Text(
                              'مقدم الطلب: ${(application['applicantPublicId'] ?? application['applicantUid'] ?? '').toString()}',
                            ),
                            if ((application['country'] ?? '').toString().isNotEmpty)
                              Text('الدولة: ${(application['country'] ?? '').toString()}'),
                            Text('Host IDs: $hostIds'),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (status == 'pending')
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => startReview(application),
                                    icon: const Icon(Icons.fact_check_outlined),
                                    label: const Text('بدء المراجعة'),
                                  ),
                                FilledButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => approve(application),
                                  icon: const Icon(Icons.check_circle_outline),
                                  label: const Text('موافقة وإنشاء'),
                                ),
                                OutlinedButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => rejectApplication(application),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: const Text('رفض'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  const Text(
                    'منع إعادة التقديم اليدوي',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (manualBlocks.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.lock_open_outlined),
                        title: Text('لا توجد طلبات محظورة يدويًا'),
                      ),
                    ),
                  ...manualBlocks.map(
                    (block) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text((block['name'] ?? '').toString()),
                        subtitle: Text(
                          'المستخدم: ' +
                              (block['applicantPublicId'] ??
                                      block['applicantUid'] ??
                                      '')
                                  .toString() +
                              '\nالسبب: ' +
                              (block['rejectionReason'] ?? '').toString(),
                        ),
                        isThreeLine: true,
                        trailing: FilledButton(
                          onPressed: busy ? null : () => allowReapply(block),
                          child: const Text('رفع الحظر'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
).hasMatch(payload['ownerPublicId'] ?? '') ||
        ((payload['agencyId'] ?? '').isNotEmpty &&
            !RegExp(r'^\d{3,8}
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الوكالات'),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      floatingActionButton: canDirectCreate
          ? FloatingActionButton.extended(
              onPressed: busy ? null : directCreate,
              icon: const Icon(Icons.add_business),
              label: const Text('إنشاء مباشر'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.security),
                      title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. الموافقة تنشئ Agency ID فريد وعضوية Owner فقط؛ الـ5 Hosts لا يُضافون تلقائيًا.',
                      ),
                    ),
                  ),
                  if (canManageExisting) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'إدارة وكالة موجودة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: agencyLookup,
                                    keyboardType: TextInputType.number,
                                    maxLength: 8,
                                    decoration: const InputDecoration(
                                      labelText: 'Agency ID',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(
                                  onPressed: busy ? null : loadManagedAgency,
                                  child: const Text('تحميل'),
                                ),
                              ],
                            ),
                            if (managedAgency case final agency?) ...[
                              const Divider(height: 24),
                              Text(
                                (agency['name'] ?? '').toString(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text('Agency / Room ID: ' +
                                  (agency['publicId'] ?? agency['agencyId'] ?? '').toString()),
                              Text('الدولة: ' +
                                  (agency['country'] ?? '—').toString()),
                              Text('الحالة: ' +
                                  (agency['status'] ?? '').toString()),
                              Text('Owner: ' +
                                  (agency['ownerPublicId'] ??
                                          agency['ownerUid'] ??
                                          '')
                                      .toString()),
                              Text(
                                'الأعضاء: ' +
                                    (agency['memberCount'] ?? 0).toString() +
                                    ' • Hosts: ' +
                                    (agency['hostCount'] ?? 0).toString() +
                                    ' • Managers: ' +
                                    (agency['managerCount'] ?? 0).toString() +
                                    ' • Senior: ' +
                                    (agency['seniorManagerCount'] ?? 0)
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : editManagedAgencyIdentity,
                                    icon: const Icon(Icons.edit_outlined),
                                    label: const Text('تعديل الاسم/الدولة'),
                                  ),
                                  if (canTransferOwnership)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : transferManagedAgencyOwnership,
                                      icon: const Icon(
                                        Icons.manage_accounts_outlined,
                                      ),
                                      label: const Text('نقل الملكية'),
                                    ),
                                  if (canManagePolicies ||
                                      canManageMemberships)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final id =
                                                  (agency['agencyId'] ?? '')
                                                      .toString();
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      AgencyPolicyControlPage(
                                                    agencyId: id,
                                                    canManagePolicies:
                                                        canManagePolicies,
                                                    canManageMemberships:
                                                        canManageMemberships,
                                                  ),
                                                ),
                                              );
                                            },
                                      icon: const Icon(
                                        Icons.tune_outlined,
                                      ),
                                      label: const Text(
                                        'السياسات والاستثناءات',
                                      ),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'active' &&
                                      canSuspendAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'suspended',
                                              ),
                                      icon: const Icon(Icons.pause_circle_outline),
                                      label: const Text('تعليق مؤقت'),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'suspended' &&
                                      canSuspendAgencies)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'active',
                                              ),
                                      icon: const Icon(Icons.play_circle_outline),
                                      label: const Text('إعادة التفعيل'),
                                    ),
                                  if ((agency['status'] ?? '').toString() !=
                                          'closed' &&
                                      canCloseAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'closed',
                                              ),
                                      icon: const Icon(Icons.block_outlined),
                                      label: const Text('إغلاق نهائي'),
                                    ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (applications.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.inbox_outlined),
                        title: Text('لا توجد طلبات بانتظار المراجعة'),
                      ),
                    ),
                  ...applications.map((application) {
                    final hostIds = application['hostIds'] is List
                        ? (application['hostIds'] as List)
                            .map((e) => e.toString())
                            .join('، ')
                        : '';
                    final status = (application['status'] ?? '').toString();
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              (application['name'] ?? '').toString(),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('الحالة: $status'),
                            Text(
                              'مقدم الطلب: ${(application['applicantPublicId'] ?? application['applicantUid'] ?? '').toString()}',
                            ),
                            if ((application['country'] ?? '').toString().isNotEmpty)
                              Text('الدولة: ${(application['country'] ?? '').toString()}'),
                            Text('Host IDs: $hostIds'),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (status == 'pending')
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => startReview(application),
                                    icon: const Icon(Icons.fact_check_outlined),
                                    label: const Text('بدء المراجعة'),
                                  ),
                                FilledButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => approve(application),
                                  icon: const Icon(Icons.check_circle_outline),
                                  label: const Text('موافقة وإنشاء'),
                                ),
                                OutlinedButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => rejectApplication(application),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: const Text('رفض'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  const Text(
                    'منع إعادة التقديم اليدوي',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (manualBlocks.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.lock_open_outlined),
                        title: Text('لا توجد طلبات محظورة يدويًا'),
                      ),
                    ),
                  ...manualBlocks.map(
                    (block) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text((block['name'] ?? '').toString()),
                        subtitle: Text(
                          'المستخدم: ' +
                              (block['applicantPublicId'] ??
                                      block['applicantUid'] ??
                                      '')
                                  .toString() +
                              '\nالسبب: ' +
                              (block['rejectionReason'] ?? '').toString(),
                        ),
                        isThreeLine: true,
                        trailing: FilledButton(
                          onPressed: busy ? null : () => allowReapply(block),
                          child: const Text('رفع الحظر'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
).hasMatch(nextPublicId)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Agency / Room ID يجب أن يكون من 3 إلى 8 أرقام.'),
          ),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'updateIdentity',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'publicId': nextPublicId,
        'name': nextName,
        'country': nextCountry,
        'idempotencyKey': operationKey('agency_identity'),
      });
      agencyLookup.text = (body['publicId'] ?? nextPublicId).toString();
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تحديث بيانات وAgency / Room ID للوكالة.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث بيانات الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> transferManagedAgencyOwnership() async {
    final agency = managedAgency;
    if (agency == null || busy || !canTransferOwnership) return;
    final publicId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('نقل ملكية الوكالة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'المالك الجديد يجب أن يكون عضوًا نشطًا في نفس الوكالة. '
              'المالك السابق يأخذ دور العضو الجديد السابق للمحافظة على العدادات.',
            ),
            TextField(
              controller: publicId,
              keyboardType: TextInputType.number,
              maxLength: 8,
              decoration:
                  const InputDecoration(labelText: 'Public ID للمالك الجديد'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('نقل الملكية'),
          ),
        ],
      ),
    );
    final nextOwner = publicId.text.trim();
    publicId.dispose();
    if (accepted != true ||
        !RegExp(r'^\d{3,8}$').hasMatch(nextOwner) ||
        busy) {
      return;
    }
    setState(() => busy = true);
    try {
      await post({
        'action': 'transferOwnership',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'newOwnerPublicId': nextOwner,
        'idempotencyKey': operationKey('agency_owner_transfer'),
      });
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم نقل ملكية الوكالة.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر نقل الملكية: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> changeManagedAgencyStatus(String status) async {
    final agency = managedAgency;
    if (agency == null || busy) return;
    final isClose = status == 'closed';
    final isResume = status == 'active';
    if (isClose ? !canCloseAgencies : !canSuspendAgencies) return;
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          isClose
              ? 'إغلاق الوكالة نهائيًا'
              : isResume
                  ? 'إعادة تفعيل الوكالة'
                  : 'تعليق الوكالة مؤقتًا',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isClose
                  ? 'الإغلاق دائم ومتاح للـOwner فقط. لن تُحذف البيانات أو الأرباح أو حقوق وسجل Hosts.'
                  : isResume
                      ? 'سيُعاد السماح بإدارة الوكالة وقبول Hosts جدد.'
                      : 'سيُوقف قبول Hosts جدد وتُقيّد الإدارة، مع الحفاظ على البيانات والأرباح والحقوق.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'السبب *',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () {
              if (reason.text.trim().length >= 3) Navigator.pop(context, true);
            },
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (accepted != true || text.length < 3 || busy) return;
    setState(() => busy = true);
    try {
      await post({
        'action': 'changeStatus',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'status': status,
        'reason': text,
        'idempotencyKey': operationKey('agency_status_$status'),
      });
      if (mounted) {
        setState(() {
          managedAgency = <String, dynamic>{...agency, 'status': status};
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(isClose
              ? 'تم إغلاق الوكالة نهائيًا.'
              : isResume
                  ? 'تمت إعادة تفعيل الوكالة.'
                  : 'تم تعليق الوكالة مؤقتًا.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تغيير حالة الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> directCreate() async {
    final name = TextEditingController();
    final country = TextEditingController();
    final ownerPublicId = TextEditingController();
    final agencyId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('إنشاء وكالة مباشرة'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(
                  labelText: 'اسم الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: country,
                decoration: const InputDecoration(
                  labelText: 'الدولة',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ownerPublicId,
                keyboardType: TextInputType.number,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: 'Public ID لصاحب الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: agencyId,
                keyboardType: TextInputType.number,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: 'Agency ID — اختياري',
                  hintText: 'فارغ = توليد تلقائي فريد من 6 أرقام',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('إنشاء'),
          ),
        ],
      ),
    );
    final payload = {
      'name': name.text.trim(),
      'country': country.text.trim(),
      'ownerPublicId': ownerPublicId.text.trim(),
      'agencyId': agencyId.text.trim(),
    };
    name.dispose();
    country.dispose();
    ownerPublicId.dispose();
    agencyId.dispose();
    if (accepted != true || busy) return;
    if ((payload['name'] ?? '').isEmpty ||
        !RegExp(r'^\d{3,8}$').hasMatch(payload['ownerPublicId'] ?? '') ||
        ((payload['agencyId'] ?? '').isNotEmpty &&
            !RegExp(r'^\d{3,8}$').hasMatch(payload['agencyId'] ?? ''))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تحقق من الاسم، User Public ID (3–8)، وAgency ID (3–8 أو فارغ للتوليد 6).')),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'directCreate',
        ...payload,
        'idempotencyKey': operationKey('agency_direct_create'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم إنشاء الوكالة مباشرة — ID ${(body['agencyId'] ?? '').toString()}'),
        ),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر إنشاء الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الوكالات'),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      floatingActionButton: canDirectCreate
          ? FloatingActionButton.extended(
              onPressed: busy ? null : directCreate,
              icon: const Icon(Icons.add_business),
              label: const Text('إنشاء مباشر'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.security),
                      title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. الموافقة تنشئ Agency ID فريد وعضوية Owner فقط؛ الـ5 Hosts لا يُضافون تلقائيًا.',
                      ),
                    ),
                  ),
                  if (canManageExisting) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'إدارة وكالة موجودة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: agencyLookup,
                                    keyboardType: TextInputType.number,
                                    maxLength: 8,
                                    decoration: const InputDecoration(
                                      labelText: 'Agency ID',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(
                                  onPressed: busy ? null : loadManagedAgency,
                                  child: const Text('تحميل'),
                                ),
                              ],
                            ),
                            if (managedAgency case final agency?) ...[
                              const Divider(height: 24),
                              Text(
                                (agency['name'] ?? '').toString(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text('Agency / Room ID: ' +
                                  (agency['publicId'] ?? agency['agencyId'] ?? '').toString()),
                              Text('الدولة: ' +
                                  (agency['country'] ?? '—').toString()),
                              Text('الحالة: ' +
                                  (agency['status'] ?? '').toString()),
                              Text('Owner: ' +
                                  (agency['ownerPublicId'] ??
                                          agency['ownerUid'] ??
                                          '')
                                      .toString()),
                              Text(
                                'الأعضاء: ' +
                                    (agency['memberCount'] ?? 0).toString() +
                                    ' • Hosts: ' +
                                    (agency['hostCount'] ?? 0).toString() +
                                    ' • Managers: ' +
                                    (agency['managerCount'] ?? 0).toString() +
                                    ' • Senior: ' +
                                    (agency['seniorManagerCount'] ?? 0)
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : editManagedAgencyIdentity,
                                    icon: const Icon(Icons.edit_outlined),
                                    label: const Text('تعديل الاسم/الدولة'),
                                  ),
                                  if (canTransferOwnership)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : transferManagedAgencyOwnership,
                                      icon: const Icon(
                                        Icons.manage_accounts_outlined,
                                      ),
                                      label: const Text('نقل الملكية'),
                                    ),
                                  if (canManagePolicies ||
                                      canManageMemberships)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final id =
                                                  (agency['agencyId'] ?? '')
                                                      .toString();
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      AgencyPolicyControlPage(
                                                    agencyId: id,
                                                    canManagePolicies:
                                                        canManagePolicies,
                                                    canManageMemberships:
                                                        canManageMemberships,
                                                  ),
                                                ),
                                              );
                                            },
                                      icon: const Icon(
                                        Icons.tune_outlined,
                                      ),
                                      label: const Text(
                                        'السياسات والاستثناءات',
                                      ),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'active' &&
                                      canSuspendAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'suspended',
                                              ),
                                      icon: const Icon(Icons.pause_circle_outline),
                                      label: const Text('تعليق مؤقت'),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'suspended' &&
                                      canSuspendAgencies)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'active',
                                              ),
                                      icon: const Icon(Icons.play_circle_outline),
                                      label: const Text('إعادة التفعيل'),
                                    ),
                                  if ((agency['status'] ?? '').toString() !=
                                          'closed' &&
                                      canCloseAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'closed',
                                              ),
                                      icon: const Icon(Icons.block_outlined),
                                      label: const Text('إغلاق نهائي'),
                                    ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (applications.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.inbox_outlined),
                        title: Text('لا توجد طلبات بانتظار المراجعة'),
                      ),
                    ),
                  ...applications.map((application) {
                    final hostIds = application['hostIds'] is List
                        ? (application['hostIds'] as List)
                            .map((e) => e.toString())
                            .join('، ')
                        : '';
                    final status = (application['status'] ?? '').toString();
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              (application['name'] ?? '').toString(),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('الحالة: $status'),
                            Text(
                              'مقدم الطلب: ${(application['applicantPublicId'] ?? application['applicantUid'] ?? '').toString()}',
                            ),
                            if ((application['country'] ?? '').toString().isNotEmpty)
                              Text('الدولة: ${(application['country'] ?? '').toString()}'),
                            Text('Host IDs: $hostIds'),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (status == 'pending')
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => startReview(application),
                                    icon: const Icon(Icons.fact_check_outlined),
                                    label: const Text('بدء المراجعة'),
                                  ),
                                FilledButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => approve(application),
                                  icon: const Icon(Icons.check_circle_outline),
                                  label: const Text('موافقة وإنشاء'),
                                ),
                                OutlinedButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => rejectApplication(application),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: const Text('رفض'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  const Text(
                    'منع إعادة التقديم اليدوي',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (manualBlocks.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.lock_open_outlined),
                        title: Text('لا توجد طلبات محظورة يدويًا'),
                      ),
                    ),
                  ...manualBlocks.map(
                    (block) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text((block['name'] ?? '').toString()),
                        subtitle: Text(
                          'المستخدم: ' +
                              (block['applicantPublicId'] ??
                                      block['applicantUid'] ??
                                      '')
                                  .toString() +
                              '\nالسبب: ' +
                              (block['rejectionReason'] ?? '').toString(),
                        ),
                        isThreeLine: true,
                        trailing: FilledButton(
                          onPressed: busy ? null : () => allowReapply(block),
                          child: const Text('رفع الحظر'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
).hasMatch(payload['agencyId'] ?? ''))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text(
              'تحقق من الاسم، User Public ID (3–8)، وAgency ID (3–8 أو فارغ للتوليد 6).',
            ),
          ),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'directCreate',
        ...payload,
        'idempotencyKey': operationKey('agency_direct_create'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم إنشاء الوكالة مباشرة — ID ${(body['agencyId'] ?? '').toString()}',
          ),
        ),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر إنشاء الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الوكالات'),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      floatingActionButton: canDirectCreate
          ? FloatingActionButton.extended(
              onPressed: busy ? null : directCreate,
              icon: const Icon(Icons.add_business),
              label: const Text('إنشاء مباشر'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.security),
                      title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. الموافقة تنشئ Agency ID فريد وعضوية Owner فقط؛ الـ5 Hosts لا يُضافون تلقائيًا.',
                      ),
                    ),
                  ),
                  if (canManageExisting) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'إدارة وكالة موجودة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: agencyLookup,
                                    keyboardType: TextInputType.number,
                                    maxLength: 8,
                                    decoration: const InputDecoration(
                                      labelText: 'Agency ID',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(
                                  onPressed: busy ? null : loadManagedAgency,
                                  child: const Text('تحميل'),
                                ),
                              ],
                            ),
                            if (managedAgency case final agency?) ...[
                              const Divider(height: 24),
                              Text(
                                (agency['name'] ?? '').toString(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text('Agency / Room ID: ' +
                                  (agency['publicId'] ?? agency['agencyId'] ?? '').toString()),
                              Text('الدولة: ' +
                                  (agency['country'] ?? '—').toString()),
                              Text('الحالة: ' +
                                  (agency['status'] ?? '').toString()),
                              Text('Owner: ' +
                                  (agency['ownerPublicId'] ??
                                          agency['ownerUid'] ??
                                          '')
                                      .toString()),
                              Text(
                                'الأعضاء: ' +
                                    (agency['memberCount'] ?? 0).toString() +
                                    ' • Hosts: ' +
                                    (agency['hostCount'] ?? 0).toString() +
                                    ' • Managers: ' +
                                    (agency['managerCount'] ?? 0).toString() +
                                    ' • Senior: ' +
                                    (agency['seniorManagerCount'] ?? 0)
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : editManagedAgencyIdentity,
                                    icon: const Icon(Icons.edit_outlined),
                                    label: const Text('تعديل الاسم/الدولة'),
                                  ),
                                  if (canTransferOwnership)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : transferManagedAgencyOwnership,
                                      icon: const Icon(
                                        Icons.manage_accounts_outlined,
                                      ),
                                      label: const Text('نقل الملكية'),
                                    ),
                                  if (canManagePolicies ||
                                      canManageMemberships)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final id =
                                                  (agency['agencyId'] ?? '')
                                                      .toString();
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      AgencyPolicyControlPage(
                                                    agencyId: id,
                                                    canManagePolicies:
                                                        canManagePolicies,
                                                    canManageMemberships:
                                                        canManageMemberships,
                                                  ),
                                                ),
                                              );
                                            },
                                      icon: const Icon(
                                        Icons.tune_outlined,
                                      ),
                                      label: const Text(
                                        'السياسات والاستثناءات',
                                      ),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'active' &&
                                      canSuspendAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'suspended',
                                              ),
                                      icon: const Icon(Icons.pause_circle_outline),
                                      label: const Text('تعليق مؤقت'),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'suspended' &&
                                      canSuspendAgencies)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'active',
                                              ),
                                      icon: const Icon(Icons.play_circle_outline),
                                      label: const Text('إعادة التفعيل'),
                                    ),
                                  if ((agency['status'] ?? '').toString() !=
                                          'closed' &&
                                      canCloseAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'closed',
                                              ),
                                      icon: const Icon(Icons.block_outlined),
                                      label: const Text('إغلاق نهائي'),
                                    ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (applications.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.inbox_outlined),
                        title: Text('لا توجد طلبات بانتظار المراجعة'),
                      ),
                    ),
                  ...applications.map((application) {
                    final hostIds = application['hostIds'] is List
                        ? (application['hostIds'] as List)
                            .map((e) => e.toString())
                            .join('، ')
                        : '';
                    final status = (application['status'] ?? '').toString();
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              (application['name'] ?? '').toString(),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('الحالة: $status'),
                            Text(
                              'مقدم الطلب: ${(application['applicantPublicId'] ?? application['applicantUid'] ?? '').toString()}',
                            ),
                            if ((application['country'] ?? '').toString().isNotEmpty)
                              Text('الدولة: ${(application['country'] ?? '').toString()}'),
                            Text('Host IDs: $hostIds'),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (status == 'pending')
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => startReview(application),
                                    icon: const Icon(Icons.fact_check_outlined),
                                    label: const Text('بدء المراجعة'),
                                  ),
                                FilledButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => approve(application),
                                  icon: const Icon(Icons.check_circle_outline),
                                  label: const Text('موافقة وإنشاء'),
                                ),
                                OutlinedButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => rejectApplication(application),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: const Text('رفض'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  const Text(
                    'منع إعادة التقديم اليدوي',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (manualBlocks.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.lock_open_outlined),
                        title: Text('لا توجد طلبات محظورة يدويًا'),
                      ),
                    ),
                  ...manualBlocks.map(
                    (block) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text((block['name'] ?? '').toString()),
                        subtitle: Text(
                          'المستخدم: ' +
                              (block['applicantPublicId'] ??
                                      block['applicantUid'] ??
                                      '')
                                  .toString() +
                              '\nالسبب: ' +
                              (block['rejectionReason'] ?? '').toString(),
                        ),
                        isThreeLine: true,
                        trailing: FilledButton(
                          onPressed: busy ? null : () => allowReapply(block),
                          child: const Text('رفع الحظر'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
).hasMatch(nextPublicId)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Agency / Room ID يجب أن يكون من 3 إلى 8 أرقام.'),
          ),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'updateIdentity',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'publicId': nextPublicId,
        'name': nextName,
        'country': nextCountry,
        'idempotencyKey': operationKey('agency_identity'),
      });
      agencyLookup.text = (body['publicId'] ?? nextPublicId).toString();
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم تحديث بيانات وAgency / Room ID للوكالة.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث بيانات الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> transferManagedAgencyOwnership() async {
    final agency = managedAgency;
    if (agency == null || busy || !canTransferOwnership) return;
    final publicId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('نقل ملكية الوكالة'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'المالك الجديد يجب أن يكون عضوًا نشطًا في نفس الوكالة. '
              'المالك السابق يأخذ دور العضو الجديد السابق للمحافظة على العدادات.',
            ),
            TextField(
              controller: publicId,
              keyboardType: TextInputType.number,
              maxLength: 8,
              decoration:
                  const InputDecoration(labelText: 'Public ID للمالك الجديد'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('نقل الملكية'),
          ),
        ],
      ),
    );
    final nextOwner = publicId.text.trim();
    publicId.dispose();
    if (accepted != true ||
        !RegExp(r'^\d{3,8}$').hasMatch(nextOwner) ||
        busy) {
      return;
    }
    setState(() => busy = true);
    try {
      await post({
        'action': 'transferOwnership',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'newOwnerPublicId': nextOwner,
        'idempotencyKey': operationKey('agency_owner_transfer'),
      });
      await loadManagedAgency();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم نقل ملكية الوكالة.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر نقل الملكية: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> changeManagedAgencyStatus(String status) async {
    final agency = managedAgency;
    if (agency == null || busy) return;
    final isClose = status == 'closed';
    final isResume = status == 'active';
    if (isClose ? !canCloseAgencies : !canSuspendAgencies) return;
    final reason = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          isClose
              ? 'إغلاق الوكالة نهائيًا'
              : isResume
                  ? 'إعادة تفعيل الوكالة'
                  : 'تعليق الوكالة مؤقتًا',
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              isClose
                  ? 'الإغلاق دائم ومتاح للـOwner فقط. لن تُحذف البيانات أو الأرباح أو حقوق وسجل Hosts.'
                  : isResume
                      ? 'سيُعاد السماح بإدارة الوكالة وقبول Hosts جدد.'
                      : 'سيُوقف قبول Hosts جدد وتُقيّد الإدارة، مع الحفاظ على البيانات والأرباح والحقوق.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: reason,
              minLines: 2,
              maxLines: 4,
              maxLength: 500,
              decoration: const InputDecoration(
                labelText: 'السبب *',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () {
              if (reason.text.trim().length >= 3) Navigator.pop(context, true);
            },
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    final text = reason.text.trim();
    reason.dispose();
    if (accepted != true || text.length < 3 || busy) return;
    setState(() => busy = true);
    try {
      await post({
        'action': 'changeStatus',
        'agencyId': (agency['agencyId'] ?? '').toString(),
        'status': status,
        'reason': text,
        'idempotencyKey': operationKey('agency_status_$status'),
      });
      if (mounted) {
        setState(() {
          managedAgency = <String, dynamic>{...agency, 'status': status};
        });
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(isClose
              ? 'تم إغلاق الوكالة نهائيًا.'
              : isResume
                  ? 'تمت إعادة تفعيل الوكالة.'
                  : 'تم تعليق الوكالة مؤقتًا.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تغيير حالة الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> directCreate() async {
    final name = TextEditingController();
    final country = TextEditingController();
    final ownerPublicId = TextEditingController();
    final agencyId = TextEditingController();
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('إنشاء وكالة مباشرة'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: name,
                decoration: const InputDecoration(
                  labelText: 'اسم الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: country,
                decoration: const InputDecoration(
                  labelText: 'الدولة',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: ownerPublicId,
                keyboardType: TextInputType.number,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: 'Public ID لصاحب الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: agencyId,
                keyboardType: TextInputType.number,
                maxLength: 8,
                decoration: const InputDecoration(
                  labelText: 'Agency ID — اختياري',
                  hintText: 'فارغ = توليد تلقائي فريد من 6 أرقام',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('إنشاء'),
          ),
        ],
      ),
    );
    final payload = {
      'name': name.text.trim(),
      'country': country.text.trim(),
      'ownerPublicId': ownerPublicId.text.trim(),
      'agencyId': agencyId.text.trim(),
    };
    name.dispose();
    country.dispose();
    ownerPublicId.dispose();
    agencyId.dispose();
    if (accepted != true || busy) return;
    if ((payload['name'] ?? '').isEmpty ||
        !RegExp(r'^\d{3,8}$').hasMatch(payload['ownerPublicId'] ?? '') ||
        ((payload['agencyId'] ?? '').isNotEmpty &&
            !RegExp(r'^\d{3,8}$').hasMatch(payload['agencyId'] ?? ''))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تحقق من الاسم، User Public ID (3–8)، وAgency ID (3–8 أو فارغ للتوليد 6).')),
        );
      }
      return;
    }
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'directCreate',
        ...payload,
        'idempotencyKey': operationKey('agency_direct_create'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم إنشاء الوكالة مباشرة — ID ${(body['agencyId'] ?? '').toString()}'),
        ),
      );
      await load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر إنشاء الوكالة: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('الوكالات'),
        actions: [
          IconButton(
            onPressed: busy ? null : load,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      floatingActionButton: canDirectCreate
          ? FloatingActionButton.extended(
              onPressed: busy ? null : directCreate,
              icon: const Icon(Icons.add_business),
              label: const Text('إنشاء مباشر'),
            )
          : null,
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.security),
                      title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. الموافقة تنشئ Agency ID فريد وعضوية Owner فقط؛ الـ5 Hosts لا يُضافون تلقائيًا.',
                      ),
                    ),
                  ),
                  if (canManageExisting) ...[
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'إدارة وكالة موجودة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: TextField(
                                    controller: agencyLookup,
                                    keyboardType: TextInputType.number,
                                    maxLength: 8,
                                    decoration: const InputDecoration(
                                      labelText: 'Agency ID',
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                FilledButton(
                                  onPressed: busy ? null : loadManagedAgency,
                                  child: const Text('تحميل'),
                                ),
                              ],
                            ),
                            if (managedAgency case final agency?) ...[
                              const Divider(height: 24),
                              Text(
                                (agency['name'] ?? '').toString(),
                                style: const TextStyle(
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text('Agency / Room ID: ' +
                                  (agency['publicId'] ?? agency['agencyId'] ?? '').toString()),
                              Text('الدولة: ' +
                                  (agency['country'] ?? '—').toString()),
                              Text('الحالة: ' +
                                  (agency['status'] ?? '').toString()),
                              Text('Owner: ' +
                                  (agency['ownerPublicId'] ??
                                          agency['ownerUid'] ??
                                          '')
                                      .toString()),
                              Text(
                                'الأعضاء: ' +
                                    (agency['memberCount'] ?? 0).toString() +
                                    ' • Hosts: ' +
                                    (agency['hostCount'] ?? 0).toString() +
                                    ' • Managers: ' +
                                    (agency['managerCount'] ?? 0).toString() +
                                    ' • Senior: ' +
                                    (agency['seniorManagerCount'] ?? 0)
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : editManagedAgencyIdentity,
                                    icon: const Icon(Icons.edit_outlined),
                                    label: const Text('تعديل الاسم/الدولة'),
                                  ),
                                  if (canTransferOwnership)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : transferManagedAgencyOwnership,
                                      icon: const Icon(
                                        Icons.manage_accounts_outlined,
                                      ),
                                      label: const Text('نقل الملكية'),
                                    ),
                                  if (canManagePolicies ||
                                      canManageMemberships)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () {
                                              final id =
                                                  (agency['agencyId'] ?? '')
                                                      .toString();
                                              Navigator.of(context).push(
                                                MaterialPageRoute<void>(
                                                  builder: (_) =>
                                                      AgencyPolicyControlPage(
                                                    agencyId: id,
                                                    canManagePolicies:
                                                        canManagePolicies,
                                                    canManageMemberships:
                                                        canManageMemberships,
                                                  ),
                                                ),
                                              );
                                            },
                                      icon: const Icon(
                                        Icons.tune_outlined,
                                      ),
                                      label: const Text(
                                        'السياسات والاستثناءات',
                                      ),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'active' &&
                                      canSuspendAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'suspended',
                                              ),
                                      icon: const Icon(Icons.pause_circle_outline),
                                      label: const Text('تعليق مؤقت'),
                                    ),
                                  if ((agency['status'] ?? '').toString() ==
                                          'suspended' &&
                                      canSuspendAgencies)
                                    FilledButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'active',
                                              ),
                                      icon: const Icon(Icons.play_circle_outline),
                                      label: const Text('إعادة التفعيل'),
                                    ),
                                  if ((agency['status'] ?? '').toString() !=
                                          'closed' &&
                                      canCloseAgencies)
                                    OutlinedButton.icon(
                                      onPressed: busy
                                          ? null
                                          : () => changeManagedAgencyStatus(
                                                'closed',
                                              ),
                                      icon: const Icon(Icons.block_outlined),
                                      label: const Text('إغلاق نهائي'),
                                    ),
                                ],
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (applications.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.inbox_outlined),
                        title: Text('لا توجد طلبات بانتظار المراجعة'),
                      ),
                    ),
                  ...applications.map((application) {
                    final hostIds = application['hostIds'] is List
                        ? (application['hostIds'] as List)
                            .map((e) => e.toString())
                            .join('، ')
                        : '';
                    final status = (application['status'] ?? '').toString();
                    return Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              (application['name'] ?? '').toString(),
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            Text('الحالة: $status'),
                            Text(
                              'مقدم الطلب: ${(application['applicantPublicId'] ?? application['applicantUid'] ?? '').toString()}',
                            ),
                            if ((application['country'] ?? '').toString().isNotEmpty)
                              Text('الدولة: ${(application['country'] ?? '').toString()}'),
                            Text('Host IDs: $hostIds'),
                            const SizedBox(height: 12),
                            Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              children: [
                                if (status == 'pending')
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => startReview(application),
                                    icon: const Icon(Icons.fact_check_outlined),
                                    label: const Text('بدء المراجعة'),
                                  ),
                                FilledButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => approve(application),
                                  icon: const Icon(Icons.check_circle_outline),
                                  label: const Text('موافقة وإنشاء'),
                                ),
                                OutlinedButton.icon(
                                  onPressed: busy
                                      ? null
                                      : () => rejectApplication(application),
                                  icon: const Icon(Icons.cancel_outlined),
                                  label: const Text('رفض'),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 20),
                  const Text(
                    'منع إعادة التقديم اليدوي',
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (manualBlocks.isEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.lock_open_outlined),
                        title: Text('لا توجد طلبات محظورة يدويًا'),
                      ),
                    ),
                  ...manualBlocks.map(
                    (block) => Card(
                      child: ListTile(
                        leading: const Icon(Icons.lock_outline),
                        title: Text((block['name'] ?? '').toString()),
                        subtitle: Text(
                          'المستخدم: ' +
                              (block['applicantPublicId'] ??
                                      block['applicantUid'] ??
                                      '')
                                  .toString() +
                              '\nالسبب: ' +
                              (block['rejectionReason'] ?? '').toString(),
                        ),
                        isThreeLine: true,
                        trailing: FilledButton(
                          onPressed: busy ? null : () => allowReapply(block),
                          child: const Text('رفع الحظر'),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
