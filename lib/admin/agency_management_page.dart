import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class AgencyManagementPage extends StatefulWidget {
  const AgencyManagementPage({super.key});

  @override
  State<AgencyManagementPage> createState() => _AgencyManagementPageState();
}

class _AgencyManagementPageState extends State<AgencyManagementPage> {
  final agencyId = TextEditingController();
  bool loading = false;
  bool busy = false;
  Map<String, dynamic>? data;

  @override
  void dispose() {
    agencyId.dispose();
    super.dispose();
  }

  String operationKey(String prefix) {
    final uid = controlAuth.currentUser?.uid ?? 'control';
    final safeUid = uid.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return prefix +
        '_' +
        safeUid +
        '_' +
        DateTime.now().microsecondsSinceEpoch.toString();
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final user = controlAuth.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('empty_token');
    final response = await http
        .post(
          shadowApiEndpoint('agency-membership'),
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + token,
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

  String roleLabel(String role) {
    switch (role) {
      case 'owner':
        return 'صاحب الوكالة';
      case 'senior_manager':
        return 'مدير أول';
      case 'manager':
        return 'مدير';
      default:
        return 'مضيف';
    }
  }

  String permissionSummary(Map<String, dynamic> row) {
    final values = <String>[];
    if (row['canReviewMembershipRequests'] == true) {
      values.add('مراجعة طلبات الانضمام');
    }
    if (row['canManageInvites'] == true) values.add('إدارة الدعوات');
    if (row['canManageRooms'] == true) values.add('إدارة الغرف');
    if (row['canManageManagers'] == true) values.add('إدارة المديرين');
    if (row['canViewAgencyFinance'] == true) values.add('مالية الوكالة');
    if (row['canViewOwnProgress'] == true) values.add('التقدم الشخصي');
    return values.isEmpty
        ? 'بدون صلاحيات تشغيلية إضافية'
        : values.join(' • ');
  }

  Future<void> loadAgency() async {
    final value = agencyId.text.trim();
    if (!RegExp(r'^\d{3,8}$').hasMatch(value)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Agency ID يجب أن يكون من 3 إلى 8 أرقام.')),
      );
      return;
    }
    if (loading || busy) return;
    setState(() => loading = true);
    try {
      final result = await post({
        'action': 'listAgencyMembers',
        'agencyId': value,
        'limit': 50,
      });
      if (!mounted) return;
      setState(() => data = result);
    } catch (e) {
      if (!mounted) return;
      setState(() => data = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تحميل أعضاء الوكالة: ' + e.toString())),
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> changeRole(
    Map<String, dynamic> member,
    String targetRole,
  ) async {
    final body = data;
    if (body == null || busy) return;
    final agency = body['agency'] is Map
        ? Map<String, dynamic>.from(body['agency'] as Map)
        : <String, dynamic>{};
    final value = (agency['agencyId'] ?? '').toString();
    final uid = (member['uid'] ?? '').toString();
    final currentRole = (member['role'] ?? '').toString();
    if (value.isEmpty ||
        uid.isEmpty ||
        currentRole == 'owner' ||
        currentRole == targetRole) {
      return;
    }

    final label =
        (member['displayName'] ?? member['publicId'] ?? uid).toString();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('تغيير دور عضو الوكالة'),
        content: Text(
          'العضو: ' +
              label +
              '\nمن: ' +
              roleLabel(currentRole) +
              '\nإلى: ' +
              roleLabel(targetRole),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('تأكيد'),
          ),
        ],
      ),
    );
    if (confirmed != true || busy) return;

    setState(() => busy = true);
    try {
      await post({
        'action': 'setManagerRole',
        'agencyId': value,
        'targetUid': uid,
        'targetRole': targetRole,
        'idempotencyKey': operationKey('agency_manager_role'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('تم تحديث الدور إلى ' + roleLabel(targetRole) + '.'),
        ),
      );
      await loadAgency();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحديث دور العضو: ' + e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final body = data;
    final agency = body?['agency'] is Map
        ? Map<String, dynamic>.from(body!['agency'] as Map)
        : <String, dynamic>{};
    final slots = body?['managerSlots'] is Map
        ? Map<String, dynamic>.from(body!['managerSlots'] as Map)
        : <String, dynamic>{};
    final permissions = body?['permissions'] is Map
        ? Map<String, dynamic>.from(body!['permissions'] as Map)
        : <String, dynamic>{};
    final members = body?['members'] is List
        ? (body!['members'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    final matrix = body?['roleMatrix'] is List
        ? (body!['roleMatrix'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
        : <Map<String, dynamic>>[];
    final canManageManagers = permissions['canManageManagers'] == true;
    final managerUids = slots['managerUids'] is List
        ? (slots['managerUids'] as List)
        : const <dynamic>[];

    return Scaffold(
      appBar: AppBar(
        title: const Text('إدارة أعضاء الوكالات'),
        actions: [
          IconButton(
            onPressed: loading || busy ? null : loadAgency,
            icon: const Icon(Icons.refresh),
            tooltip: 'تحديث',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Card(
            child: ListTile(
              leading: Icon(Icons.security_outlined),
              title: Text('إدارة محدودة حسب الدور والصلاحية'),
              subtitle: Text(
                'عرض حتى 50 عضوًا نشطًا. تغيير المديرين مسموح فقط لصاحب الوكالة أو Shadow Control بصلاحية manageAgencyManagers.',
              ),
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: agencyId,
            keyboardType: TextInputType.number,
            maxLength: 8,
            decoration: const InputDecoration(
              labelText: 'Agency ID',
              hintText: 'من 3 إلى 8 أرقام',
              border: OutlineInputBorder(),
              prefixIcon: Icon(Icons.apartment_outlined),
            ),
            onSubmitted: (_) => loadAgency(),
          ),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: loading || busy ? null : loadAgency,
            icon: loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.groups_outlined),
            label: Text(loading ? 'جار التحميل...' : 'عرض أعضاء الوكالة'),
          ),
          if (body != null) ...[
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.apartment),
                title: Text(
                  (agency['name'] ?? 'وكالة').toString() +
                      ' — ' +
                      (agency['agencyId'] ?? '').toString(),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                subtitle: Text(
                  'الأعضاء: ' +
                      (agency['memberCount'] ?? 0).toString() +
                      ' • المضيفون: ' +
                      (agency['hostCount'] ?? 0).toString() +
                      ' • المديرون: ' +
                      (agency['managerCount'] ?? 0).toString() +
                      ' • المدير الأول: ' +
                      (agency['seniorManagerCount'] ?? 0).toString(),
                ),
              ),
            ),
            Card(
              child: ListTile(
                leading: const Icon(Icons.admin_panel_settings_outlined),
                title: const Text('مقاعد الإدارة'),
                subtitle: Text(
                  'مدير أول: ' +
                      (slots['seniorManagerUid'] == null ? 'فارغ' : 'مشغول') +
                      ' • المديرون: ' +
                      managerUids.length.toString() +
                      '/' +
                      (slots['managerLimit'] ?? 2).toString(),
                ),
              ),
            ),
            if (body['truncated'] == true)
              const Card(
                child: ListTile(
                  leading: Icon(Icons.info_outline),
                  title: Text('تم عرض أول 50 عضوًا نشطًا فقط'),
                  subtitle: Text(
                    'الحد Server-side مقصود لحماية الضغط ومنع القراءة غير المحدودة.',
                  ),
                ),
              ),
            const SizedBox(height: 8),
            ...members.map((member) {
              final role = (member['role'] ?? 'host').toString();
              final publicId =
                  (member['publicId'] ?? member['uid'] ?? '').toString();
              final displayName =
                  (member['displayName'] ?? 'مستخدم').toString();
              return Card(
                child: ListTile(
                  leading: CircleAvatar(
                    child: Text(
                      role == 'owner'
                          ? 'O'
                          : role == 'senior_manager'
                              ? 'S'
                              : role == 'manager'
                                  ? 'M'
                                  : 'H',
                    ),
                  ),
                  title: Text(
                    displayName,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Text(
                    'ID: ' +
                        publicId +
                        '\nالدور: ' +
                        roleLabel(role),
                  ),
                  isThreeLine: true,
                  trailing: canManageManagers && role != 'owner'
                      ? PopupMenuButton<String>(
                          tooltip: 'تغيير الدور',
                          onSelected: (value) => changeRole(member, value),
                          itemBuilder: (context) => const [
                            PopupMenuItem(
                              value: 'host',
                              child: Text('مضيف'),
                            ),
                            PopupMenuItem(
                              value: 'manager',
                              child: Text('مدير'),
                            ),
                            PopupMenuItem(
                              value: 'senior_manager',
                              child: Text('مدير أول'),
                            ),
                          ],
                        )
                      : null,
                ),
              );
            }),
            const SizedBox(height: 8),
            Card(
              child: ExpansionTile(
                leading: const Icon(Icons.policy_outlined),
                title: const Text('Permission Matrix المعتمد'),
                children: matrix
                    .map(
                      (row) => ListTile(
                        title: Text(
                          roleLabel((row['role'] ?? '').toString()),
                        ),
                        subtitle: Text(permissionSummary(row)),
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
