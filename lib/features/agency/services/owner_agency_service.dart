import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class OwnerAgencyWallet {
  const OwnerAgencyWallet({
    required this.diamonds,
    required this.remainderCoins,
    required this.lifetimeDiamonds,
  });

  final int diamonds;
  final int remainderCoins;
  final int lifetimeDiamonds;

  factory OwnerAgencyWallet.fromJson(Map<String, dynamic> json) {
    return OwnerAgencyWallet(
      diamonds: _int(json['diamonds']),
      remainderCoins: _int(json['remainderCoins']),
      lifetimeDiamonds: _int(json['lifetimeDiamonds']),
    );
  }
}

class OwnerAgencyBonus {
  const OwnerAgencyBonus({
    required this.eligible,
    required this.requiredActiveHosts,
    required this.bps,
    required this.estimatedCoins,
    required this.deferredToMonthEnd,
  });

  final bool eligible;
  final int requiredActiveHosts;
  final int bps;
  final int estimatedCoins;
  final bool deferredToMonthEnd;

  factory OwnerAgencyBonus.fromJson(Map<String, dynamic> json) {
    return OwnerAgencyBonus(
      eligible: json['eligible'] == true,
      requiredActiveHosts: _int(json['requiredActiveHosts']),
      bps: _int(json['bps']),
      estimatedCoins: _int(json['estimatedCoins']),
      deferredToMonthEnd: json['deferredToMonthEnd'] == true,
    );
  }
}

class OwnerAgencyPerformance {
  const OwnerAgencyPerformance({
    required this.month,
    required this.supportCoins,
    required this.hostShareCoins,
    required this.agencyBaseShareCoins,
    required this.platformShareCoins,
    required this.giftCount,
    required this.activeHostCount,
    required this.bonus,
    required this.wallet,
  });

  final String month;
  final int supportCoins;
  final int hostShareCoins;
  final int agencyBaseShareCoins;
  final int platformShareCoins;
  final int giftCount;
  final int activeHostCount;
  final OwnerAgencyBonus bonus;
  final OwnerAgencyWallet wallet;

  int get estimatedAgencyPayableCoins =>
      agencyBaseShareCoins + bonus.estimatedCoins;

  factory OwnerAgencyPerformance.fromJson(Map<String, dynamic> json) {
    final bonus = json['bonus'];
    final wallet = json['wallet'];
    if (bonus is! Map || wallet is! Map) {
      throw const FormatException('invalid_owner_agency_performance');
    }
    return OwnerAgencyPerformance(
      month: (json['month'] ?? '').toString(),
      supportCoins: _int(json['supportCoins']),
      hostShareCoins: _int(json['hostShareCoins']),
      agencyBaseShareCoins: _int(json['agencyBaseShareCoins']),
      platformShareCoins: _int(json['platformShareCoins']),
      giftCount: _int(json['giftCount']),
      activeHostCount: _int(json['activeHostCount']),
      bonus: OwnerAgencyBonus.fromJson(Map<String, dynamic>.from(bonus)),
      wallet: OwnerAgencyWallet.fromJson(Map<String, dynamic>.from(wallet)),
    );
  }
}

class OwnerAgencyPerformanceData {
  const OwnerAgencyPerformanceData({
    required this.agencyId,
    required this.current,
    required this.coinsPerDiamond,
    required this.policySource,
  });

  final String agencyId;
  final OwnerAgencyPerformance current;
  final int coinsPerDiamond;
  final String policySource;

  factory OwnerAgencyPerformanceData.fromJson(Map<String, dynamic> json) {
    final current = json['current'];
    final policy = json['policy'];
    if (current is! Map || policy is! Map) {
      throw const FormatException('invalid_owner_agency_performance');
    }
    return OwnerAgencyPerformanceData(
      agencyId: (json['agencyId'] ?? '').toString(),
      current: OwnerAgencyPerformance.fromJson(
        Map<String, dynamic>.from(current),
      ),
      coinsPerDiamond: _int(policy['coinsPerDiamond']),
      policySource: (policy['source'] ?? 'global').toString(),
    );
  }
}

class OwnerAgencyStatement {
  const OwnerAgencyStatement({
    required this.month,
    required this.settled,
    required this.supportCoins,
    required this.agencyBaseShareCoins,
    required this.agencyBonusCoins,
    required this.agencyPayableCoins,
    required this.agencyDiamonds,
    required this.agencyRemainderCoins,
    required this.activeHostCount,
    required this.requiredActiveHosts,
    required this.bonusEligible,
    required this.bonusBps,
    required this.giftCount,
  });

  final String month;
  final bool settled;
  final int supportCoins;
  final int agencyBaseShareCoins;
  final int agencyBonusCoins;
  final int agencyPayableCoins;
  final int agencyDiamonds;
  final int agencyRemainderCoins;
  final int activeHostCount;
  final int requiredActiveHosts;
  final bool bonusEligible;
  final int bonusBps;
  final int giftCount;

  factory OwnerAgencyStatement.fromJson(Map<String, dynamic> json) {
    final settled = json['settled'] == true;
    final statement = json['statement'];
    final data = statement is Map
        ? Map<String, dynamic>.from(statement)
        : const <String, dynamic>{};
    return OwnerAgencyStatement(
      month: (json['month'] ?? '').toString(),
      settled: settled,
      supportCoins: _int(data['supportCoins']),
      agencyBaseShareCoins: _int(data['agencyBaseShareCoins']),
      agencyBonusCoins: _int(data['agencyBonusCoins']),
      agencyPayableCoins: _int(data['agencyPayableCoins']),
      agencyDiamonds: _int(data['agencyDiamonds']),
      agencyRemainderCoins: _int(data['agencyRemainderCoins']),
      activeHostCount: _int(data['activeHostCount']),
      requiredActiveHosts: _int(data['requiredActiveHosts']),
      bonusEligible: data['bonusEligible'] == true,
      bonusBps: _int(data['bonusBps']),
      giftCount: _int(data['giftCount']),
    );
  }
}

class OwnerAgencyService {
  OwnerAgencyService({
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

  Future<Map<String, dynamic>> _post(Map<String, dynamic> body) async {
    final token = await _token();
    final response = await _client.post(
      Uri.parse('$_baseUrl/agency-owner'),
      headers: {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
      },
      body: jsonEncode(body),
    );
    Map<String, dynamic> decoded = const {};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) decoded = Map<String, dynamic>.from(value);
    } catch (_) {}
    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError(
        (decoded['code'] ?? 'agency_owner_load_failed').toString(),
      );
    }
    return decoded;
  }

  Future<OwnerAgencyPerformanceData> loadPerformance() async {
    final body = await _post(const {'action': 'performance'});
    return OwnerAgencyPerformanceData.fromJson(body);
  }

  Future<OwnerAgencyStatement> loadStatement(String month) async {
    final body = await _post({
      'action': 'statement',
      'month': month.trim(),
    });
    return OwnerAgencyStatement.fromJson(body);
  }

  void close() {
    if (_ownsClient) _client.close();
  }
}

int _int(dynamic value) {
  final n = value is num ? value.toInt() : int.tryParse('$value') ?? 0;
  return n < 0 ? 0 : n;
}
