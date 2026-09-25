import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

typedef RoomRocketPost = Future<Map<String, dynamic>> Function(
  Map<String, dynamic> payload,
);

class RoomRocketControlPage extends StatefulWidget {
  const RoomRocketControlPage({super.key, this.postOverride});

  final RoomRocketPost? postOverride;

  @override
  State<RoomRocketControlPage> createState() => _RoomRocketControlPageState();
}

class _RocketLevelDraft {
  _RocketLevelDraft({
    required this.level,
    required int thresholdCoins,
    required int winProbabilityBps,
    required List<dynamic> coinPrizes,
    required List<dynamic> frameRewards,
    required List<dynamic> entranceRewards,
    required List<dynamic> voiceWaveRewards,
    required List<dynamic> roomBackgroundRewards,
  })  : threshold = TextEditingController(text: thresholdCoins.toString()),
        winPercent = TextEditingController(
          text: (winProbabilityBps / 100).toStringAsFixed(0),
        ),
        coins = TextEditingController(text: _coinText(coinPrizes)),
        frames = TextEditingController(
          text: _cosmeticText(frameRewards),
        ),
        entrances = TextEditingController(
          text: _cosmeticText(entranceRewards),
        ),
        voiceWaves = TextEditingController(
          text: _cosmeticText(voiceWaveRewards),
        ),
        roomBackgrounds = TextEditingController(
          text: _cosmeticText(roomBackgroundRewards),
        );

  final int level;
  final TextEditingController threshold;
  final TextEditingController winPercent;
  final TextEditingController coins;
  final TextEditingController frames;
  final TextEditingController entrances;
  final TextEditingController voiceWaves;
  final TextEditingController roomBackgrounds;

  static String _coinText(List<dynamic> raw) => raw
      .whereType<Map>()
      .map(
        (item) =>
            '${(item['coins'] as num?)?.toInt() ?? 0}:${(item['weight'] as num?)?.toInt() ?? 0}',
      )
      .join(', ');

  static String _cosmeticText(List<dynamic> raw) => raw
      .whereType<Map>()
      .map((item) {
        final base =
            '${item['id'] ?? ''}|${(item['durationHours'] as num?)?.toInt() ?? 24}|${(item['weight'] as num?)?.toInt() ?? 1}|${(item['overflowCoins'] as num?)?.toInt() ?? 0}';
        final name = (item['nameAr'] ?? '').toString();
        final assetKey = (item['assetKey'] ?? '').toString();
        final imageUrl = (item['imageUrl'] ?? '').toString();
        if (name.isEmpty && assetKey.isEmpty && imageUrl.isEmpty) return base;
        return '$base|$name|$assetKey|$imageUrl';
      })
      .join('\n');

  void dispose() {
    threshold.dispose();
    winPercent.dispose();
    coins.dispose();
    frames.dispose();
    entrances.dispose();
    voiceWaves.dispose();
    roomBackgrounds.dispose();
  }

  List<Map<String, dynamic>> _parseCoins() {
    final result = <Map<String, dynamic>>[];
    for (final part in coins.text.split(',')) {
      final clean = part.trim();
      if (clean.isEmpty) continue;
      final bits = clean.split(':');
      if (bits.length != 2) {
        throw const FormatException('صيغة Coins غير صحيحة');
      }
      final value = int.tryParse(bits[0].trim());
      final weight = int.tryParse(bits[1].trim());
      if (value == null || value <= 0 || weight == null || weight <= 0) {
        throw const FormatException('قيمة أو وزن Coins غير صحيح');
      }
      result.add({'coins': value, 'weight': weight});
    }
    if (result.isEmpty) {
      throw const FormatException('لازم يكون في جائزة Coins واحدة على الأقل');
    }
    return result;
  }

  List<Map<String, dynamic>> _parseCosmetics(
    TextEditingController controller,
  ) {
    final result = <Map<String, dynamic>>[];
    for (final line in controller.text.split('\n')) {
      final clean = line.trim();
      if (clean.isEmpty) continue;
      final bits = clean.split('|');
      if (bits.length < 4 || bits.length > 7) {
        throw const FormatException(
          'الصيغة: id|hours|weight|overflowCoins|nameAr|assetKey|imageUrl',
        );
      }
      final id = bits[0].trim();
      final hours = int.tryParse(bits[1].trim());
      final weight = int.tryParse(bits[2].trim());
      final overflowCoins = int.tryParse(bits[3].trim());
      if (id.isEmpty ||
          hours == null ||
          hours <= 0 ||
          weight == null ||
          weight <= 0 ||
          overflowCoins == null ||
          overflowCoins < 0) {
        throw const FormatException('بيانات الجائزة التجميلية غير صحيحة');
      }
      result.add({
        'id': id,
        'durationHours': hours,
        'weight': weight,
        'overflowCoins': overflowCoins,
        'nameAr': bits.length > 4 ? bits[4].trim() : '',
        'assetKey': bits.length > 5 ? bits[5].trim() : '',
        'imageUrl': bits.length > 6 ? bits[6].trim() : '',
        'enabled': true,
      });
    }
    return result;
  }

  Map<String, dynamic> toPayload() {
    final thresholdCoins = int.tryParse(threshold.text.trim());
    if (thresholdCoins == null || thresholdCoins <= 0) {
      throw FormatException('حد LV.$level غير صحيح');
    }
    final win = double.tryParse(winPercent.text.trim());
    if (win == null || win < 0 || win > 100) {
      throw FormatException('نسبة الفوز في LV.$level غير صحيحة');
    }
    return {
      'id': 'lv$level',
      'level': level,
      'thresholdCoins': thresholdCoins,
      'winProbabilityBps': (win * 100).round(),
      'coinPrizes': _parseCoins(),
      'frameRewards': _parseCosmetics(frames),
      'entranceRewards': _parseCosmetics(entrances),
      'voiceWaveRewards': _parseCosmetics(voiceWaves),
      'roomBackgroundRewards': _parseCosmetics(roomBackgrounds),
    };
  }
}

class _RoomRocketControlPageState extends State<RoomRocketControlPage> {
  bool loading = true;
  bool saving = false;
  bool enabled = true;
  String? error;

  final durationSeconds = TextEditingController(text: '10');
  final stackCapDays = TextEditingController(text: '30');
  final noWinMessage = TextEditingController(text: 'حظ أوفر في المرة القادمة');
  List<_RocketLevelDraft> levels = [];

  Uri get apiUri => shadowEconomyEndpoint('room-rocket-config');

  @override
  void initState() {
    super.initState();
    load();
  }

  @override
  void dispose() {
    durationSeconds.dispose();
    stackCapDays.dispose();
    noWinMessage.dispose();
    for (final level in levels) {
      level.dispose();
    }
    super.dispose();
  }

  Future<Map<String, dynamic>> post(Map<String, dynamic> payload) async {
    final override = widget.postOverride;
    if (override != null) return override(payload);

    final user = controlAuth.currentUser;
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

  void _replaceLevels(List<dynamic> raw) {
    for (final level in levels) {
      level.dispose();
    }
    levels = raw.asMap().entries.map((entry) {
      final item = entry.value is Map
          ? Map<String, dynamic>.from(entry.value as Map)
          : <String, dynamic>{};
      List<dynamic> list(String key) =>
          item[key] is List ? item[key] as List : const [];
      return _RocketLevelDraft(
        level: entry.key + 1,
        thresholdCoins:
            (item['thresholdCoins'] as num?)?.toInt() ?? 100000,
        winProbabilityBps:
            (item['winProbabilityBps'] as num?)?.toInt() ?? 3000,
        coinPrizes: list('coinPrizes'),
        frameRewards: list('frameRewards'),
        entranceRewards: list('entranceRewards'),
        voiceWaveRewards: list('voiceWaveRewards'),
        roomBackgroundRewards: list('roomBackgroundRewards'),
      );
    }).toList(growable: false);
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
      final rawLevels =
          config['levels'] is List ? config['levels'] as List : const [];
      if (!mounted) return;
      _replaceLevels(rawLevels);
      durationSeconds.text =
          ((config['explosionDurationSeconds'] as num?)?.toInt() ?? 10)
              .toString();
      stackCapDays.text =
          ((((config['cosmeticStackCapHours'] as num?)?.toDouble() ?? 720) /
                      24)
                  .round())
              .toString();
      noWinMessage.text =
          (config['noWinMessageAr'] ?? 'حظ أوفر في المرة القادمة').toString();
      setState(() {
        enabled = config['enabled'] != false;
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
      final duration = int.tryParse(durationSeconds.text.trim());
      final capDays = int.tryParse(stackCapDays.text.trim());
      if (duration == null ||
          duration <= 0 ||
          capDays == null ||
          capDays <= 0) {
        throw const FormatException('تحقق من مدة الانفجار ونسبة الفوز والسقف');
      }
      final levelPayload = levels.map((level) => level.toPayload()).toList();
      await post({
        'action': 'save',
        'enabled': enabled,
        'explosionDurationSeconds': duration,
        'cosmeticStackCapHours': capDays * 24,
        'cosmeticDurationHours': const [24, 72, 168],
        'noWinMessageAr': noWinMessage.text.trim(),
        'levels': levelPayload,
      });
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم حفظ إعدادات Room Rocket وتسجيل Audit Log.'),
        ),
      );
      await load();
    } catch (e) {
      if (!mounted) return;
      setState(() => saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر الحفظ: $e')),
      );
    }
  }

  Widget _numberField(
    String label,
    TextEditingController controller, {
    String? suffix,
  }) {
    return SizedBox(
      width: 180,
      child: TextField(
        controller: controller,
        keyboardType: const TextInputType.numberWithOptions(decimal: true),
        decoration: InputDecoration(
          labelText: label,
          suffixText: suffix,
          border: const OutlineInputBorder(),
        ),
      ),
    );
  }

  Widget _poolField(
    String label,
    TextEditingController controller, {
    required String helper,
  }) {
    return TextField(
      controller: controller,
      minLines: 2,
      maxLines: 6,
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 2,
        border: const OutlineInputBorder(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Room Rocket'),
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
                      Icons.rocket_launch_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    title: Text(
                      'صاروخ الغرفة',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    subtitle: Text(
                      'مستقل عن Lucky Gifts • يتغذى من هدايا الروم فقط • كل الجوائز والتوزيع Server-side.',
                    ),
                  ),
                ),
                SwitchListTile(
                  value: enabled,
                  onChanged: (value) => setState(() => enabled = value),
                  title: const Text('تفعيل Room Rocket'),
                ),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  children: [
                    _numberField(
                      'مدة الانفجار',
                      durationSeconds,
                      suffix: 'ث',
                    ),
                    _numberField(
                      'سقف تراكم الجائزة',
                      stackCapDays,
                      suffix: 'يوم',
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: noWinMessage,
                  decoration: const InputDecoration(
                    labelText: 'رسالة عدم الفوز',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                const Text(
                  'المستويات وPrize Pools',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                ...levels.map(
                  (level) => Card(
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'LV.${level.level}',
                            style: const TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w900,
                              color: Color(0xFFFFD54A),
                            ),
                          ),
                          const SizedBox(height: 12),
                          Wrap(
                            spacing: 10,
                            runSpacing: 10,
                            children: [
                              _numberField(
                                'حد الانفجار',
                                level.threshold,
                                suffix: 'Coins',
                              ),
                              _numberField(
                                'احتمال الفوز',
                                level.winPercent,
                                suffix: '%',
                              ),
                            ],
                          ),
                          const SizedBox(height: 12),
                          _poolField(
                            'Coins',
                            level.coins,
                            helper: 'الصيغة: coins:weight, coins:weight',
                          ),
                          const SizedBox(height: 12),
                          _poolField(
                            'Frames',
                            level.frames,
                            helper:
                                'كل سطر: id|hours|weight|overflowCoins',
                          ),
                          const SizedBox(height: 12),
                          _poolField(
                            'Entrance Effects',
                            level.entrances,
                            helper:
                                'كل سطر: id|hours|weight|overflowCoins',
                          ),
                          const SizedBox(height: 12),
                          _poolField(
                            'Voice Waves',
                            level.voiceWaves,
                            helper:
                                'id|hours|weight|overflowCoins|nameAr|assetKey|imageUrl',
                          ),
                          const SizedBox(height: 12),
                          _poolField(
                            'Room Backgrounds',
                            level.roomBackgrounds,
                            helper:
                                'id|hours|weight|overflowCoins|nameAr|assetKey|imageUrl',
                          ),
                        ],
                      ),
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
                  label: Text(saving ? 'جار الحفظ...' : 'حفظ إعدادات الصاروخ'),
                  style: FilledButton.styleFrom(
                    minimumSize: const Size.fromHeight(54),
                  ),
                ),
              ],
            ),
    );
  }
}
