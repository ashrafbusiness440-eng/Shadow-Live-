import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class VipSummaryData {
  const VipSummaryData({
    required this.effectiveVipLevel,
    required this.effectiveVipSource,
    required this.earnedVipLevel,
    required this.adminGrantVipLevel,
    required this.growthPoints,
    required this.maintenancePoints,
    required this.maintenanceRequired,
    required this.remainingToNext,
    required this.maxGrowthPoints,
    required this.earnedVipExpiresAtMs,
    required this.adminGrantExpiresAtMs,
    required this.coins,
    required this.purchaseGrowthPerCoin,
    required this.paidRechargeGrowthPerCoin,
  });

  final int effectiveVipLevel;
  final String effectiveVipSource;
  final int earnedVipLevel;
  final int adminGrantVipLevel;
  final int growthPoints;
  final int maintenancePoints;
  final int maintenanceRequired;
  final int remainingToNext;
  final int maxGrowthPoints;
  final int earnedVipExpiresAtMs;
  final int adminGrantExpiresAtMs;
  final int coins;
  final int purchaseGrowthPerCoin;
  final int paidRechargeGrowthPerCoin;

  factory VipSummaryData.fromJson(Map<String, dynamic> json) {
    int value(String key) {
      final raw = json[key];
      if (raw is num) return raw.toInt();
      return int.tryParse(raw?.toString() ?? '') ?? 0;
    }

    return VipSummaryData(
      effectiveVipLevel: value('effectiveVipLevel').clamp(0, 10).toInt(),
      effectiveVipSource:
          (json['effectiveVipSource'] ?? 'none').toString().trim(),
      earnedVipLevel: value('earnedVipLevel').clamp(0, 10).toInt(),
      adminGrantVipLevel: value('adminGrantVipLevel').clamp(0, 10).toInt(),
      growthPoints: value('growthPoints'),
      maintenancePoints: value('maintenancePoints'),
      maintenanceRequired: value('maintenanceRequired'),
      remainingToNext: value('remainingToNext'),
      maxGrowthPoints: value('maxGrowthPoints'),
      earnedVipExpiresAtMs: value('earnedVipExpiresAtMs'),
      adminGrantExpiresAtMs: value('adminGrantExpiresAtMs'),
      coins: value('coins'),
      purchaseGrowthPerCoin: value('purchaseGrowthPerCoin'),
      paidRechargeGrowthPerCoin: value('paidRechargeGrowthPerCoin'),
    );
  }
}

class VipService {
  VipService({
    http.Client? client,
    FirebaseAuth? auth,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _ownsClient = client == null,
        _auth = auth ?? FirebaseAuth.instance,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final http.Client _client;
  final bool _ownsClient;
  final FirebaseAuth _auth;
  final String _baseUrl;

  Future<String> _token() async {
    final token = await _auth.currentUser?.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/vip'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(payload),
    );
    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}
    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError((body['code'] ?? 'vip_request_failed').toString());
    }
    return body;
  }

  Future<VipSummaryData> loadSummary() async {
    return VipSummaryData.fromJson(await _post({'action': 'summary'}));
  }

  Future<VipSummaryData> buyGrowth({
    required int growthPoints,
    required String idempotencyKey,
  }) async {
    final body = await _post({
      'action': 'buyGrowth',
      'growthPoints': growthPoints,
      'idempotencyKey': idempotencyKey,
    });
    final vip = body['vip'];
    if (vip is! Map) throw const FormatException('invalid_vip_summary');
    return VipSummaryData.fromJson(Map<String, dynamic>.from(vip));
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}
