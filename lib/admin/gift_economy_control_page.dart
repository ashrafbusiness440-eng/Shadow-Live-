import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class GiftEconomyControlPage extends StatefulWidget {
  const GiftEconomyControlPage({super.key});

  @override
  State<GiftEconomyControlPage> createState() =>
      _GiftEconomyControlPageState();
}

class _GiftEconomyControlPageState extends State<GiftEconomyControlPage> {
  bool loading = true;
  bool saving = false;
  bool enabled = false;
  double recipientPercent = 0;
  String? error;

  Uri get apiUri => Uri(
        scheme: Uri.base.scheme,
        host: Uri.base.host,
        port: Uri.base.hasPort ? Uri.base.port : null,
        path: '/api/gift-economy-config',
      );

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw StateError('يجب تسجيل الدخول.');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) {
      throw StateError('تعذر قراءة جلسة الإدارة.');
    }

    final response = await http
        .post(
          apiUri,
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
    setState(() {
      loading = true;
      error = null;
    });
    try {
      final body = await post({'action': 'state'});
      final config = body['config'] is Map
          ? Map<String, dynamic>.from(body['config'] as Map)
          : <String, dynamic>{};
      final bps = (config['recipientShareBps'] as num?)?.toInt() ?? 0;
      if (!mounted) return;
      setState(() {
        enabled = config['enabled'] == true;
        recipientPercent = (bps / 100).clamp(0, 100).toDouble();
        loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        error = e.toString();
        loading = false;
      });
    }
  }

  Future<void> save() async {
    setState(() => saving = true);
    try {
      await post({
        'action': 'save',
        'enabled': enabled,
        'recipientShareBps': (recipientPercent * 100).round(),
      });
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم حفظ سياسة أرباح الهدايا.')),
      );
      await load();
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر الحفظ: ' + e.toString())),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final shareExample = (10000 * recipientPercent / 100).floor();
    final diamondsExample = shareExample ~/ 10000;
    final remainderExample = shareExample % 10000;

    return Scaffold(
      appBar: AppBar(
        title: const Text('سياسة أرباح الهدايا'),
        actions: [
          IconButton(
            onPressed: loading ? null : load,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                const Card(
                  child: ListTile(
                    leading: Icon(
                      Icons.diamond_rounded,
                      color: Color(0xFFD7B85A),
                    ),
                    title: Text(
                      'تحويل أرباح الهدايا إلى Diamonds',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: Text(
                      '1 Diamond = 10,000 Coins. الجزء غير المكتمل يُحفظ كرصد Pending حتى يكتمل Diamond كامل، بدون خسارة كسور القيمة.',
                    ),
                  ),
                ),
                SwitchListTile(
                  value: enabled,
                  onChanged: (value) => setState(() => enabled = value),
                  title: const Text('تفعيل تحويل أرباح المستلم إلى Diamonds'),
                  subtitle: const Text(
                    'يبقى معطلًا إلى أن يحدد Owner النسبة النهائية المعتمدة.',
                  ),
                ),
                const SizedBox(height: 10),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          'حصة المستلم: ' +
                              recipientPercent.toStringAsFixed(2) +
                              '%',
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Slider(
                          value: recipientPercent,
                          min: 0,
                          max: 100,
                          divisions: 1000,
                          label:
                              recipientPercent.toStringAsFixed(1) + '%',
                          onChanged: enabled
                              ? (value) =>
                                  setState(() => recipientPercent = value)
                              : null,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'مثال هدية 10,000 Coins → حصة المستلم ' +
                              shareExample.toString() +
                              ' Coins → ' +
                              diamondsExample.toString() +
                              ' Diamond + ' +
                              remainderExample.toString() +
                              ' Coins Pending.',
                          style: const TextStyle(
                            color: Color(0xFFAAA3B8),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                if (error != null) ...[
                  const SizedBox(height: 10),
                  Text(
                    error!,
                    style: const TextStyle(color: Colors.orangeAccent),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton.icon(
                  onPressed: saving ? null : save,
                  icon: saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.save_rounded),
                  label: Text(saving ? 'جار الحفظ...' : 'حفظ السياسة'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              ],
            ),
    );
  }
}
