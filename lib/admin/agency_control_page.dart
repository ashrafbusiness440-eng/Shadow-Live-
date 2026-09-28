import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class AgencyControlPage extends StatefulWidget {
  const AgencyControlPage({super.key});

  @override
  State<AgencyControlPage> createState() => _AgencyControlPageState();
}

class _AgencyControlPageState extends State<AgencyControlPage> {
  bool loading = true;
  bool busy = false;
  bool canDirectCreate = false;
  List<Map<String, dynamic>> applications = [];

  @override
  void initState() {
    super.initState();
    load();
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
      final permissions = body['permissions'] is Map
          ? Map<String, dynamic>.from(body['permissions'] as Map)
          : <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        applications = rows;
        canDirectCreate = permissions['canDirectCreate'] == true;
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
          maxLength: 6,
          decoration: const InputDecoration(
            labelText: 'Agency ID — اختياري',
            hintText: 'اتركه فارغًا للتوليد التلقائي',
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
    if (chosenId.isNotEmpty && !RegExp(r'^\d{6}$').hasMatch(chosenId)) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Agency ID يجب أن يكون 6 أرقام.')),
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
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: 'Public ID لصاحب الوكالة *',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: agencyId,
                keyboardType: TextInputType.number,
                maxLength: 6,
                decoration: const InputDecoration(
                  labelText: 'Agency ID — اختياري',
                  hintText: 'فارغ = توليد تلقائي فريد',
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
        !RegExp(r'^\d{6}$').hasMatch(payload['ownerPublicId'] ?? '') ||
        ((payload['agencyId'] ?? '').isNotEmpty &&
            !RegExp(r'^\d{6}$').hasMatch(payload['agencyId'] ?? ''))) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تحقق من الاسم وPublic ID وAgency ID.')),
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
                  const SizedBox(height: 12),
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
                                const Tooltip(
                                  message: 'الرفض وخيارات إعادة التقديم في 03-C',
                                  child: Chip(label: Text('الرفض — 03-C')),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 90),
                ],
              ),
            ),
    );
  }
}
