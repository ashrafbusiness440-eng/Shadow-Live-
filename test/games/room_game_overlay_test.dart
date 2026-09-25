import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:voice_chat_room/features/games/game_asset_paths.dart';
import 'package:voice_chat_room/features/games/services/game_runtime_service.dart';
import 'package:voice_chat_room/features/games/widgets/room_game_overlay.dart';
import 'package:voice_chat_room/features/room/services/room_presence_service.dart';

class FakeGameRuntimeService extends GameRuntimeService {
  FakeGameRuntimeService({
    this.failSlotAfter = 999,
    this.roundStatus = 'betting',
    this.betDelay = Duration.zero,
  }) : super(baseUrl: 'http://example.invalid');

  final int failSlotAfter;
  final String roundStatus;
  final Duration betDelay;
  final Map<String, int> totals = <String, int>{};
  int slotCalls = 0;
  final List<int> slotAmounts = <int>[];
  String lastLoadedKey = '';

  final List<GameCatalogEntry> catalog = const [
    GameCatalogEntry(
      key: 'greedy_cat',
      gameId: 'greedy_cat',
      mode: '',
      label: 'القط الجشع',
      targetRtpBps: 8500,
      bets: [200, 2000, 20000, 200000],
    ),
    GameCatalogEntry(
      key: 'witch_normal',
      gameId: 'witch',
      mode: 'normal',
      label: 'الساحرة — عادي',
      targetRtpBps: 8500,
      bets: [100, 1000, 10000, 100000],
    ),
    GameCatalogEntry(
      key: 'witch_advanced',
      gameId: 'witch',
      mode: 'advanced',
      label: 'الساحرة — متقدم',
      targetRtpBps: 8500,
      bets: [200, 2000, 20000, 200000],
    ),
    GameCatalogEntry(
      key: 'slot',
      gameId: 'slot',
      mode: '',
      label: 'Shadow Slot',
      targetRtpBps: 8500,
      bets: [200, 1000, 2000],
    ),
  ];

  @override
  Future<List<GameCatalogEntry>> loadCatalog() async => catalog;

  @override
  Future<GameRuntimeState> loadState(
    GameCatalogEntry game, {
    String roomId = '',
  }) async {
    lastLoadedKey = game.key;
    final now = DateTime.now().millisecondsSinceEpoch;
    final bettingClosesAtMs = roundStatus == 'betting'
        ? now + 22000
        : now - 1000;
    final revealAtMs = roundStatus == 'spinning'
        ? now + 2200
        : roundStatus == 'result_hold'
            ? now - 500
            : now + 25000;
    final resultHoldEndsAtMs =
        roundStatus == 'result_hold' ? now + 3500 : revealAtMs + 4000;
    return GameRuntimeState(
      gameId: game.gameId,
      mode: game.mode,
      serverNowMs: now,
      bets: game.bets,
      round: game.gameId == 'slot'
          ? null
          : <String, dynamic>{
              'roundId': '${game.key}:test:1',
              'roundNumber': 1,
              'dayKey': '2026-09-23',
              'opensAtMs': now - 1000,
              'closesAtMs': revealAtMs,
              'bettingClosesAtMs': bettingClosesAtMs,
              'revealAtMs': revealAtMs,
              'resultHoldEndsAtMs': resultHoldEndsAtMs,
              'nextRoundOpensAtMs': resultHoldEndsAtMs,
              'locked': roundStatus != 'betting',
              'status': roundStatus,
            },
      currentRoundSelections: Map<String, int>.from(totals),
      serverRoundSelections: game.gameId == 'greedy_cat'
          ? const <String, int>{
              'fish15': 42000,
              'steak25': 18000,
              'pepper5': 10000,
              'tomato5': 8000,
            }
          : const <String, int>{},
      lastResult: game.gameId == 'slot'
          ? null
          : <String, dynamic>{
              'roundId': '${game.key}:test:0',
              'roundNumber': 0,
              'outcomeId': game.gameId == 'greedy_cat' ? 'salad' : 'moon',
              'closedAtMs': now - 1000,
            },
      userDailyPayoutCoins:
          game.gameId == 'greedy_cat' ? 126400 : 0,
      recentResults: game.gameId == 'slot'
          ? const []
          : List.generate(
              20,
              (index) => <String, dynamic>{
                'roundId': '${game.key}:test:${-index}',
                'roundNumber': -index,
                'outcomeId': game.gameId == 'greedy_cat'
                    ? const [
                        'shell45',
                        'fish15',
                        'steak25',
                        'pepper5',
                        'tomato5',
                        'carrot5',
                        'cabbage5',
                        'chicken10',
                      ][index % 8]
                    : 'moon',
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
    if (game.gameId == 'slot') {
      slotCalls++;
      slotAmounts.add(amountCoins);
      if (slotCalls >= failSlotAfter) {
        throw StateError('insufficient_balance');
      }
      return GameBetResult(
        status: 'settled',
        gameId: 'slot',
        roundId: 'slot:test:$slotCalls',
        totalStakeCoins: amountCoins,
        payoutCoins: amountCoins * 2,
        balanceAfter: 10000,
        outcomeId: 'pair',
        reels: const ['crown', 'crown', 'fire'],
      );
    }
    final id = choiceId ?? '';
    if (betDelay > Duration.zero) {
      await Future<void>.delayed(betDelay);
    }
    totals[id] = (totals[id] ?? 0) + amountCoins;
    return GameBetResult(
      status: 'pending',
      gameId: game.gameId,
      roundId: '${game.key}:test:1',
      totalStakeCoins: amountCoins,
      payoutCoins: null,
      balanceAfter: 10000,
      outcomeId: null,
      reels: const [],
    );
  }

  @override
  void close() {}
}

class GreedyResultFakeGameRuntimeService extends FakeGameRuntimeService {
  int stateCalls = 0;

  @override
  Future<GameRuntimeState> loadState(
    GameCatalogEntry game, {
    String roomId = '',
  }) async {
    final base = await super.loadState(game, roomId: roomId);
    stateCalls++;
    if (game.gameId != 'greedy_cat' || stateCalls < 2) return base;

    final now = DateTime.now().millisecondsSinceEpoch;
    return GameRuntimeState(
      gameId: base.gameId,
      mode: base.mode,
      serverNowMs: now,
      bets: base.bets,
      round: <String, dynamic>{
        'roundId': 'greedy_cat:test:1',
        'roundNumber': 1,
        'dayKey': '2026-09-25',
        'opensAtMs': now - 30000,
        'closesAtMs': now - 500,
        'bettingClosesAtMs': now - 3500,
        'revealAtMs': now - 500,
        'resultHoldEndsAtMs': now + 3500,
        'nextRoundOpensAtMs': now + 3500,
        'locked': true,
        'status': 'result_hold',
      },
      currentRoundSelections: base.currentRoundSelections,
      serverRoundSelections: base.serverRoundSelections,
      totalRoundStakeCoins: base.totalRoundStakeCoins,
      userDailyPayoutCoins: base.userDailyPayoutCoins,
      lastResult: <String, dynamic>{
        'roundId': 'greedy_cat:test:1',
        'roundNumber': 1,
        'outcomeId': 'fish15',
        'closedAtMs': now - 1000,
        'topWinners': const <Map<String, dynamic>>[
          <String, dynamic>{
            'rank': 1,
            'userId': 'winner_1',
            'displayName': 'Shadow',
            'photoUrl': '',
            'stakeCoins': 2000,
            'payoutCoins': 30000,
            'won': true,
          },
          <String, dynamic>{
            'rank': 2,
            'userId': 'current_user',
            'displayName': 'You',
            'photoUrl': '',
            'stakeCoins': 400,
            'payoutCoins': 20000,
            'won': true,
          },
          <String, dynamic>{
            'rank': 3,
            'userId': 'winner_3',
            'displayName': 'Nova',
            'photoUrl': '',
            'stakeCoins': 2000,
            'payoutCoins': 10000,
            'won': true,
          },
        ],
        'myRound': const <String, dynamic>{
          'userId': 'current_user',
          'displayName': 'You',
          'photoUrl': '',
          'stakeCoins': 400,
          'payoutCoins': 20000,
          'won': true,
          'winnerRank': 2,
        },
      },
      recentResults: <Map<String, dynamic>>[
        <String, dynamic>{
          'roundId': 'greedy_cat:test:1',
          'roundNumber': 1,
          'outcomeId': 'fish15',
          'closedAtMs': now - 1000,
        },
        ...base.recentResults.take(19),
      ],
    );
  }
}

Widget host(
  GameRuntimeService service,
  String gameKey, {
  Stream<RoomRealtimeEvent>? realtimeEvents,
}) =>
    MaterialApp(
      debugShowCheckedModeBanner: false,
      home: Scaffold(
        body: Align(
          alignment: Alignment.bottomCenter,
          child: RoomGameOverlaySheet(
            roomId: 'room_test',
            initialGameKey: gameKey,
            runtimeService: service,
            realtimeEvents: realtimeEvents,
          ),
        ),
      ),
    );

void main() {
  testWidgets('Greedy Cat repeated taps accumulate on the same choice',
      (tester) async {
    final service = FakeGameRuntimeService();
    await tester.pumpWidget(host(service, 'greedy_cat'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('القط الجشع'), findsOneWidget);
    expect(find.text('New'), findsOneWidget);
    expect(find.text('بيتزا'), findsOneWidget);
    expect(find.text('سلطة'), findsOneWidget);
    expect(find.text('🔥🔥'), findsOneWidget);
    expect(find.text('🌐 42K'), findsOneWidget);
    expect(find.text('أرباحك اليوم'), findsOneWidget);
    expect(find.text('126.4K'), findsOneWidget);
    expect(find.text('قيمة الضغطة الحالية'), findsNothing);
    expect(find.byType(GridView), findsNothing);
    final greedyImages = tester.widgetList<Image>(find.byType(Image));
    expect(
      greedyImages.any(
        (image) =>
            image.image is AssetImage &&
            (image.image as AssetImage).assetName ==
                GameAssetPaths.greedyBackground,
      ),
      isTrue,
    );

    await tester.tap(find.text('بيتزا'));
    await tester.tap(find.text('سلطة'));
    await tester.pump(const Duration(milliseconds: 50));
    expect(service.totals.containsKey('pizza'), isFalse);
    expect(service.totals.containsKey('salad'), isFalse);

    final choice = find.text('فلفل  ×5');
    expect(choice, findsOneWidget);

    await tester.tap(choice);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.tap(choice);
    await tester.pump(const Duration(milliseconds: 100));

    expect(service.totals['pepper5'], 400);
    expect(find.text('400'), findsOneWidget);
  });

  testWidgets('Greedy Cat shows server pressure in the same interaction frame',
      (tester) async {
    final service = FakeGameRuntimeService(
      betDelay: const Duration(milliseconds: 450),
    );
    await tester.pumpWidget(host(service, 'greedy_cat'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    final choice = find.text('ملفوف  ×5');
    expect(choice, findsOneWidget);
    await tester.tap(choice);
    await tester.pump(const Duration(milliseconds: 1));

    expect(find.text('🌐 200'), findsOneWidget);
    expect(service.totals['cabbage5'], isNull);

    await tester.pump(const Duration(milliseconds: 500));
    expect(service.totals['cabbage5'], 200);
  });

  testWidgets('Greedy Cat blocks bets while server round is spinning',
      (tester) async {
    final service = FakeGameRuntimeService(roundStatus: 'spinning');
    await tester.pumpWidget(host(service, 'greedy_cat'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 250));

    expect(find.text('جاري الدوران'), findsOneWidget);
    final choice = find.text('فلفل  ×5');
    expect(choice, findsOneWidget);
    await tester.tap(choice);
    await tester.pump(const Duration(milliseconds: 150));
    expect(service.totals, isEmpty);
  });

  testWidgets('Greedy Cat does not poll state after ten seconds',
      (tester) async {
    final service = GreedyResultFakeGameRuntimeService();
    final events = StreamController<RoomRealtimeEvent>.broadcast();
    addTearDown(events.close);

    await tester.pumpWidget(
      host(
        service,
        'greedy_cat',
        realtimeEvents: events.stream,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));

    expect(service.stateCalls, 1);
    await tester.pump(const Duration(seconds: 10));
    await tester.pump(const Duration(milliseconds: 100));
    expect(service.stateCalls, 1);
  });

  testWidgets('Greedy Cat result push triggers one authoritative refresh',
      (tester) async {
    final service = GreedyResultFakeGameRuntimeService();
    final events = StreamController<RoomRealtimeEvent>.broadcast();
    addTearDown(events.close);

    await tester.pumpWidget(
      host(
        service,
        'greedy_cat',
        realtimeEvents: events.stream,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 150));

    expect(service.stateCalls, 1);
    expect(find.textContaining('الأكثر ربحاً'), findsNothing);

    events.add(
      RoomRealtimeEvent(
        type: 'game.result',
        payload: const <String, dynamic>{
          'roomId': 'room_test',
          'gameId': 'greedy_cat',
          'mode': '',
          'roundId': 'greedy_cat:test:1',
          'outcomeId': 'fish15',
        },
        serverTimeMs: DateTime.now().millisecondsSinceEpoch,
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 200));

    expect(service.stateCalls, 2);
    expect(find.text('نتيجة الجولة #1'), findsOneWidget);
    expect(find.text('الأكثر ربحاً في هذه الجولة'), findsOneWidget);
    expect(find.text('Shadow'), findsOneWidget);
    expect(find.text('You'), findsOneWidget);
    expect(find.text('Nova'), findsOneWidget);
    expect(find.text('نتيجتك في هذه الجولة'), findsOneWidget);
    expect(find.textContaining('دفعت بالجولة: 400 Coins'), findsOneWidget);
    expect(find.textContaining('ربحت بالجولة: 20K Coins'), findsOneWidget);
    expect(find.text('حظ أوفر 🍀'), findsNothing);
  });

  testWidgets('Witch switches between Normal and Advanced modes',
      (tester) async {
    final service = FakeGameRuntimeService();
    await tester.pumpWidget(host(service, 'witch'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('عادي'), findsOneWidget);
    expect(find.text('متقدم'), findsOneWidget);
    expect(service.lastLoadedKey, 'witch_normal');

    await tester.tap(find.text('متقدم'));
    await tester.pump(const Duration(milliseconds: 100));

    expect(service.lastLoadedKey, 'witch_advanced');
    expect(find.text('200 Coins'), findsWidgets);
  });

  testWidgets('Slot Auto Play keeps one bet and stops on insufficient balance',
      (tester) async {
    final service = FakeGameRuntimeService(failSlotAfter: 3);
    await tester.pumpWidget(host(service, 'slot'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Shadow Slot'), findsOneWidget);
    final autoButton = find.textContaining('Auto Play • نفس الرهان');
    expect(autoButton, findsOneWidget);

    await tester.tap(autoButton);
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 950));
    await tester.pump(const Duration(milliseconds: 950));
    await tester.pump(const Duration(milliseconds: 200));

    expect(service.slotCalls, greaterThanOrEqualTo(3));
    expect(service.slotAmounts.toSet(), {200});
    expect(find.text('رصيد Coins غير كافٍ.'), findsOneWidget);
    expect(find.textContaining('Auto Play • نفس الرهان'), findsOneWidget);
  });
}
