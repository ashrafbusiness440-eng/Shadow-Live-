import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

class GameCatalogEntry {
  const GameCatalogEntry({
    required this.key,
    required this.gameId,
    required this.mode,
    required this.label,
    required this.targetRtpBps,
    required this.bets,
  });

  final String key;
  final String gameId;
  final String mode;
  final String label;
  final int targetRtpBps;
  final List<int> bets;

  factory GameCatalogEntry.fromJson(Map<String, dynamic> json) =>
      GameCatalogEntry(
        key: (json['key'] ?? '').toString(),
        gameId: (json['gameId'] ?? '').toString(),
        mode: (json['mode'] ?? '').toString(),
        label: (json['label'] ?? '').toString(),
        targetRtpBps: (json['targetRtpBps'] as num?)?.toInt() ?? 0,
        bets: json['bets'] is List
            ? (json['bets'] as List)
                .map((value) => (value as num).toInt())
                .toList(growable: false)
            : const [],
      );
}

class GameRuntimeState {
  const GameRuntimeState({
    required this.gameId,
    required this.mode,
    required this.serverNowMs,
    required this.bets,
    required this.round,
    required this.currentRoundSelections,
    required this.lastResult,
  });

  final String gameId;
  final String mode;
  final int serverNowMs;
  final List<int> bets;
  final Map<String, dynamic>? round;
  final Map<String, int> currentRoundSelections;
  final Map<String, dynamic>? lastResult;

  factory GameRuntimeState.fromJson(Map<String, dynamic> json) {
    final totals = <String, int>{};
    final raw = json['currentRoundSelections'];
    if (raw is List) {
      for (final item in raw.whereType<Map>()) {
        final id = (item['choiceId'] ?? '').toString();
        final amount = (item['amountCoins'] as num?)?.toInt() ?? 0;
        if (id.isNotEmpty && amount > 0) totals[id] = amount;
      }
    }
    return GameRuntimeState(
      gameId: (json['gameId'] ?? '').toString(),
      mode: (json['mode'] ?? '').toString(),
      serverNowMs: (json['serverNowMs'] as num?)?.toInt() ?? 0,
      bets: json['bets'] is List
          ? (json['bets'] as List)
              .map((value) => (value as num).toInt())
              .toList(growable: false)
          : const [],
      round: json['round'] is Map
          ? Map<String, dynamic>.from(json['round'] as Map)
          : null,
      currentRoundSelections: totals,
      lastResult: json['lastResult'] is Map
          ? Map<String, dynamic>.from(json['lastResult'] as Map)
          : null,
    );
  }
}

class GameBetResult {
  const GameBetResult({
    required this.status,
    required this.gameId,
    required this.roundId,
    required this.totalStakeCoins,
    required this.payoutCoins,
    required this.balanceAfter,
    required this.outcomeId,
    required this.reels,
  });

  final String status;
  final String gameId;
  final String roundId;
  final int totalStakeCoins;
  final int? payoutCoins;
  final int balanceAfter;
  final String? outcomeId;
  final List<String> reels;

  factory GameBetResult.fromJson(Map<String, dynamic> json) => GameBetResult(
        status: (json['status'] ?? '').toString(),
        gameId: (json['gameId'] ?? '').toString(),
        roundId: (json['roundId'] ?? '').toString(),
        totalStakeCoins: (json['totalStakeCoins'] as num?)?.toInt() ?? 0,
        payoutCoins: json['payoutCoins'] is num
            ? (json['payoutCoins'] as num).toInt()
            : null,
        balanceAfter: (json['balanceAfter'] as num?)?.toInt() ?? 0,
        outcomeId:
            json['outcomeId'] == null ? null : json['outcomeId'].toString(),
        reels: json['reels'] is List
            ? (json['reels'] as List)
                .map((value) => value.toString())
                .toList(growable: false)
            : const [],
      );
}

class GameRuntimeService {
  GameRuntimeService({
    http.Client? client,
    String? baseUrl,
  })  : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? _defaultBaseUrl();

  final http.Client _client;
  final String _baseUrl;
  int _counter = 0;

  static String _defaultBaseUrl() {
    const configured = String.fromEnvironment('SHADOW_API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    if (kIsWeb) return '${Uri.base.origin}/api';
    return 'https://shadow-live-six.vercel.app/api';
  }

  Future<String> _token() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) throw StateError('account_required');
    final token = await user.getIdToken();
    if (token == null || token.isEmpty) throw StateError('not_signed_in');
    return token;
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final token = await _token();
    final response = await _client
        .post(
          Uri.parse('$_baseUrl/game-runtime'),
          headers: {
            'authorization': 'Bearer $token',
            'content-type': 'application/json',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 20));

    Map<String, dynamic> decoded = <String, dynamic>{};
    try {
      final value = jsonDecode(response.body);
      if (value is Map) decoded = Map<String, dynamic>.from(value);
    } catch (_) {}

    if (response.statusCode != 200 || decoded['ok'] != true) {
      throw StateError((decoded['code'] ?? 'game_request_failed').toString());
    }
    return decoded;
  }

  Future<List<GameCatalogEntry>> loadCatalog() async {
    final body = await _post({'action': 'catalog'});
    final raw = body['items'];
    if (raw is! List) return const [];
    return raw
        .whereType<Map>()
        .map((item) => GameCatalogEntry.fromJson(
              Map<String, dynamic>.from(item),
            ))
        .where((item) => item.key.isNotEmpty && item.bets.isNotEmpty)
        .toList(growable: false);
  }

  Future<GameRuntimeState> loadState(GameCatalogEntry game) async {
    final body = await _post({
      'action': 'state',
      'gameId': game.gameId,
      if (game.mode.isNotEmpty) 'mode': game.mode,
    });
    return GameRuntimeState.fromJson(body);
  }

  Future<GameBetResult> placeBet({
    required GameCatalogEntry game,
    required String roomId,
    required int amountCoins,
    String? choiceId,
  }) async {
    final uid = FirebaseAuth.instance.currentUser?.uid ?? 'user';
    _counter++;
    final key =
        'game_${uid.replaceAll(RegExp(r'[^A-Za-z0-9_-]'), '_')}_'
        '${DateTime.now().microsecondsSinceEpoch}_$_counter';
    final bet = game.gameId == 'slot'
        ? <String, dynamic>{'amountCoins': amountCoins}
        : <String, dynamic>{
            'choiceId': choiceId,
            'amountCoins': amountCoins,
          };
    final body = await _post({
      'action': 'placeBet',
      'gameId': game.gameId,
      if (game.mode.isNotEmpty) 'mode': game.mode,
      'roomId': roomId,
      'idempotencyKey': key,
      'bets': [bet],
    });
    return GameBetResult.fromJson(body);
  }

  void close() => _client.close();
}
