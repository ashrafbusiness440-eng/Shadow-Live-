import 'package:flutter_test/flutter_test.dart';

import 'package:voice_chat_room/features/games/services/game_runtime_service.dart';

void main() {
  test('catalog entry reads control-defined bet ladder', () {
    final entry = GameCatalogEntry.fromJson({
      'key': 'greedy_cat',
      'gameId': 'greedy_cat',
      'mode': '',
      'label': 'القط الجشع',
      'targetRtpBps': 8500,
      'bets': [500, 5000, 50000],
    });
    expect(entry.key, 'greedy_cat');
    expect(entry.bets, [500, 5000, 50000]);
    expect(entry.targetRtpBps, 8500);
  });

  test('runtime state exposes accumulated user totals per choice', () {
    final state = GameRuntimeState.fromJson({
      'gameId': 'witch',
      'mode': 'normal',
      'serverNowMs': 1000,
      'bets': [1000, 10000],
      'round': {
        'roundId': 'witch:normal:2026-09-23:1',
        'roundNumber': 1,
        'closesAtMs': 30000,
      },
      'currentRoundSelections': [
        {'choiceId': 'book', 'amountCoins': 21000},
        {'choiceId': 'moon', 'amountCoins': 1000},
      ],
      'lastResult': {
        'roundNumber': 0,
        'outcomeId': 'moon',
      },
    });
    expect(state.currentRoundSelections['book'], 21000);
    expect(state.currentRoundSelections['moon'], 1000);
    expect(state.bets, [1000, 10000]);
    expect(state.lastResult?['outcomeId'], 'moon');
  });

  test('slot result parses server reels and payout', () {
    final result = GameBetResult.fromJson({
      'status': 'settled',
      'gameId': 'slot',
      'roundId': 'slot:u:k',
      'totalStakeCoins': 200,
      'payoutCoins': 400,
      'balanceAfter': 1200,
      'outcomeId': 'pair',
      'reels': ['crown', 'crown', 'fire'],
    });
    expect(result.status, 'settled');
    expect(result.payoutCoins, 400);
    expect(result.reels, ['crown', 'crown', 'fire']);
  });
}
