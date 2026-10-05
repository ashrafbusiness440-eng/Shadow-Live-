import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';
import 'agency_policy_control_page.dart';
import 'agency_package_builder_page.dart';
import '../shared/widgets/country_selector.dart';
import '../features/profile/screens/public_profile_screen.dart';

class AgencyControlPage extends StatefulWidget {
  const AgencyControlPage({
    super.key,
    this.focusType,
    this.focusId,
  });

  final String? focusType;
  final String? focusId;

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
  bool canManageAgencyPackages = false;
  int applicationHostCount = 5;
  final TextEditingController agencyLookup = TextEditingController();
  Map<String, dynamic>? managedAgency;
  List<Map<String, dynamic>> applications = [];
  List<Map<String, dynamic>> manualBlocks = [];
  List<Map<String, dynamic>> ownershipTransferRequests = [];
  List<Map<String, dynamic>> identityChangeRequests = [];
  List<Map<String, dynamic>> cooldownExceptionRequests = [];

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

  List<Map<String, dynamic>> _prioritize(
    List<Map<String, dynamic>> items,
    String idField,
    String expectedType,
  ) {
    final focusId = widget.focusId?.trim() ?? '';
    if (focusId.isEmpty || widget.focusType != expectedType) return items;
    final sorted = [...items];
    sorted.sort((a, b) {
      final aMatch = (a[idField] ?? '').toString() == focusId;
      final bMatch = (b[idField] ?? '').toString() == focusId;
      if (aMatch == bMatch) return 0;
      return aMatch ? -1 : 1;
    });
    return sorted;
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
      final transfers = body['ownershipTransferRequests'] is List
          ? (body['ownershipTransferRequests'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final identityChanges = body['identityChangeRequests'] is List
          ? (body['identityChangeRequests'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final cooldownExceptions = body['cooldownExceptionRequests'] is List
          ? (body['cooldownExceptionRequests'] as List)
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
          int.tryParse((applicationSettings['requiredHostCount'] ?? 5).toString()) ??
              5;
      if (!mounted) return;
      setState(() {
        applications = _prioritize(
          rows,
          'applicationId',
          'agency_application',
        );
        manualBlocks = blocks;
        ownershipTransferRequests = _prioritize(
          transfers,
          'requestId',
          'agency_ownership_transfer',
        );
        identityChangeRequests = _prioritize(
          identityChanges,
          'requestId',
          'agency_identity_change',
        );
        cooldownExceptionRequests = _prioritize(
          cooldownExceptions,
          'requestId',
          'agency_cooldown_exception',
        );
        canDirectCreate = permissions['canDirectCreate'] == true;
        canManageExisting = permissions['canManageExisting'] == true;
        canTransferOwnership = permissions['canTransferOwnership'] == true;
        canManagePolicies = permissions['canManagePolicies'] == true;
        canManageMemberships = permissions['canManageMemberships'] == true;
        canSuspendAgencies = permissions['canSuspendAgencies'] == true;
        canCloseAgencies = permissions['canCloseAgencies'] == true;
        canSetApplicationHostCount =
            permissions['canSetApplicationHostCount'] == true;
        canManageAgencyPackages =
            permissions['canManageAgencyPackages'] == true;
        applicationHostCount = parsedHostCount.clamp(0, 30).toInt();
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
    final next = value.clamp(0, 30).toInt();
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

  String reviewAvailabilityLabel(String value) {
    switch (value) {
      case 'available':
        return 'متاح للوكالة';
      case 'agency_conflict':
        return 'مرتبط/محجوز بوكالة أخرى';
      case 'account_unavailable':
        return 'الحساب غير متاح';
      case 'not_found':
        return 'الحساب غير موجود';
      default:
        return 'غير معروف';
    }
  }

  Color reviewAvailabilityColor(String value) {
    switch (value) {
      case 'available':
        return Colors.green;
      case 'agency_conflict':
        return Colors.orange;
      case 'account_unavailable':
      case 'not_found':
        return Colors.redAccent;
      default:
        return Colors.grey;
    }
  }

  Widget reviewPersonCard(
    Map<String, dynamic> person, {
    required String title,
  }) {
    final uid = (person['uid'] ?? '').toString();
    final name = (person['displayName'] ?? 'مستخدم Shadow Live').toString();
    final publicId = (person['publicId'] ?? '—').toString();
    final imageUrl = (person['profileImageUrl'] ?? '').toString().trim();
    final accountStatus = (person['accountStatus'] ?? 'active').toString();
    final availability = (person['availability'] ?? '').toString();
    final availabilityText = reviewAvailabilityLabel(availability);
    final availabilityColor = reviewAvailabilityColor(availability);

    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            CircleAvatar(
              radius: 26,
              backgroundImage:
                  imageUrl.isEmpty ? null : NetworkImage(imageUrl),
              child: imageUrl.isEmpty
                  ? const Icon(Icons.person_outline)
                  : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: Colors.grey,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  Text(
                    'Public ID: ' + publicId,
                    textDirection: TextDirection.ltr,
                  ),
                  const SizedBox(height: 4),
                  Text('حالة الحساب: ' + accountStatus),
                  Text(
                    availabilityText,
                    style: TextStyle(
                      color: availabilityColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'فتح الملف الشخصي',
              onPressed: uid.isEmpty
                  ? null
                  : () {
                      Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => PublicProfileScreen(userId: uid),
                        ),
                      );
                    },
              icon: const Icon(Icons.open_in_new_rounded),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> showReviewDetails(Map<String, dynamic> details) async {
    if (!mounted) return;
    final application = details['application'] is Map
        ? Map<String, dynamic>.from(details['application'] as Map)
        : <String, dynamic>{};
    final applicant = details['applicant'] is Map
        ? Map<String, dynamic>.from(details['applicant'] as Map)
        : <String, dynamic>{};
    final hosts = details['hosts'] is List
        ? (details['hosts'] as List)
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .toList(growable: false)
        : <Map<String, dynamic>>[];

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (sheetContext) => SafeArea(
        child: FractionallySizedBox(
          heightFactor: .88,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'تفاصيل مراجعة طلب الوكالة',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(sheetContext),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                (application['name'] ?? '').toString(),
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
              if ((application['country'] ?? '').toString().isNotEmpty)
                Text(
                  'الدولة: ' +
                      (application['country'] ?? '').toString(),
                ),
              Text(
                'الحالة: ' +
                    (application['status'] ?? '').toString(),
              ),
              const SizedBox(height: 14),
              reviewPersonCard(
                applicant,
                title: 'مقدم الطلب',
              ),
              if (hosts.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  'المضيفون (' + hosts.length.toString() + ')',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 8),
                for (var index = 0; index < hosts.length; index += 1)
                  reviewPersonCard(
                    hosts[index],
                    title: 'Host ' + (index + 1).toString(),
                  ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Future<void> startReview(Map<String, dynamic> application) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'startReview',
        'applicationId': (application['applicationId'] ?? '').toString(),
      });
      final details = body['details'];
      if (details is Map && mounted) {
        await showReviewDetails(Map<String, dynamic>.from(details));
      }
      if (mounted) await load();
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

  Future<void> openReviewDetails(
    Map<String, dynamic> application,
  ) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      final body = await post({
        'action': 'reviewDetails',
        'applicationId': (application['applicationId'] ?? '').toString(),
      });
      final details = body['details'];
      if (details is Map && mounted) {
        await showReviewDetails(Map<String, dynamic>.from(details));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحميل تفاصيل المراجعة: $e')),
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
    ShadowCountryOption? selectedCountry =
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
    if (!RegExp(r'^\d{3,8}$').hasMatch(nextPublicId)) {
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


  Future<void> reviewIdentityChange(
    Map<String, dynamic> request,
    String decision,
  ) async {
    if (busy || !canManageExisting) return;
    String? reason;
    if (decision == 'reject') {
      final controller = TextEditingController();
      final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('رفض طلب تغيير بيانات الوكالة'),
          content: TextField(
            controller: controller,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'سبب الرفض *',
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
              child: const Text('رفض'),
            ),
          ],
        ),
      );
      reason = controller.text.trim();
      controller.dispose();
      if (accepted != true || reason.length < 3) return;
    } else {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('اعتماد تغيير بيانات الوكالة'),
          content: Text(
            'الحالي: ${(request['currentName'] ?? '').toString()}'
            '\nالمقترح: ${(request['requestedName'] ?? '').toString()}'
            '\nالدولة: ${(request['requestedCountry'] ?? '—').toString()}',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('موافقة'),
            ),
          ],
        ),
      );
      if (accepted != true) return;
    }

    setState(() => busy = true);
    try {
      await post({
        'action': 'reviewIdentityChange',
        'requestId': (request['requestId'] ?? '').toString(),
        'decision': decision,
        if (reason != null) 'reason': reason,
        'idempotencyKey': operationKey(
          decision == 'accept'
              ? 'agency_identity_change_accept'
              : 'agency_identity_change_reject',
        ),
      });
      await load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            decision == 'accept'
                ? 'تم اعتماد تغيير اسم/دولة الوكالة.'
                : 'تم رفض طلب تغيير اسم/دولة الوكالة.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر معالجة طلب تغيير البيانات: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> reviewOwnershipTransfer(
    Map<String, dynamic> request,
    String decision,
  ) async {
    if (busy || !canTransferOwnership) return;
    String? reason;
    if (decision == 'reject') {
      final controller = TextEditingController();
      final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('رفض طلب نقل الملكية'),
          content: TextField(
            controller: controller,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'سبب الرفض *',
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
              child: const Text('رفض'),
            ),
          ],
        ),
      );
      reason = controller.text.trim();
      controller.dispose();
      if (accepted != true || reason.length < 3) return;
    } else {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('اعتماد نقل ملكية الوكالة'),
          content: Text(
            'سيتم نقل الملكية إلى Public ID ${(request['newOwnerPublicId'] ?? '').toString()} مع تبديل الأدوار والعدادات بشكل ذري.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('موافقة'),
            ),
          ],
        ),
      );
      if (accepted != true) return;
    }

    setState(() => busy = true);
    try {
      await post({
        'action': 'reviewOwnershipTransfer',
        'requestId': (request['requestId'] ?? '').toString(),
        'decision': decision,
        if (reason != null) 'reason': reason,
        'idempotencyKey': operationKey(
          decision == 'accept'
              ? 'agency_owner_transfer_accept'
              : 'agency_owner_transfer_reject',
        ),
      });
      await load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            decision == 'accept'
                ? 'تم اعتماد نقل ملكية الوكالة.'
                : 'تم رفض طلب نقل ملكية الوكالة.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر معالجة طلب نقل الملكية: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> reviewCooldownException(
    Map<String, dynamic> request,
    String decision,
  ) async {
    if (busy || !canManageMemberships) return;
    String? reason;
    if (decision == 'reject') {
      final controller = TextEditingController();
      final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('رفض طلب استثناء فترة الانتظار'),
          content: TextField(
            controller: controller,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: const InputDecoration(
              labelText: 'سبب الرفض *',
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
              child: const Text('رفض'),
            ),
          ],
        ),
      );
      reason = controller.text.trim();
      controller.dispose();
      if (accepted != true || reason.length < 3) return;
    } else {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('الموافقة على استثناء الانتظار'),
          content: const Text(
            'سيتم رفع انتظار 7 أيام فورًا لهذا المستخدم، ويمكنه بعدها الانضمام إلى وكالة حسب الشروط العادية.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('موافقة'),
            ),
          ],
        ),
      );
      if (accepted != true) return;
    }

    setState(() => busy = true);
    try {
      await post({
        'action': 'reviewCooldownException',
        'requestId': (request['requestId'] ?? '').toString(),
        'decision': decision,
        if (reason != null) 'reason': reason,
        'idempotencyKey': operationKey(
          decision == 'accept'
              ? 'agency_cooldown_exception_accept'
              : 'agency_cooldown_exception_reject',
        ),
      });
      await load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            decision == 'accept'
                ? 'تم رفع فترة الانتظار.'
                : 'تم رفض طلب الاستثناء.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر معالجة طلب الاستثناء: $e')),
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
        !RegExp(r'^\d{3,8}$').hasMatch(payload['ownerPublicId'] ?? '') ||
        ((payload['agencyId'] ?? '').isNotEmpty &&
            !RegExp(r'^\d{3,8}$').hasMatch(payload['agencyId'] ?? ''))) {
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
                  if (canManageAgencyPackages) ...[
                    Card(
                      child: ListTile(
                        leading: const Icon(Icons.inventory_2_outlined),
                        title: const Text('Agency Package Builder'),
                        subtitle: const Text(
                          'إنشاء، تعديل، نسخ، معاينة وأرشفة حتى 100 باكيج من أصول Shadow Live الحالية.',
                        ),
                        trailing: const Icon(Icons.chevron_left_rounded),
                        onTap: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const AgencyPackageBuilderPage(),
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                  ],
                  if (canManageExisting || canDirectCreate || applications.isNotEmpty)
                    const Card(
                      child: ListTile(
                        leading: Icon(Icons.security),
                        title: Text('طلبات إنشاء الوكالات'),
                      subtitle: Text(
                        'القائمة محدودة Server-side. عند الموافقة تُنشأ الوكالة ويُضاف كل Host محجوز تلقائيًا كعضو Host.',
                      ),
                    ),
                  ),
                  if (canSetApplicationHostCount) ...[
                    const SizedBox(height: 12),
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'عدد المضيفين في طلب إنشاء الوكالة',
                              style: TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 6),
                            const Text(
                              'يمكن ضبط العدد من 0 إلى 30. التغيير يطبق على الطلبات الجديدة؛ الطلب الذي بدأ حجز مضيفيه يحتفظ بعدده.',
                            ),
                            const SizedBox(height: 12),
                            DropdownButtonFormField<int>(
                              initialValue: applicationHostCount,
                              decoration: const InputDecoration(
                                labelText: 'عدد المضيفين المطلوب',
                                border: OutlineInputBorder(),
                              ),
                              items: [
                                for (var value = 0; value <= 30; value += 1)
                                  DropdownMenuItem<int>(
                                    value: value,
                                    child: Text(
                                      value == 0
                                          ? '0 — بدون مضيفين'
                                          : value.toString(),
                                    ),
                                  ),
                              ],
                              onChanged: busy
                                  ? null
                                  : (value) {
                                      if (value != null) {
                                        saveApplicationHostCount(value);
                                      }
                                    },
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
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
                                if (status == 'under_review')
                                  OutlinedButton.icon(
                                    key: ValueKey(
                                      'agency-review-details-' +
                                          (application['applicationId'] ?? '')
                                              .toString(),
                                    ),
                                    onPressed: busy
                                        ? null
                                        : () => openReviewDetails(application),
                                    icon: const Icon(Icons.badge_outlined),
                                    label: const Text('تفاصيل المراجعة'),
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
                  if (canManageExisting) ...[
                    const SizedBox(height: 20),
                    const Text(
                      'طلبات تغيير اسم/دولة الوكالات',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (identityChangeRequests.isEmpty)
                      const Card(
                        child: ListTile(
                          leading: Icon(Icons.edit_location_alt_outlined),
                          title: Text('لا توجد طلبات تغيير بيانات معلّقة'),
                        ),
                      ),
                    ...identityChangeRequests.map(
                      (request) => Card(
                        key: ValueKey(
                          'agency-identity-change-' +
                              (request['requestId'] ?? '').toString(),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                'Agency ID: ' +
                                    (request['agencyId'] ?? '').toString(),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'الحالي: ' +
                                    (request['currentName'] ?? '').toString() +
                                    ' • ' +
                                    (request['currentCountry'] ?? '—')
                                        .toString(),
                              ),
                              Text(
                                'المقترح: ' +
                                    (request['requestedName'] ?? '').toString() +
                                    ' • ' +
                                    (request['requestedCountry'] ?? '—')
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  FilledButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => reviewIdentityChange(
                                              request,
                                              'accept',
                                            ),
                                    icon: const Icon(
                                      Icons.check_circle_outline,
                                    ),
                                    label: const Text('موافقة'),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => reviewIdentityChange(
                                              request,
                                              'reject',
                                            ),
                                    icon: const Icon(Icons.cancel_outlined),
                                    label: const Text('رفض'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                  if (canManageMemberships) ...[
                    const SizedBox(height: 20),
                    const Text(
                      'طلبات استثناء انتظار 7 أيام',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (cooldownExceptionRequests.isEmpty)
                      const Card(
                        child: ListTile(
                          leading: Icon(Icons.hourglass_disabled_rounded),
                          title: Text('لا توجد طلبات استثناء معلّقة'),
                        ),
                      ),
                    ...cooldownExceptionRequests.map(
                      (request) => Card(
                        key: ValueKey(
                          'agency-cooldown-exception-' +
                              (request['requestId'] ?? '').toString(),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                'User: ' +
                                    (request['uid'] ?? '').toString(),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if ((request['agencyId'] ?? '')
                                  .toString()
                                  .isNotEmpty)
                                Text(
                                  'الوكالة السابقة: ' +
                                      (request['agencyId'] ?? '').toString(),
                                ),
                              Text(
                                'السبب: ' +
                                    (request['reason'] ?? '—').toString(),
                              ),
                              Text(
                                'الانتظار حتى: ' +
                                    (request['cooldownUntil'] ?? '—')
                                        .toString(),
                              ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  FilledButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => reviewCooldownException(
                                              request,
                                              'accept',
                                            ),
                                    icon: const Icon(
                                      Icons.check_circle_outline,
                                    ),
                                    label: const Text('موافقة'),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => reviewCooldownException(
                                              request,
                                              'reject',
                                            ),
                                    icon: const Icon(Icons.cancel_outlined),
                                    label: const Text('رفض'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                  if (canTransferOwnership) ...[
                    const SizedBox(height: 20),
                    const Text(
                      'طلبات نقل ملكية الوكالات',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 8),
                    if (ownershipTransferRequests.isEmpty)
                      const Card(
                        child: ListTile(
                          leading: Icon(Icons.manage_accounts_outlined),
                          title: Text('لا توجد طلبات نقل ملكية معلّقة'),
                        ),
                      ),
                    ...ownershipTransferRequests.map(
                      (request) => Card(
                        key: ValueKey(
                          'agency-ownership-transfer-' +
                              (request['requestId'] ?? '').toString(),
                        ),
                        child: Padding(
                          padding: const EdgeInsets.all(12),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              Text(
                                'Agency ID: ' +
                                    (request['agencyId'] ?? '').toString(),
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'المالك المقترح: ' +
                                    (request['newOwnerDisplayName'] ??
                                            request['newOwnerPublicId'] ??
                                            '')
                                        .toString(),
                              ),
                              Text(
                                'Public ID: ' +
                                    (request['newOwnerPublicId'] ?? '')
                                        .toString(),
                                textDirection: TextDirection.ltr,
                              ),
                              if ((request['previousNewOwnerRole'] ?? '')
                                  .toString()
                                  .isNotEmpty)
                                Text(
                                  'دوره الحالي: ' +
                                      (request['previousNewOwnerRole'] ?? '')
                                          .toString(),
                                ),
                              const SizedBox(height: 10),
                              Wrap(
                                spacing: 8,
                                runSpacing: 8,
                                children: [
                                  FilledButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => reviewOwnershipTransfer(
                                              request,
                                              'accept',
                                            ),
                                    icon: const Icon(
                                      Icons.check_circle_outline,
                                    ),
                                    label: const Text('موافقة'),
                                  ),
                                  OutlinedButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => reviewOwnershipTransfer(
                                              request,
                                              'reject',
                                            ),
                                    icon: const Icon(Icons.cancel_outlined),
                                    label: const Text('رفض'),
                                  ),
                                ],
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
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
