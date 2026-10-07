import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

class MysteriousOffer {
  const MysteriousOffer({
    required this.days,
    required this.coinPrice,
    required this.idChanges,
  });

  final int days;
  final int coinPrice;
  final int idChanges;

  factory MysteriousOffer.fromJson(Map<String, dynamic> json) => MysteriousOffer(
        days: (json['days'] as num?)?.toInt() ?? 0,
        coinPrice: (json['coinPrice'] as num?)?.toInt() ?? 0,
        idChanges: (json['idChanges'] as num?)?.toInt() ?? 0,
      );
}

class MysteriousPersonState {
  const MysteriousPersonState({
    required this.active,
    required this.enabled,
    required this.permanent,
    required this.expiresAtMs,
    required this.remainingMs,
    required this.mysteriousId,
    required this.idChangesRemaining,
    required this.serverNowMs,
    required this.offers,
    this.coins,
  });

  final bool active;
  final bool enabled;
  final bool permanent;
  final int expiresAtMs;
  final int remainingMs;
  final String mysteriousId;
  final int idChangesRemaining;
  final int serverNowMs;
  final List<MysteriousOffer> offers;
  final int? coins;

  factory MysteriousPersonState.fromJson(Map<String, dynamic> json) {
    int value(String key) =>
        (json[key] as num?)?.toInt() ??
        int.tryParse((json[key] ?? '').toString()) ??
        0;
    final rawOffers = json['offers'];
    return MysteriousPersonState(
      active: json['active'] == true,
      enabled: json['enabled'] == true,
      permanent: json['permanent'] == true,
      expiresAtMs: value('expiresAtMs'),
      remainingMs: value('remainingMs'),
      mysteriousId: (json['mysteriousId'] ?? '').toString().trim(),
      idChangesRemaining: value('idChangesRemaining'),
      serverNowMs: value('serverNowMs'),
      offers: rawOffers is List
          ? rawOffers
              .whereType<Map>()
              .map(
                (item) => MysteriousOffer.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .where((item) => item.days > 0 && item.coinPrice > 0)
              .toList(growable: false)
          : const <MysteriousOffer>[],
      coins: json['coins'] == null ? null : value('coins'),
    );
  }
}

class MysteriousPersonService {
  MysteriousPersonService({
    FirebaseAuth? auth,
    http.Client? client,
    String? baseUrl,
  })  : _auth = auth ?? FirebaseAuth.instance,
        _client = client ?? http.Client(),
        _ownsClient = client == null,
        _baseUrl = baseUrl ??
            const String.fromEnvironment(
              'SHADOW_CLOUDFLARE_API_BASE_URL',
              defaultValue:
                  'https://shadow-live.ashraf-business-440.workers.dev/api',
            );

  final FirebaseAuth _auth;
  final http.Client _client;
  final bool _ownsClient;
  final String _baseUrl;

  Future<String> _token() async {
    final user = _auth.currentUser;
    if (user == null || user.isAnonymous) {
      throw StateError('account_required');
    }
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  String _operationKey(String action) {
    final uid = (_auth.currentUser?.uid ?? 'user')
        .replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_');
    return 'myst_${action}_${DateTime.now().microsecondsSinceEpoch}_${uid.hashCode.abs()}';
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _token();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/mysterious-person'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 15));

    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw StateError(
        (body['code'] ?? 'mysterious_person_failed').toString(),
      );
    }
    return body;
  }

  Future<MysteriousPersonState> loadState() async =>
      MysteriousPersonState.fromJson(await _post({'action': 'state'}));

  Future<MysteriousPersonState> purchase(int days) async =>
      MysteriousPersonState.fromJson(
        await _post({
          'action': 'purchase',
          'days': days,
          'idempotencyKey': _operationKey('buy_$days'),
        }),
      );

  Future<MysteriousPersonState> setEnabled(bool enabled) async =>
      MysteriousPersonState.fromJson(
        await _post({'action': 'setEnabled', 'enabled': enabled}),
      );

  Future<MysteriousPersonState> changeId() async =>
      MysteriousPersonState.fromJson(
        await _post({
          'action': 'changeId',
          'idempotencyKey': _operationKey('change_id'),
        }),
      );

  void close() {
    if (_ownsClient) _client.close();
  }
}
