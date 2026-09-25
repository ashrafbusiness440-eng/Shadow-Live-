import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class OwnerUserAccessCard extends StatelessWidget {
  const OwnerUserAccessCard({
    super.key,
    required this.uid,
    required this.targetRole,
    required this.adminEnabled,
    required this.capabilities,
  });

  final String uid;
  final String targetRole;
  final bool adminEnabled;
  final List<String> capabilities;

  static const roleLabels = <String, String>{
    'user': 'User — مستخدم',
    'moderator': 'Moderator — مشرف',
    'admin': 'Admin — إداري',
    'super_admin': 'Super Admin — إداري أعلى',
  };

  static const capabilityLabels = <String, String>{
    'viewDashboard': 'عرض لوحة المعلومات',
    'viewUsers': 'عرض المستخدمين',
    'manageUsers': 'إدارة المستخدمين',
    'viewReports': 'عرض البلاغات',
    'reviewReports': 'مراجعة البلاغات',
    'muteUsers': 'كتم المستخدمين',
    'suspendUsers': 'تعليق الحسابات',
    'permanentBan': 'حظر دائم',
    'manageRooms': 'إدارة الغرف',
    'globalRoomControl': 'تحكم شامل بالغرف الرسمية',
    'canCreateHiddenRoom': 'إنشاء الغرف المخفية',
    'manageAgencies': 'إدارة الوكالات',
    'manageVip': 'إدارة VIP',
    'manageSpecialIds': 'إدارة IDs المميزة',
    'manageIds': 'إدارة IDs المستخدمين والغرف',
    'manageStore': 'إدارة المتجر',
    'manageGames': 'إدارة الألعاب',
    'manageEconomy': 'إدارة الاقتصاد',
    'adjustBalances': 'تعديل Coins و Diamonds',
    'manageWithdrawals': 'إدارة السحب',
    'manageSettlements': 'إدارة التسويات',
    'manageCampaigns': 'إدارة الحملات',
    'manageRoles': 'إدارة الأدوار',
    'viewAuditLog': 'عرض Audit Log',
    'emergencyLock': 'قفل الطوارئ',
  };

  static const capabilityGroups = <String, List<String>>{
    'المستخدمون ولوحة التحكم': [
      'viewDashboard', 'viewUsers', 'manageUsers',
    ],
    'البلاغات والإشراف': [
      'viewReports', 'reviewReports', 'muteUsers', 'suspendUsers', 'permanentBan',
    ],
    'الغرف والـ IDs': [
      'manageRooms', 'globalRoomControl', 'canCreateHiddenRoom', 'manageIds', 'manageSpecialIds',
    ],
    'الاقتصاد والألعاب': [
      'manageEconomy', 'adjustBalances', 'manageGames', 'manageWithdrawals', 'manageSettlements',
    ],
    'الإدارة العامة': [
      'manageAgencies', 'manageVip', 'manageStore', 'manageCampaigns', 'manageRoles', 'viewAuditLog', 'emergencyLock',
    ],
  };

  Set<String> _suggested(String role) => switch (role) {
    'moderator' => {'viewReports', 'muteUsers'},
    'admin' => {'viewDashboard', 'viewUsers', 'viewReports', 'reviewReports', 'muteUsers', 'manageRooms'},
    'super_admin' => {
      'viewDashboard', 'viewUsers', 'manageUsers', 'viewReports', 'reviewReports',
      'muteUsers', 'suspendUsers', 'manageRooms', 'globalRoomControl',
      'manageAgencies', 'manageVip', 'manageIds', 'manageStore',
      'manageGames', 'viewAuditLog',
    },
    _ => <String>{},
  };

  @override
  Widget build(BuildContext context) {
    final current = controlAuth.currentUser;
    return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      future: current == null
          ? null
          : controlFirestore.collection('users').doc(current.uid).get(),
      builder: (context, snapshot) {
        final actor = snapshot.data?.data();
        final actorIsOwner = actor?['role'] == 'owner' && actor?['adminEnabled'] == true;
        final protectedOwner = targetRole == 'owner';

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              const Row(children: [
                Icon(Icons.admin_panel_settings_rounded, color: Color(0xFFD7B85A)),
                SizedBox(width: 8),
                Expanded(child: Text('إدارة الدور والصلاحيات', style: TextStyle(fontWeight: FontWeight.w900))),
              ]),
              const SizedBox(height: 8),
              Text(
                protectedOwner
                    ? 'حساب الـOwner محمي ولا يمكن خفض رتبته أو تعديل صلاحياته من هذه الواجهة.'
                    : 'الـOwner يستطيع تعيين الدور، تفعيل/تعطيل دخول الإدارة، ومنح أو سحب الصلاحيات بشكل منفصل.',
                style: const TextStyle(color: Color(0xFFAAA3B8)),
              ),
              const SizedBox(height: 12),
              if (protectedOwner)
                const Chip(label: Text('Owner Protection'))
              else
                SizedBox(
                  width: double.infinity,
                  child: FilledButton.icon(
                    onPressed: actorIsOwner ? () => _openEditor(context) : null,
                    icon: const Icon(Icons.manage_accounts_outlined),
                    label: const Text('تعديل الدور والصلاحيات'),
                  ),
                ),
              if (!protectedOwner && !actorIsOwner) ...[
                const SizedBox(height: 8),
                const Text('هذه الأداة متاحة لحساب Owner فقط.', style: TextStyle(color: Color(0xFFAAA3B8))),
              ],
            ]),
          ),
        );
      },
    );
  }

  Future<void> _openEditor(BuildContext context) async {
    final parentContext = context;
    var selectedRole = roleLabels.containsKey(targetRole) ? targetRole : 'user';
    var enabled = adminEnabled;
    final selected = capabilities.where(capabilityLabels.containsKey).toSet();
    final reason = TextEditingController(text: 'تحديث الدور والصلاحيات من Shadow Control');
    var saving = false;
    String? error;

    await showModalBottomSheet<void>(
      context: parentContext,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0D0917),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(26))),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(builder: (context, setSheetState) {
          Future<void> save() async {
            if (reason.text.trim().length < 3) {
              setSheetState(() => error = 'اكتب سببًا واضحًا للتعديل.');
              return;
            }
            setSheetState(() { saving = true; error = null; });
            try {
              final user = controlAuth.currentUser;
              if (user == null) throw Exception('not_signed_in');
              final token = await user.getIdToken().timeout(const Duration(seconds: 12));
              if (token == null || token.isEmpty) throw Exception('empty_token');
              final prefix = user.uid.length >= 6 ? user.uid.substring(0, 6) : user.uid;
              final key = 'access_${DateTime.now().millisecondsSinceEpoch}_$prefix';
              final response = await http.post(
                shadowApiEndpoint('manage-user-access'),
                headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer $token'},
                body: jsonEncode({
                  'targetUid': uid,
                  'role': selectedRole,
                  'adminEnabled': enabled,
                  'capabilities': selected.toList()..sort(),
                  'reason': reason.text.trim(),
                  'idempotencyKey': key,
                }),
              ).timeout(const Duration(seconds: 25));
              final body = response.body.isEmpty
                  ? <String, dynamic>{}
                  : jsonDecode(response.body) as Map<String, dynamic>;
              if (response.statusCode != 200 || body['ok'] != true) {
                throw Exception((body['code'] ?? 'request_failed').toString());
              }
              if (sheetContext.mounted) Navigator.pop(sheetContext);
              if (parentContext.mounted) {
                ScaffoldMessenger.of(parentContext).showSnackBar(
                  const SnackBar(content: Text('تم تحديث الدور والصلاحيات وتسجيل العملية في Audit Log.')),
                );
                Navigator.of(parentContext).pop();
              }
            } catch (e) {
              final code = e.toString().replaceFirst('Exception: ', '');
              final message = switch (code) {
                'recent_auth_required' => 'يلزم تسجيل دخول حديث لحساب الـOwner قبل تعديل الصلاحيات.',
                'owner_protected' => 'حساب الـOwner محمي.',
                'forbidden' => 'هذه العملية متاحة للـOwner فقط.',
                'invalid_capability' => 'توجد صلاحية غير معتمدة في الطلب.',
                'not_found' => 'الحساب المستهدف غير موجود.',
                _ => 'تعذر حفظ التعديل: $code',
              };
              if (sheetContext.mounted) setSheetState(() => error = message);
            } finally {
              if (sheetContext.mounted) setSheetState(() => saving = false);
            }
          }

          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(16, 14, 16, MediaQuery.viewInsetsOf(context).bottom + 18),
              child: SingleChildScrollView(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Center(child: Container(width: 44, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(99)))),
                  const SizedBox(height: 14),
                  const Text('إدارة الدور والصلاحيات', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 6),
                  const Text('الدور لا يمنح Owner. الصلاحيات أدناه هي التي تحدد ما يستطيع الحساب تنفيذه فعليًا، ويمكن إيقاف دخول الإدارة دون حذفها.', style: TextStyle(color: Color(0xFFAAA3B8))),
                  const SizedBox(height: 14),
                  DropdownButtonFormField<String>(
                    initialValue: selectedRole,
                    decoration: const InputDecoration(labelText: 'الدور', border: OutlineInputBorder()),
                    items: roleLabels.entries.map((entry) => DropdownMenuItem(value: entry.key, child: Text(entry.value))).toList(),
                    onChanged: saving ? null : (value) {
                      if (value != null) setSheetState(() => selectedRole = value);
                    },
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('تفعيل دخول الإدارة'),
                    subtitle: const Text('إذا كان مغلقًا، تبقى الصلاحيات محفوظة لكنها غير فعالة.'),
                    value: enabled,
                    onChanged: saving ? null : (value) => setSheetState(() => enabled = value),
                  ),
                  Row(children: [
                    Expanded(child: OutlinedButton.icon(
                      onPressed: saving ? null : () => setSheetState(() {
                        selected
                          ..clear()
                          ..addAll(_suggested(selectedRole));
                      }),
                      icon: const Icon(Icons.auto_fix_high_outlined),
                      label: const Text('صلاحيات مقترحة للدور'),
                    )),
                    const SizedBox(width: 8),
                    OutlinedButton(
                      onPressed: saving ? null : () => setSheetState(selected.clear),
                      child: const Text('مسح الكل'),
                    ),
                  ]),
                  const SizedBox(height: 12),
                  for (final group in capabilityGroups.entries) ...[
                    Text(group.key, style: const TextStyle(fontWeight: FontWeight.w900, color: Color(0xFFD7B85A))),
                    const SizedBox(height: 4),
                    ...group.value.map((capability) => CheckboxListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      title: Text(capabilityLabels[capability] ?? capability),
                      subtitle: Text(capability, style: const TextStyle(fontSize: 11, color: Color(0xFF8F879E))),
                      value: selected.contains(capability),
                      onChanged: saving ? null : (value) => setSheetState(() {
                        if (value == true) {
                          selected.add(capability);
                        } else {
                          selected.remove(capability);
                        }
                      }),
                    )),
                    const Divider(),
                  ],
                  TextField(
                    controller: reason,
                    maxLength: 160,
                    enabled: !saving,
                    decoration: const InputDecoration(
                      labelText: 'سبب التعديل',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  if (error != null) ...[
                    const SizedBox(height: 8),
                    Text(error!, style: const TextStyle(color: Colors.orangeAccent)),
                  ],
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: FilledButton.icon(
                      onPressed: saving ? null : save,
                      icon: saving
                          ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                          : const Icon(Icons.save_outlined),
                      label: Text(saving ? 'جارٍ الحفظ...' : 'حفظ الدور والصلاحيات'),
                    ),
                  ),
                ]),
              ),
            ),
          );
        }),
      ),
    );
    reason.dispose();
  }
}
