import 'package:flutter/material.dart';

import '../features/games/services/game_runtime_service.dart';
import '../features/games/widgets/room_game_overlay.dart';
import '../features/room/services/room_presence_service.dart';

void main() {
  runApp(const GreedyCatVisualTestApp());
}

class GreedyCatVisualTestApp extends StatelessWidget {
  const GreedyCatVisualTestApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true),
      home: Scaffold(
        backgroundColor: const Color(0xFF03040A),
        body: SafeArea(
          child: Align(
            alignment: Alignment.bottomCenter,
            child: RoomGameOverlaySheet(
              roomId: 'visual-room',
              initialGameKey: 'greedy_cat',
              runtimeService: _VisualGameRuntimeService(),
              realtimeEvents: const Stream<RoomRealtimeEvent>.empty(),
            ),
          ),
        ),
      ),
    );
  }
}

class _VisualGameRuntimeService extends GameRuntimeService {
  static const GameCatalogEntry _greedy = GameCatalogEntry(
    key: 'greedy_cat',
    gameId: 'greedy_cat',
    mode: '',
    label: 'القط الجشع',
    targetRtpBps: 8500,
    bets: [200, 2000, 20000, 200000],
  );

  @override
  Future<List<GameCatalogEntry>> loadCatalog() async => const [_greedy];

  @override
  Future<GameRuntimeState> loadState(
    GameCatalogEntry game, {
    String roomId = '',
  }) async {
    final now = DateTime.now().millisecondsSinceEpoch;
    return GameRuntimeState(
      gameId: 'greedy_cat',
      mode: '',
      serverNowMs: now,
      bets: const [200, 2000, 20000, 200000],
      round: <String, dynamic>{
        'roundId': 'visual:1660',
        'roundNumber': 1660,
        'dayKey': '2026-09-25',
        'opensAtMs': now - 10000,
        'closesAtMs': now + 20000,
        'locked': false,
      },
      currentRoundSelections: const <String, int>{
        'pepper5': 400,
      },
      serverRoundSelections: const <String, int>{
        'fish15': 48000,
        'steak25': 18000,
        'pepper5': 10000,
        'tomato5': 6000,
      },
      lastResult: <String, dynamic>{
        'roundId': 'visual:1659',
        'roundNumber': 1659,
        'outcomeId': 'chicken10',
        'closedAtMs': now - 1000,
      },
      recentResults: List<Map<String, dynamic>>.generate(
        20,
        (index) => <String, dynamic>{
          'roundId': 'visual:${1659 - index}',
          'roundNumber': 1659 - index,
          'outcomeId': const <String>[
            'chicken10',
            'salad',
            'shell45',
            'pizza',
            'fish15',
            'steak25',
            'pepper5',
            'tomato5',
          ][index % 8],
          'closedAtMs': now - ((index + 1) * 30000),
        },
        growable: false,
      ),
    );
  }

  @override
  Future<GameBetResult> placeBet({
    required GameCatalogEntry game,
    required String roomId,
    required int amountCoins,
    String? choiceId,
  }) async {
    return GameBetResult(
      status: 'pending',
      gameId: game.gameId,
      roundId: 'visual:1660',
      totalStakeCoins: amountCoins,
      payoutCoins: null,
      balanceAfter: 9600000 - amountCoins,
      outcomeId: null,
      reels: const [],
    );
  }

  @override
  void close() {}
}
