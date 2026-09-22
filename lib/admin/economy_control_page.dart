import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../utils/compact_number.dart';
import 'gift_catalog_control_page.dart';
import 'gift_economy_control_page.dart';
import 'recharge_packages_control_page.dart';

class EconomyControlPage extends StatefulWidget {
  const EconomyControlPage({super.key});

  @override
  State<EconomyControlPage> createState() => _EconomyControlPageState();
}

class _EconomyControlPageState extends State<EconomyControlPage> {
  bool loading = true;
  bool saving = false;
  bool isOwner = false;
  bool canAdjust = false;
  bool economyLocked = false;
  bool rechargeLocked = false;
  bool giftsLocked = false;
  bool transfersLocked = false;

  final reason = TextEditingController();
  final userQuery = TextEditingController();
  final operationQuery = TextEditingController();

  Map<String, dynamic>? foundUser;
  List<Map<String, dynamic>> ledger = [];
  List<Map<String, dynamic>> operations = [];
  List<Map<String, dynamic>> issues = [];

  Uri endpoint(String path) => Uri(
        scheme: Uri.base.scheme,
        host: Uri.base.host,
        port: Uri.base.hasPort ? Uri.base.port : null,
        path: path,
      );

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    reason.dispose();
    userQuery.dispose();
    operationQuery.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> post(
    String path,
    Map<String, dynamic> payload,
  ) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('not_signed_in');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('empty_token');
    final response = await http
        .post(
          endpoint(path),
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

  Future<void> load() async {
    setState(() => loading = true);
    try {
      final body = await post('/api/economy-control', {'action': 'state'});
      final lock = body['emergencyLock'] is Map
          ? Map<String, dynamic>.from(body['emergencyLock'] as Map)
          : <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        isOwner = body['isOwner'] == true;
        canAdjust = body['canAdjustBalances'] == true;
        economyLocked =
            lock['economyLocked'] == true || lock['enabled'] == true;
        rechargeLocked = lock['rechargeLocked'] == true;
        giftsLocked = lock['giftsLocked'] == true;
        transfersLocked = lock['transfersLocked'] == true;
        reason.text = (lock['reason'] ?? '').toString();
        loading = false;
      });
      await loadIssues();
    } catch (e) {
      if (!mounted) return;
      setState(() => loading = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تحميل Economy Control: ' + e.toString())),
      );
    }
  }

  Future<void> saveLocks() async {
    if (!isOwner || reason.text.trim().length < 3) return;
    setState(() => saving = true);
    try {
      await post('/api/economy-control', {
        'action': 'setEmergencyLock',
        'economyLocked': economyLocked,
        'rechargeLocked': rechargeLocked,
        'giftsLocked': giftsLocked,
        'transfersLocked': transfersLocked,
        'reason': reason.text.trim(),
      });
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ أقفال الاقتصاد وتسجيل Audit Log.')),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر الحفظ: ' + e.toString())),
      );
    }
  }

  Future<void> searchUser() async {
    final q = userQuery.text.trim();
    if (q.isEmpty) return;
    try {
      final body = await post(
        '/api/economy-control',
        {'action': 'searchUser', 'query': q},
      );
      if (!mounted) return;
      setState(() {
        foundUser = body['user'] is Map
            ? Map<String, dynamic>.from(body['user'] as Map)
            : null;
        ledger = body['ledger'] is List
            ? (body['ledger'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
        canAdjust = body['canAdjustBalances'] == true || canAdjust;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر العثور على المستخدم: ' + e.toString())),
        );
      }
    }
  }

  Future<void> searchOperation() async {
    final q = operationQuery.text.trim();
    if (q.length < 3) return;
    try {
      final body = await post(
        '/api/economy-control',
        {'action': 'searchOperation', 'query': q},
      );
      if (!mounted) return;
      setState(() {
        operations = body['operations'] is List
            ? (body['operations'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر البحث: ' + e.toString())),
        );
      }
    }
  }

  Future<void> loadIssues() async {
    try {
      final body =
          await post('/api/economy-control', {'action': 'recentIssues'});
      if (!mounted) return;
      setState(() {
        issues = body['issues'] is List
            ? (body['issues'] as List)
                .whereType<Map>()
                .map((e) => Map<String, dynamic>.from(e))
                .toList()
            : [];
      });
    } catch (_) {}
  }

  Future<void> adjust(String asset) async {
    final target = foundUser;
    if (target == null || !canAdjust) return;
    final amount = TextEditingController();
    final why = TextEditingController();
    var subtract = false;
    final data = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setLocal) => AlertDialog(
          title: Text(asset == 'coins' ? 'تعديل Coins' : 'تعديل Diamonds'),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                SegmentedButton<bool>(
                  segments: const [
                    ButtonSegment(value: false, label: Text('زيادة')),
                    ButtonSegment(value: true, label: Text('خصم')),
                  ],
                  selected: {subtract},
                  onSelectionChanged: (v) => setLocal(() => subtract = v.first),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: amount,
                  keyboardType:
                      const TextInputType.numberWithOptions(decimal: true),
                  decoration: const InputDecoration(
                    labelText: 'القيمة',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: why,
                  maxLength: 160,
                  decoration: const InputDecoration(
                    labelText: 'السبب',
                    border: OutlineInputBorder(),
                  ),
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
                final value = num.tryParse(amount.text.trim());
                if (value == null ||
                    value <= 0 ||
                    why.text.trim().length < 3) return;
                Navigator.pop(dialogContext, {
                  'delta': subtract ? -value : value,
                  'reason': why.text.trim(),
                });
              },
              child: const Text('تنفيذ'),
            ),
          ],
        ),
      ),
    );
    amount.dispose();
    why.dispose();
    if (data == null || !mounted) return;

    try {
      final authUser = FirebaseAuth.instance.currentUser!;
      final short = authUser.uid.length > 6
          ? authUser.uid.substring(0, 6)
          : authUser.uid;
      final key =
          'econ_' + DateTime.now().millisecondsSinceEpoch.toString() + '_' + short;
      await post('/api/adjust-balance', {
        'targetId': target['uid'],
        'asset': asset,
        'delta': data['delta'],
        'reason': data['reason'],
        'idempotencyKey': key,
      });
      await searchUser();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تم تعديل الرصيد وتسجيل العملية.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('تعذر التعديل: ' + e.toString())),
        );
      }
    }
  }

  Widget tool(
    IconData icon,
    String title,
    String subtitle,
    Widget page,
  ) {
    return Card(
      child: ListTile(
        leading: Icon(icon, color: const Color(0xFFD7B85A)),
        trailing: const Icon(Icons.chevron_left),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
        subtitle: Text(subtitle),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => page),
        ),
      ),
    );
  }

  Widget logTile(String title, String collection) {
    return Card(
      child: ListTile(
        leading: const Icon(
          Icons.receipt_long_outlined,
          color: Color(0xFFD7B85A),
        ),
        trailing: const Icon(Icons.chevron_left),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w800)),
        subtitle: Text(collection),
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) =>
                _EconomyCollectionPage(title: title, collection: collection),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final u = foundUser;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Economy Control'),
        actions: [
          IconButton(onPressed: load, icon: const Icon(Icons.refresh_rounded)),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Card(
            child: ListTile(
              leading: Icon(
                Icons.account_balance_wallet_rounded,
                color: Color(0xFFD7B85A),
              ),
              title: Text(
                'مركز اقتصاد Shadow Live',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: Text(
                'الشحن والهدايا والنسب والأرصدة والسجلات وأقفال الطوارئ من مكان واحد.',
              ),
            ),
          ),
          tool(
            Icons.storefront_outlined,
            'باقات الشحن والـBonus',
            'Coins + Bonus + Product IDs + تفعيل/إيقاف',
            const RechargePackagesControlPage(),
          ),
          tool(
            Icons.card_giftcard_rounded,
            'Gift Catalog',
            'السعر + Featured + الترتيب + Asset Keys',
            const GiftCatalogControlPage(),
          ),
          tool(
            Icons.diamond_rounded,
            'نِسَب المضيف والوكالة',
            'المستويات والـBonus وحصة Shadow Live',
            const GiftEconomyControlPage(),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'Emergency Economy Locks',
                    style:
                        TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                  ),
                  Text(
                    isOwner
                        ? 'Owner فقط • كل تغيير يحتاج سببًا وAudit Log.'
                        : 'عرض فقط • التعديل يحتاج Owner.',
                    style: const TextStyle(color: Color(0xFFAAA3B8)),
                  ),
                  SwitchListTile(
                    value: economyLocked,
                    onChanged: isOwner
                        ? (v) => setState(() => economyLocked = v)
                        : null,
                    title: const Text('إيقاف الاقتصاد بالكامل'),
                  ),
                  SwitchListTile(
                    value: rechargeLocked,
                    onChanged: isOwner && !economyLocked
                        ? (v) => setState(() => rechargeLocked = v)
                        : null,
                    title: const Text('إيقاف الشحن فقط'),
                  ),
                  SwitchListTile(
                    value: giftsLocked,
                    onChanged: isOwner && !economyLocked
                        ? (v) => setState(() => giftsLocked = v)
                        : null,
                    title: const Text('إيقاف الهدايا فقط'),
                  ),
                  SwitchListTile(
                    value: transfersLocked,
                    onChanged: isOwner && !economyLocked
                        ? (v) => setState(() => transfersLocked = v)
                        : null,
                    title: const Text('إيقاف التحويلات فقط'),
                  ),
                  TextField(
                    controller: reason,
                    enabled: isOwner,
                    maxLength: 240,
                    decoration: const InputDecoration(
                      labelText: 'سبب التغيير',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: isOwner && !saving ? saveLocks : null,
                    icon: const Icon(Icons.save_rounded),
                    label: Text(saving ? 'جار الحفظ...' : 'حفظ الأقفال'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'المستخدم والأرصدة',
                    style:
                        TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: userQuery,
                    onSubmitted: (_) => searchUser(),
                    decoration: InputDecoration(
                      labelText: 'UID أو Public ID أو Username',
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        onPressed: searchUser,
                        icon: const Icon(Icons.search),
                      ),
                    ),
                  ),
                  if (u != null) ...[
                    const SizedBox(height: 12),
                    Text(
                      (u['displayName'] ?? '').toString() +
                          ' • ' +
                          (u['publicId'] ?? '').toString(),
                      style: const TextStyle(fontWeight: FontWeight.w900),
                    ),
                    Text(
                      'UID: ' +
                          (u['uid'] ?? '').toString() +
                          '\nCoins: ' +
                          formatCompactAmount(u['coins'] ?? 0) +
                          ' • Diamonds: ' +
                          formatCompactAmount(u['diamonds'] ?? 0) +
                          '\nGifts sent: ' +
                          (u['totalGiftsSent'] ?? 0).toString() +
                          ' • received: ' +
                          (u['totalGiftsReceived'] ?? 0).toString() +
                          '\nValue received: ' +
                          formatCompactAmount(u['totalValueReceived'] ?? 0) +
                          ' Coins • Tier: ' +
                          (u['currentGiftRevenueTier'] ?? '-').toString(),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        FilledButton.tonal(
                          onPressed: canAdjust ? () => adjust('coins') : null,
                          child: const Text('تعديل Coins'),
                        ),
                        FilledButton.tonal(
                          onPressed:
                              canAdjust ? () => adjust('diamonds') : null,
                          child: const Text('تعديل Diamonds'),
                        ),
                      ],
                    ),
                    if (ledger.isNotEmpty) ...[
                      const Divider(height: 28),
                      const Text(
                        'آخر Ledger',
                        style: TextStyle(fontWeight: FontWeight.w900),
                      ),
                      ...ledger.take(8).map(
                            (item) => ListTile(
                              dense: true,
                              title: Text(
                                (item['asset'] ?? '-').toString() +
                                    ' • ' +
                                    (item['delta'] ?? 0).toString(),
                              ),
                              subtitle: Text(
                                (item['reason'] ?? '-').toString() +
                                    ' • ' +
                                    (item['id'] ?? '').toString(),
                              ),
                            ),
                          ),
                    ],
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text(
                    'تتبع عملية',
                    style:
                        TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: operationQuery,
                    onSubmitted: (_) => searchOperation(),
                    decoration: InputDecoration(
                      labelText:
                          'Purchase ID / Token hash / Idempotency / Source ID',
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        onPressed: searchOperation,
                        icon: const Icon(Icons.manage_search),
                      ),
                    ),
                  ),
                  ...operations.map(
                    (item) => ListTile(
                      title: Text(
                        (item['collection'] ?? '').toString() +
                            ' • ' +
                            (item['id'] ?? '').toString(),
                      ),
                      subtitle: Text(
                        jsonEncode(item['data'] ?? {}),
                        maxLines: 5,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'عمليات تحتاج مراجعة',
                          style: TextStyle(
                            fontSize: 19,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      IconButton(
                        onPressed: loadIssues,
                        icon: const Icon(Icons.refresh),
                      ),
                    ],
                  ),
                  if (issues.isEmpty)
                    const Text('لا توجد مشاكل ضمن آخر العمليات المقروءة.')
                  else
                    ...issues.map(
                      (item) => ListTile(
                        leading: const Icon(
                          Icons.warning_amber_rounded,
                          color: Colors.orangeAccent,
                        ),
                        title: Text(
                          (item['collection'] ?? '').toString() +
                              ' • ' +
                              (item['id'] ?? '').toString(),
                        ),
                        subtitle: Text(
                          jsonEncode(item['data'] ?? {}),
                          maxLines: 4,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'السجلات',
            style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
          ),
          logTile('Financial Ledger', 'financial_ledger'),
          logTile('Gift Transactions', 'gift_transactions'),
          logTile('Google Play Purchases', 'google_play_purchases'),
          logTile('Economy Audit Log', 'admin_audit_logs'),
          const Card(
            child: ListTile(
              leading: Icon(Icons.policy_outlined),
              title: Text('Refund / Dispute readiness'),
              subtitle: Text(
                'Google Play purchases الجديدة تحفظ refundState وdisputeState كبنية جاهزة للربط لاحقًا.',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _EconomyCollectionPage extends StatelessWidget {
  const _EconomyCollectionPage({
    required this.title,
    required this.collection,
  });

  final String title;
  final String collection;

  String preview(Map<String, dynamic> data) =>
      data.entries.take(10).map((e) => e.key + ': ' + e.value.toString()).join('\n');

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
        stream: FirebaseFirestore.instance
            .collection(collection)
            .limit(100)
            .snapshots(),
        builder: (context, snap) {
          if (snap.hasError) {
            return Center(child: Text('تعذر القراءة: ' + snap.error.toString()));
          }
          if (!snap.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final docs = snap.data!.docs;
          if (docs.isEmpty) {
            return const Center(child: Text('لا توجد سجلات.'));
          }
          return ListView.builder(
            padding: const EdgeInsets.all(12),
            itemCount: docs.length,
            itemBuilder: (context, index) {
              final doc = docs[index];
              return Card(
                child: ListTile(
                  title: Text(
                    doc.id,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  subtitle: Text(preview(doc.data())),
                  isThreeLine: true,
                ),
              );
            },
          );
        },
      ),
    );
  }
}
