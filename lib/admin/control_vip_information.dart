
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class VipInformationControlPage extends StatefulWidget {
  const VipInformationControlPage({super.key});

  @override
  State<VipInformationControlPage> createState() =>
      _VipInformationControlPageState();
}

class _VipInformationControlPageState
    extends State<VipInformationControlPage> {
  bool _loading = true;
  bool _saving = false;
  String? _error;
  int _purchaseGrowthPerCoin = 3;
  final List<_VipOfferDraft> _offers = <_VipOfferDraft>[];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    for (final offer in _offers) {
      offer.dispose();
    }
    super.dispose();
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final user = controlAuth.currentUser;
    if (user == null) throw const _VipInfoControlError('unauthorized');
    final token = await user.getIdToken().timeout(const Duration(seconds: 12));
    if (token == null || token.isEmpty) {
      throw const _VipInfoControlError('unauthorized');
    }
    final response = await http
        .post(
          shadowApiEndpoint('manage-vip-information'),
          headers: <String, String>{
            'Authorization': 'Bearer $token',
            'Content-Type': 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 25));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : Map<String, dynamic>.from(jsonDecode(response.body) as Map);
    if (response.statusCode != 200 || body['ok'] != true) {
      throw _VipInfoControlError(
        (body['code'] ?? 'request_failed').toString(),
      );
    }
    return body;
  }

  String _message(String code) => switch (code) {
        'forbidden' => 'لا تملك صلاحية إدارة إعدادات VIP.',
        'recent_auth_required' =>
          'يلزم تسجيل دخول إداري حديث قبل تعديل عروض VIP.',
        'invalid_vip_quick_offers' => 'تحقق من بيانات العروض.',
        'invalid_request' => 'طلب غير صالح.',
        'unauthorized' => 'الجلسة الإدارية غير صالحة.',
        _ => 'تعذر تنفيذ العملية: $code',
      };

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final body = await _post(<String, dynamic>{'action': 'state'});
      final ratio =
          int.tryParse('${body['purchasedGrowthPerCoin'] ?? 3}') ?? 3;
      final raw = body['quickPurchaseOffers'];
      final loaded = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => _VipOfferDraft.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : <_VipOfferDraft>[];
      if (!mounted) {
        for (final row in loaded) {
          row.dispose();
        }
        return;
      }
      for (final row in _offers) {
        row.dispose();
      }
      setState(() {
        _purchaseGrowthPerCoin = ratio.clamp(1, 100);
        _offers
          ..clear()
          ..addAll(loaded);
      });
    } on _VipInfoControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر تحميل إعدادات عروض VIP.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _addOffer() {
    if (_offers.length >= 8) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الحد الأعلى 8 عروض سريعة.')),
      );
      return;
    }
    setState(() {
      _offers.add(
        _VipOfferDraft.empty(sortOrder: _offers.length),
      );
    });
  }

  void _removeOffer(int index) {
    final row = _offers.removeAt(index);
    row.dispose();
    setState(() {});
  }

  int? _positiveInt(TextEditingController controller) {
    final value = int.tryParse(controller.text.trim());
    return value != null && value > 0 ? value : null;
  }

  Future<void> _save() async {
    if (_saving) return;
    final output = <Map<String, dynamic>>[];
    for (var index = 0; index < _offers.length; index++) {
      final row = _offers[index];
      final id = row.id.text.trim();
      final label = row.label.text.trim();
      final growth = _positiveInt(row.growth);
      final baseCoins = _positiveInt(row.baseCoins);
      if (!RegExp(r'^[a-z0-9][a-z0-9_-]{1,39}$').hasMatch(id)) {
        setState(() => _error =
            'العرض رقم ${index + 1}: ID مطلوب بصيغة a-z / 0-9 / _ / -.');
        return;
      }
      if (growth == null ||
          growth % _purchaseGrowthPerCoin != 0 ||
          baseCoins == null) {
        setState(() => _error =
            'العرض رقم ${index + 1}: Growth يجب أن يقبل القسمة على النسبة الحالية، والأسعار أكبر من صفر.');
        return;
      }
      final finalCoins = growth ~/ _purchaseGrowthPerCoin;
      if (baseCoins < finalCoins) {
        setState(() => _error =
            'العرض رقم ${index + 1}: السعر المرجعي لا يمكن أن يكون أقل من السعر الفعلي ${finalCoins.toString()}.');
        return;
      }
      output.add(<String, dynamic>{
        'id': id,
        'labelAr': label,
        'growthPoints': growth,
        'baseCoinCost': baseCoins,
        'enabled': row.enabled,
        'sortOrder': index,
      });
    }

    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _post(<String, dynamic>{
        'action': 'saveQuickOffers',
        'quickPurchaseOffers': output,
        'idempotencyKey':
            'vip_info_${DateTime.now().microsecondsSinceEpoch}',
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم حفظ عروض VIP وتسجيل العملية في Audit Log.'),
        ),
      );
      await _load();
    } on _VipInfoControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر حفظ عروض VIP.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _offerCard(int index, _VipOfferDraft row) {
    final growth = _positiveInt(row.growth) ?? 0;
    final finalCoins = _purchaseGrowthPerCoin > 0
        ? growth ~/ _purchaseGrowthPerCoin
        : 0;
    return Card(
      key: ValueKey<String>('vip-offer-$index'),
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    'عرض ${index + 1}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 17,
                    ),
                  ),
                ),
                Switch(
                  value: row.enabled,
                  onChanged: _saving
                      ? null
                      : (value) => setState(() => row.enabled = value),
                ),
                IconButton(
                  tooltip: 'حذف',
                  onPressed: _saving ? null : () => _removeOffer(index),
                  icon: const Icon(Icons.delete_outline),
                ),
              ],
            ),
            const SizedBox(height: 8),
            TextField(
              controller: row.id,
              enabled: !_saving,
              decoration: const InputDecoration(
                labelText: 'ID ثابت — مثال vip_fast_1',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: row.label,
              enabled: !_saving,
              maxLength: 60,
              decoration: const InputDecoration(
                labelText: 'اسم العرض بالعربي',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: row.growth,
                    enabled: !_saving,
                    keyboardType: TextInputType.number,
                    onChanged: (_) => setState(() {}),
                    decoration: const InputDecoration(
                      labelText: 'Growth Points',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: TextField(
                    controller: row.baseCoins,
                    enabled: !_saving,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: 'السعر المرجعي Coins',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                'السعر الفعلي Server-side: $finalCoins Coins '
                '(1 Coin = $_purchaseGrowthPerCoin Growth)',
                style: const TextStyle(
                  color: Color(0xFFFFD98A),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          appBar: AppBar(title: const Text('عروض VIP السريعة')),
          body: _loading
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  padding: const EdgeInsets.all(16),
                  children: <Widget>[
                    const Text(
                      'VIP Information Center — Quick Offers',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'النسبة الحية الحالية: 1 Coin = '
                      '$_purchaseGrowthPerCoin Growth. '
                      'السعر الفعلي يُحسب على السيرفر ولا تثق الواجهة بسعر مرسل.',
                      style: const TextStyle(color: Colors.white60),
                    ),
                    const SizedBox(height: 12),
                    if (_error != null)
                      Card(
                        color: const Color(0xFF2A1015),
                        child: ListTile(
                          leading: const Icon(
                            Icons.error_outline,
                            color: Colors.orangeAccent,
                          ),
                          title: Text(
                            _error!,
                            style: const TextStyle(
                              color: Colors.orangeAccent,
                            ),
                          ),
                        ),
                      ),
                    ...List<Widget>.generate(
                      _offers.length,
                      (index) => _offerCard(index, _offers[index]),
                    ),
                    OutlinedButton.icon(
                      onPressed:
                          _saving || _offers.length >= 8 ? null : _addOffer,
                      icon: const Icon(Icons.add),
                      label: const Text('إضافة عرض'),
                    ),
                    const SizedBox(height: 10),
                    FilledButton.icon(
                      key: const Key('vip-save-quick-offers'),
                      onPressed: _saving ? null : _save,
                      icon: const Icon(Icons.save_outlined),
                      label: Text(_saving ? 'جارٍ الحفظ...' : 'حفظ العروض'),
                    ),
                    const SizedBox(height: 10),
                    const Card(
                      child: ListTile(
                        leading: Icon(
                          Icons.security_outlined,
                          color: Color(0xFFD7B85A),
                        ),
                        title: Text('Server-authoritative'),
                        subtitle: Text(
                          'حتى 8 عروض فقط، مع Recent Auth + Audit + Idempotency. '
                          'لا توجد كتابة Firestore مباشرة أو Listener من لوحة التحكم.',
                        ),
                      ),
                    ),
                  ],
                ),
        ),
      );
}

class _VipOfferDraft {
  _VipOfferDraft({
    required this.id,
    required this.label,
    required this.growth,
    required this.baseCoins,
    required this.enabled,
  });

  final TextEditingController id;
  final TextEditingController label;
  final TextEditingController growth;
  final TextEditingController baseCoins;
  bool enabled;

  factory _VipOfferDraft.empty({required int sortOrder}) => _VipOfferDraft(
        id: TextEditingController(text: 'vip_offer_${sortOrder + 1}'),
        label: TextEditingController(),
        growth: TextEditingController(),
        baseCoins: TextEditingController(),
        enabled: true,
      );

  factory _VipOfferDraft.fromJson(Map<String, dynamic> json) => _VipOfferDraft(
        id: TextEditingController(text: '${json['id'] ?? ''}'),
        label: TextEditingController(text: '${json['labelAr'] ?? ''}'),
        growth: TextEditingController(
          text: '${json['growthPoints'] ?? ''}',
        ),
        baseCoins: TextEditingController(
          text: '${json['baseCoinCost'] ?? ''}',
        ),
        enabled: json['enabled'] != false,
      );

  void dispose() {
    id.dispose();
    label.dispose();
    growth.dispose();
    baseCoins.dispose();
  }
}

class _VipInfoControlError implements Exception {
  const _VipInfoControlError(this.code);
  final String code;
}
