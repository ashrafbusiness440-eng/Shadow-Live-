import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class AgencyPolicyControlPage extends StatefulWidget {
  const AgencyPolicyControlPage({
    super.key,
    required this.agencyId,
    required this.canManagePolicies,
    required this.canManageMemberships,
  });

  final String agencyId;
  final bool canManagePolicies;
  final bool canManageMemberships;

  @override
  State<AgencyPolicyControlPage> createState() =>
      _AgencyPolicyControlPageState();
}

class _AgencyPolicyControlPageState extends State<AgencyPolicyControlPage> {
  bool loading = true;
  bool busy = false;
  bool overrideTiers = false;
  bool overrideTargets = false;
  bool overrideBonus = false;
  bool surplusToShadow = false;
  bool surplusConfigured = false;
  bool propagationHasMore = false;

  final bonusPercent = TextEditingController();
  final activeHosts = TextEditingController();
  final exceptionPublicId = TextEditingController();
  final exceptionReason = TextEditingController();

  List<Map<String, dynamic>> tiers = [];
  List<Map<String, dynamic>> targets = [];

  @override
  void initState() {
    super.initState();
    if (widget.canManagePolicies) {
      loadPolicy();
    } else {
      loading = false;
    }
  }

  @override
  void dispose() {
    bonusPercent.dispose();
    activeHosts.dispose();
    exceptionPublicId.dispose();
    exceptionReason.dispose();
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
          shadowApiEndpoint('agency-control'),
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

  double bpsToPercent(dynamic value) => NumberHelper.intValue(value) / 100;

  Future<void> loadPolicy() async {
    if (busy) return;
    setState(() => loading = true);
    try {
      final body = await post({
        'action': 'getPolicy',
        'agencyId': widget.agencyId,
      });
      final override = body['override'] is Map
          ? Map<String, dynamic>.from(body['override'] as Map)
          : <String, dynamic>{};
      final effective = body['effective'] is Map
          ? Map<String, dynamic>.from(body['effective'] as Map)
          : <String, dynamic>{};
      final inherited = effective['inherited'] is Map
          ? Map<String, dynamic>.from(effective['inherited'] as Map)
          : <String, dynamic>{};
      final propagation = body['propagation'] is Map
          ? Map<String, dynamic>.from(body['propagation'] as Map)
          : <String, dynamic>{};
      final nextTiers = effective['tiers'] is List
          ? (effective['tiers'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];
      final nextTargets = effective['targets'] is List
          ? (effective['targets'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList()
          : <Map<String, dynamic>>[];

      if (!mounted) return;
      setState(() {
        tiers = nextTiers;
        targets = nextTargets;
        overrideTiers = inherited['tiers'] != true;
        overrideTargets = inherited['targets'] != true;
        overrideBonus = inherited['bonus'] != true;
        surplusConfigured = inherited['surplus'] != true;
        surplusToShadow = effective['surplusToShadow'] == true;
        bonusPercent.text =
            bpsToPercent(effective['agencyPerformanceBonusBps']).toString();
        activeHosts.text =
            NumberHelper.intValue(effective['agencyBonusActiveHosts']).toString();
        propagationHasMore =
            body['overrideExists'] == true && propagation['complete'] != true;
      });
      if (override.isEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('هذه الوكالة ترث Default العام حاليًا.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تحميل سياسة الوكالة: ' + e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  int parseInt(String value, String field) {
    final parsed = int.tryParse(value.trim());
    if (parsed == null) throw StateError('invalid_' + field);
    return parsed;
  }

  int parsePercentBps(String value, String field) {
    final parsed = double.tryParse(value.trim());
    if (parsed == null || parsed < 0 || parsed > 100) {
      throw StateError('invalid_' + field);
    }
    return (parsed * 100).round();
  }

  Future<void> editTier(int index) async {
    final tier = tiers[index];
    final minCoins =
        TextEditingController(text: (tier['minGiftCoins'] ?? 0).toString());
    final hostPercent = TextEditingController(
      text: bpsToPercent(tier['hostShareBps']).toString(),
    );
    final agencyPercent = TextEditingController(
      text: bpsToPercent(tier['agencyShareBps']).toString(),
    );
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          'تعديل ' + (tier['nameAr'] ?? tier['id'] ?? '').toString(),
        ),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: minCoins,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'حد المستوى Coins',
                ),
              ),
              TextField(
                controller: hostPercent,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'نسبة Host %',
                ),
              ),
              TextField(
                controller: agencyPercent,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(
                  labelText: 'نسبة Agency %',
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
            child: const Text('اعتماد'),
          ),
        ],
      ),
    );
    if (accepted == true) {
      try {
        final nextMin = parseInt(minCoins.text, 'tier_min');
        final hostBps = parsePercentBps(hostPercent.text, 'host_percent');
        final agencyBps =
            parsePercentBps(agencyPercent.text, 'agency_percent');
        if (nextMin < 0 || hostBps + agencyBps > 10000) {
          throw StateError('invalid_tier');
        }
        if (!mounted) return;
        setState(() {
          tiers[index] = {
            ...tier,
            'minGiftCoins': nextMin,
            'hostShareBps': hostBps,
            'agencyShareBps': agencyBps,
          };
          overrideTiers = true;
        });
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تحقق من قيم المستوى والنسب.')),
          );
        }
      }
    }
    minCoins.dispose();
    hostPercent.dispose();
    agencyPercent.dispose();
  }

  Future<void> editTarget(int index) async {
    final target = targets[index];
    final threshold = TextEditingController(
      text: (target['thresholdCoins'] ?? 0).toString(),
    );
    final salary = TextEditingController(
      text: (target['salaryDiamonds'] ?? 0).toString(),
    );
    final accepted = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(
          'Target ' +
              (target['tierId'] ?? '').toString() +
              ' ' +
              (target['rank'] ?? '').toString(),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: threshold,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'Target Coins'),
            ),
            TextField(
              controller: salary,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(
                labelText: 'راتب Host — Diamonds',
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
            onPressed: () => Navigator.pop(context, true),
            child: const Text('اعتماد'),
          ),
        ],
      ),
    );
    if (accepted == true) {
      try {
        final nextThreshold = parseInt(threshold.text, 'target');
        final nextSalary = parseInt(salary.text, 'salary');
        if (nextThreshold <= 0 || nextSalary < 0) {
          throw StateError('invalid_target');
        }
        if (!mounted) return;
        setState(() {
          targets[index] = {
            ...target,
            'thresholdCoins': nextThreshold,
            'salaryDiamonds': nextSalary,
          };
          overrideTargets = true;
        });
      } catch (_) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('تحقق من Target والراتب.')),
          );
        }
      }
    }
    threshold.dispose();
    salary.dispose();
  }

  Future<void> savePolicy() async {
    if (busy || !widget.canManagePolicies) return;
    if (!surplusConfigured) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'حدد سياسة زيادة نهاية الشهر أولًا: Shadow أو Host.',
          ),
        ),
      );
      return;
    }
    try {
      final bonusBps = parsePercentBps(
        bonusPercent.text,
        'agency_bonus_percent',
      );
      final requiredHosts = parseInt(activeHosts.text, 'active_hosts');
      if (bonusBps > 3000 || requiredHosts < 1 || requiredHosts > 100000) {
        throw StateError('invalid_bonus');
      }
      setState(() => busy = true);
      await post({
        'action': 'updatePolicy',
        'agencyId': widget.agencyId,
        'overrideTiers': overrideTiers,
        'tiers': tiers,
        'overrideTargets': overrideTargets,
        'targets': targets,
        'overrideBonus': overrideBonus,
        'agencyPerformanceBonusBps': bonusBps,
        'agencyBonusActiveHosts': requiredHosts,
        'surplusToShadow': surplusToShadow,
        'idempotencyKey': operationKey('agency_policy'),
      });
      propagationHasMore = true;
      await propagateNextPage(showDoneMessage: false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            propagationHasMore
                ? 'تم حفظ السياسة وتطبيق أول دفعة ≤25. أكمل الدفعة التالية.'
                : 'تم حفظ السياسة وتطبيقها على أعضاء الوكالة.',
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر حفظ سياسة الوكالة: ' + e.toString())),
        );
      }
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> propagateNextPage({bool showDoneMessage = true}) async {
    if (!widget.canManagePolicies) return;
    final body = await post({
      'action': 'propagatePolicy',
      'agencyId': widget.agencyId,
      'limit': 25,
    });
    if (!mounted) return;
    setState(() {
      propagationHasMore = body['hasMore'] == true;
    });
    if (showDoneMessage) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            propagationHasMore
                ? 'تم تطبيق دفعة جديدة. يوجد أعضاء إضافيون.'
                : 'اكتمل نشر السياسة على أعضاء الوكالة.',
          ),
        ),
      );
    }
  }

  Future<void> applyCooldownException() async {
    if (busy || !widget.canManageMemberships) return;
    final publicId = exceptionPublicId.text.trim();
    final reason = exceptionReason.text.trim();
    if (!RegExp(r'^\d{3,8}.hasMatch(publicId) || reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل Public ID صحيح وسبب الاستثناء.')),
      );
      return;
    }
    setState(() => busy = true);
    try {
      await post({
        'action': 'overrideCooldownByPublicId',
        'targetPublicId': publicId,
        'reason': reason,
        'idempotencyKey': operationKey('agency_cooldown_exception'),
      });
      exceptionPublicId.clear();
      exceptionReason.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم رفع فترة الانتظار وتسجيل Audit + إشعار المستخدم.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تنفيذ الاستثناء: ' + e.toString())),
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
        title: Text('سياسة الوكالة ' + widget.agencyId),
        actions: [
          if (widget.canManagePolicies)
            IconButton(
              onPressed: busy ? null : loadPolicy,
              icon: const Icon(Icons.refresh),
            ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (widget.canManagePolicies) ...[
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.speed_outlined),
                      title: Text('Policy Override — bounded'),
                      subtitle: Text(
                        'أي تغيير يحفظ Server-side مع Audit/idempotency. '
                        'نشر Snapshot يتم بدفعات ≤25 بدون polling أو scans غير محدودة.',
                      ),
                    ),
                  ),
                  SwitchListTile(
                    value: overrideTiers,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => overrideTiers = value),
                    title: const Text('Override نسب ومستويات الأرباح'),
                    subtitle: const Text(
                      'OFF = ترث Default العام. ON = تستخدم قيم هذه الوكالة.',
                    ),
                  ),
                  if (tiers.isNotEmpty)
                    Card(
                      child: ExpansionTile(
                        leading: const Icon(Icons.percent),
                        title: const Text('Revenue Tiers'),
                        children: [
                          for (var i = 0; i < tiers.length; i++)
                            ListTile(
                              title: Text(
                                (tiers[i]['nameAr'] ?? tiers[i]['id']).toString(),
                              ),
                              subtitle: Text(
                                'من ' +
                                    (tiers[i]['minGiftCoins'] ?? 0).toString() +
                                    ' Coins • Host ' +
                                    bpsToPercent(tiers[i]['hostShareBps'])
                                        .toString() +
                                    '% • Agency ' +
                                    bpsToPercent(tiers[i]['agencyShareBps'])
                                        .toString() +
                                    '%',
                              ),
                              trailing: IconButton(
                                onPressed: busy ? null : () => editTier(i),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                            ),
                        ],
                      ),
                    ),
                  SwitchListTile(
                    value: overrideTargets,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => overrideTargets = value),
                    title: const Text('Override جدول Targets'),
                    subtitle: const Text(
                      'OFF = Default العام. ON = Target/Salary خاص بهذه الوكالة.',
                    ),
                  ),
                  if (targets.isNotEmpty)
                    Card(
                      child: ExpansionTile(
                        leading: const Icon(Icons.flag_outlined),
                        title: const Text('Targets / Host Salary'),
                        children: [
                          for (var i = 0; i < targets.length; i++)
                            ListTile(
                              title: Text(
                                (targets[i]['tierId'] ?? '').toString() +
                                    ' ' +
                                    (targets[i]['rank'] ?? '').toString(),
                              ),
                              subtitle: Text(
                                'Target ' +
                                    (targets[i]['thresholdCoins'] ?? 0)
                                        .toString() +
                                    ' Coins • ' +
                                    (targets[i]['salaryDiamonds'] ?? 0)
                                        .toString() +
                                    ' Diamonds',
                              ),
                              trailing: IconButton(
                                onPressed: busy ? null : () => editTarget(i),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                            ),
                        ],
                      ),
                    ),
                  SwitchListTile(
                    value: overrideBonus,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => overrideBonus = value),
                    title: const Text('Override Agency Bonus'),
                    subtitle: const Text('OFF = يرث Default العام.'),
                  ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          TextField(
                            controller: bonusPercent,
                            enabled: !busy,
                            keyboardType:
                                const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Agency Bonus % — أقصى 30%',
                            ),
                          ),
                          TextField(
                            controller: activeHosts,
                            enabled: !busy,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'عدد Hosts النشطين المطلوب',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Card(
                    child: Column(
                      children: [
                        CheckboxListTile(
                          value: surplusConfigured,
                          onChanged: busy
                              ? null
                              : (value) => setState(
                                    () => surplusConfigured = value == true,
                                  ),
                          title: const Text('تفعيل قرار زيادة نهاية الشهر'),
                          subtitle: const Text(
                            'يجب أن تكون السياسة محددة قبل التسوية الشهرية.',
                          ),
                        ),
                        SwitchListTile(
                          value: surplusToShadow,
                          onChanged: busy || !surplusConfigured
                              ? null
                              : (value) =>
                                  setState(() => surplusToShadow = value),
                          title: Text(
                            surplusToShadow
                                ? 'ON — الزيادة إلى أرباح Shadow'
                                : 'OFF — الزيادة Coins إلى Host',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: busy ? null : savePolicy,
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('حفظ سياسة الوكالة'),
                  ),
                  if (propagationHasMore)
                    OutlinedButton.icon(
                      onPressed: busy
                          ? null
                          : () async {
                              setState(() => busy = true);
                              try {
                                await propagateNextPage();
                              } finally {
                                if (mounted) setState(() => busy = false);
                              }
                            },
                      icon: const Icon(Icons.navigate_next),
                      label: const Text('تطبيق الدفعة التالية ≤25'),
                    ),
                ],
                if (widget.canManageMemberships) ...[
                  const SizedBox(height: 20),
                  const Divider(),
                  const SizedBox(height: 8),
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.lock_open_outlined),
                      title: Text('استثناء انتظار الانضمام 7 أيام'),
                      subtitle: Text(
                        'يعيد استخدام مسار Stage 04 المعتمد: سبب إلزامي + '
                        'idempotency + Audit + إشعار للمستخدم.',
                      ),
                    ),
                  ),
                  TextField(
                    controller: exceptionPublicId,
                    enabled: !busy,
                    keyboardType: TextInputType.number,
                    maxLength: 8,
                    decoration: const InputDecoration(
                      labelText: 'Public ID للمستخدم',
                    ),
                  ),
                  TextField(
                    controller: exceptionReason,
                    enabled: !busy,
                    maxLength: 500,
                    decoration: const InputDecoration(
                      labelText: 'سبب الاستثناء',
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: busy ? null : applyCooldownException,
                    icon: const Icon(Icons.check_circle_outline),
                    label: const Text('رفع الانتظار'),
                  ),
                ],
                const SizedBox(height: 40),
              ],
            ),
    );
  }
}

class NumberHelper {
  const NumberHelper._();

  static int intValue(dynamic value) {
    final parsed = int.tryParse(value?.toString() ?? '');
    return parsed ?? 0;
  }
}
).hasMatch(publicId) || reason.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('أدخل Public ID صحيح وسبب الاستثناء.')),
      );
      return;
    }
    setState(() => busy = true);
    try {
      await post({
        'action': 'overrideCooldownByPublicId',
        'targetPublicId': publicId,
        'reason': reason,
        'idempotencyKey': operationKey('agency_cooldown_exception'),
      });
      exceptionPublicId.clear();
      exceptionReason.clear();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('تم رفع فترة الانتظار وتسجيل Audit + إشعار المستخدم.'),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر تنفيذ الاستثناء: ' + e.toString())),
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
        title: Text('سياسة الوكالة ' + widget.agencyId),
        actions: [
          if (widget.canManagePolicies)
            IconButton(
              onPressed: busy ? null : loadPolicy,
              icon: const Icon(Icons.refresh),
            ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                if (widget.canManagePolicies) ...[
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.speed_outlined),
                      title: Text('Policy Override — bounded'),
                      subtitle: Text(
                        'أي تغيير يحفظ Server-side مع Audit/idempotency. '
                        'نشر Snapshot يتم بدفعات ≤25 بدون polling أو scans غير محدودة.',
                      ),
                    ),
                  ),
                  SwitchListTile(
                    value: overrideTiers,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => overrideTiers = value),
                    title: const Text('Override نسب ومستويات الأرباح'),
                    subtitle: const Text(
                      'OFF = ترث Default العام. ON = تستخدم قيم هذه الوكالة.',
                    ),
                  ),
                  if (tiers.isNotEmpty)
                    Card(
                      child: ExpansionTile(
                        leading: const Icon(Icons.percent),
                        title: const Text('Revenue Tiers'),
                        children: [
                          for (var i = 0; i < tiers.length; i++)
                            ListTile(
                              title: Text(
                                (tiers[i]['nameAr'] ?? tiers[i]['id']).toString(),
                              ),
                              subtitle: Text(
                                'من ' +
                                    (tiers[i]['minGiftCoins'] ?? 0).toString() +
                                    ' Coins • Host ' +
                                    bpsToPercent(tiers[i]['hostShareBps'])
                                        .toString() +
                                    '% • Agency ' +
                                    bpsToPercent(tiers[i]['agencyShareBps'])
                                        .toString() +
                                    '%',
                              ),
                              trailing: IconButton(
                                onPressed: busy ? null : () => editTier(i),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                            ),
                        ],
                      ),
                    ),
                  SwitchListTile(
                    value: overrideTargets,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => overrideTargets = value),
                    title: const Text('Override جدول Targets'),
                    subtitle: const Text(
                      'OFF = Default العام. ON = Target/Salary خاص بهذه الوكالة.',
                    ),
                  ),
                  if (targets.isNotEmpty)
                    Card(
                      child: ExpansionTile(
                        leading: const Icon(Icons.flag_outlined),
                        title: const Text('Targets / Host Salary'),
                        children: [
                          for (var i = 0; i < targets.length; i++)
                            ListTile(
                              title: Text(
                                (targets[i]['tierId'] ?? '').toString() +
                                    ' ' +
                                    (targets[i]['rank'] ?? '').toString(),
                              ),
                              subtitle: Text(
                                'Target ' +
                                    (targets[i]['thresholdCoins'] ?? 0)
                                        .toString() +
                                    ' Coins • ' +
                                    (targets[i]['salaryDiamonds'] ?? 0)
                                        .toString() +
                                    ' Diamonds',
                              ),
                              trailing: IconButton(
                                onPressed: busy ? null : () => editTarget(i),
                                icon: const Icon(Icons.edit_outlined),
                              ),
                            ),
                        ],
                      ),
                    ),
                  SwitchListTile(
                    value: overrideBonus,
                    onChanged: busy
                        ? null
                        : (value) => setState(() => overrideBonus = value),
                    title: const Text('Override Agency Bonus'),
                    subtitle: const Text('OFF = يرث Default العام.'),
                  ),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        children: [
                          TextField(
                            controller: bonusPercent,
                            enabled: !busy,
                            keyboardType:
                                const TextInputType.numberWithOptions(
                              decimal: true,
                            ),
                            decoration: const InputDecoration(
                              labelText: 'Agency Bonus % — أقصى 30%',
                            ),
                          ),
                          TextField(
                            controller: activeHosts,
                            enabled: !busy,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'عدد Hosts النشطين المطلوب',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  Card(
                    child: Column(
                      children: [
                        CheckboxListTile(
                          value: surplusConfigured,
                          onChanged: busy
                              ? null
                              : (value) => setState(
                                    () => surplusConfigured = value == true,
                                  ),
                          title: const Text('تفعيل قرار زيادة نهاية الشهر'),
                          subtitle: const Text(
                            'يجب أن تكون السياسة محددة قبل التسوية الشهرية.',
                          ),
                        ),
                        SwitchListTile(
                          value: surplusToShadow,
                          onChanged: busy || !surplusConfigured
                              ? null
                              : (value) =>
                                  setState(() => surplusToShadow = value),
                          title: Text(
                            surplusToShadow
                                ? 'ON — الزيادة إلى أرباح Shadow'
                                : 'OFF — الزيادة Coins إلى Host',
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 8),
                  FilledButton.icon(
                    onPressed: busy ? null : savePolicy,
                    icon: const Icon(Icons.save_outlined),
                    label: const Text('حفظ سياسة الوكالة'),
                  ),
                  if (propagationHasMore)
                    OutlinedButton.icon(
                      onPressed: busy
                          ? null
                          : () async {
                              setState(() => busy = true);
                              try {
                                await propagateNextPage();
                              } finally {
                                if (mounted) setState(() => busy = false);
                              }
                            },
                      icon: const Icon(Icons.navigate_next),
                      label: const Text('تطبيق الدفعة التالية ≤25'),
                    ),
                ],
                if (widget.canManageMemberships) ...[
                  const SizedBox(height: 20),
                  const Divider(),
                  const SizedBox(height: 8),
                  const Card(
                    child: ListTile(
                      leading: Icon(Icons.lock_open_outlined),
                      title: Text('استثناء انتظار الانضمام 7 أيام'),
                      subtitle: Text(
                        'يعيد استخدام مسار Stage 04 المعتمد: سبب إلزامي + '
                        'idempotency + Audit + إشعار للمستخدم.',
                      ),
                    ),
                  ),
                  TextField(
                    controller: exceptionPublicId,
                    enabled: !busy,
                    keyboardType: TextInputType.number,
                    maxLength: 6,
                    decoration: const InputDecoration(
                      labelText: 'Public ID للمستخدم',
                    ),
                  ),
                  TextField(
                    controller: exceptionReason,
                    enabled: !busy,
                    maxLength: 500,
                    decoration: const InputDecoration(
                      labelText: 'سبب الاستثناء',
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: busy ? null : applyCooldownException,
                    icon: const Icon(Icons.check_circle_outline),
                    label: const Text('رفع الانتظار'),
                  ),
                ],
                const SizedBox(height: 40),
              ],
            ),
    );
  }
}

class NumberHelper {
  const NumberHelper._();

  static int intValue(dynamic value) {
    final parsed = int.tryParse(value?.toString() ?? '');
    return parsed ?? 0;
  }
}
