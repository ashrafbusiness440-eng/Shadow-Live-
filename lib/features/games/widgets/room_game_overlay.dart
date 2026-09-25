import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../game_asset_paths.dart';
import '../services/game_runtime_service.dart';
import '../../room/services/room_presence_service.dart';
import '../../voice/services/voice_room_session_controller.dart';
import '../../wallet/screens/recharge_screen.dart';

class RoomGameOverlaySheet extends StatefulWidget {
  const RoomGameOverlaySheet({
    super.key,
    required this.roomId,
    this.initialGameKey,
    this.runtimeService,
    this.realtimeEvents,
  });

  final String roomId;
  final String? initialGameKey;
  final GameRuntimeService? runtimeService;
  final Stream<RoomRealtimeEvent>? realtimeEvents;

  @override
  State<RoomGameOverlaySheet> createState() => _RoomGameOverlaySheetState();
}

class _RoomGameOverlaySheetState extends State<RoomGameOverlaySheet> {
  late final GameRuntimeService _service;
  Timer? _ticker;
  Timer? _greedySpinTimer;
  Timer? _greedyResultTimer;
  Timer? _greedyPhaseTimer;
  StreamSubscription<RoomRealtimeEvent>? _gameRealtimeSubscription;

  List<GameCatalogEntry> _catalog = const [];
  GameCatalogEntry? _selected;
  GameRuntimeState? _state;
  GameBetResult? _slotResult;
  bool _loading = true;
  bool _placing = false;
  bool _autoPlaying = false;
  int? _autoBetAmount;
  bool _minimized = false;
  bool _maximized = false;
  String? _error;
  int _betIndex = 0;
  int _clockTick = 0;
  int _greedySpinIndex = 0;
  String? _greedySpinHighlightId;
  String? _greedyResolvedOutcomeId;
  String? _seenGreedyResultId;
  bool _greedyResolving = false;
  bool _greedyResultVisible = false;
  int _stateReceivedAtLocalMs = 0;
  int _stateRequestSequence = 0;
  int _stateAppliedSequence = 0;
  String? _greedyOptimisticRoundId;
  final Map<String, int> _greedyOptimisticUserTargets = <String, int>{};
  final Map<String, int> _greedyOptimisticServerTargets = <String, int>{};

  static const _greedyChoiceOrder = <String>[
    'shell45',
    'steak25',
    'fish15',
    'chicken10',
    'cabbage5',
    'carrot5',
    'pepper5',
    'tomato5',
  ];

  static const _gold = Color(0xFFFFC84A);
  static const _purple = Color(0xFFB96CFF);
  static const _cyan = Color(0xFF49D7FF);

  @override
  void initState() {
    super.initState();
    _service = widget.runtimeService ?? GameRuntimeService();
    final realtimeEvents = widget.realtimeEvents ??
        VoiceRoomSessionController.instance.realtimeEvents;
    _gameRealtimeSubscription = realtimeEvents.listen(
      _handleGameRealtimeEvent,
    );
    _loadCatalog();
    _ticker = Timer.periodic(
      const Duration(milliseconds: 250),
      (_) {
        if (mounted) setState(() => _clockTick++);
      },
    );
  }

  @override
  void dispose() {
    _autoPlaying = false;
    _ticker?.cancel();
    _greedySpinTimer?.cancel();
    _greedyResultTimer?.cancel();
    _greedyPhaseTimer?.cancel();
    unawaited(_gameRealtimeSubscription?.cancel());
    _gameRealtimeSubscription = null;
    if (widget.runtimeService == null) {
      _service.close();
    }
    super.dispose();
  }

  String get _requestedKey => (widget.initialGameKey ?? '').trim();

  Future<void> _loadCatalog() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final catalog = await _service.loadCatalog();
      if (!mounted) return;
      GameCatalogEntry? selected;
      if (_requestedKey.isNotEmpty) {
        selected = _pickByBaseKey(catalog, _requestedKey);
      }
      setState(() {
        _catalog = catalog;
        _selected = selected;
        _loading = false;
        _betIndex = 0;
      });
      if (selected != null) {
        await _loadState();
        if (const bool.fromEnvironment('E2E_GAME_TEST')) {
          debugPrint('E2E_GAME_OVERLAY_READY:${selected.key}');
        }
      }
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = _message(error);
      });
    }
  }

  GameCatalogEntry? _pickByBaseKey(
    List<GameCatalogEntry> catalog,
    String key,
  ) {
    if (key == 'witch') {
      for (final item in catalog) {
        if (item.key == 'witch_normal') return item;
      }
      for (final item in catalog) {
        if (item.key == 'witch_advanced') return item;
      }
      return null;
    }
    for (final item in catalog) {
      if (item.key == key) return item;
    }
    return null;
  }

  List<GameCatalogEntry> get _witchModes => _catalog
      .where((item) => item.gameId == 'witch')
      .toList(growable: false);

  bool get _hasGreedy =>
      _catalog.any((item) => item.gameId == 'greedy_cat');
  bool get _hasWitch => _catalog.any((item) => item.gameId == 'witch');
  bool get _hasSlot => _catalog.any((item) => item.gameId == 'slot');

  Future<void> _selectBase(String key) async {
    final next = _pickByBaseKey(_catalog, key);
    if (next == null) return;
    setState(() {
      _selected = next;
      _state = null;
      _slotResult = null;
      _betIndex = 0;
      _error = null;
    });
    await _loadState();
  }

  Future<void> _selectWitchMode(GameCatalogEntry next) async {
    if (_selected?.key == next.key) return;
    setState(() {
      _selected = next;
      _state = null;
      _betIndex = 0;
      _error = null;
    });
    await _loadState();
  }

  Future<void> _loadState({bool silent = false}) async {
    final game = _selected;
    if (game == null) return;
    final requestSequence = ++_stateRequestSequence;
    try {
      final state = await _service.loadState(
        game,
        roomId: widget.roomId,
      );
      final currentRoundOpensAtMs =
          (_state?.round?['opensAtMs'] as num?)?.toInt() ?? 0;
      final responseRoundOpensAtMs =
          (state.round?['opensAtMs'] as num?)?.toInt() ?? 0;
      if (!mounted ||
          _selected?.key != game.key ||
          requestSequence < _stateAppliedSequence ||
          (currentRoundOpensAtMs > 0 &&
              responseRoundOpensAtMs > 0 &&
              responseRoundOpensAtMs < currentRoundOpensAtMs)) {
        return;
      }
      _stateAppliedSequence = requestSequence;
      setState(() {
        _state = state;
        _stateReceivedAtLocalMs = DateTime.now().millisecondsSinceEpoch;
        _reconcileGreedyOptimistic(state);
        _error = null;
        if (state.bets.isNotEmpty && _betIndex >= state.bets.length) {
          _betIndex = state.bets.length - 1;
        }
      });
      _syncGreedyRoundVisuals(state);
      _scheduleGreedyPhaseRefresh(state);
    } catch (error) {
      if (!mounted || silent) return;
      setState(() => _error = _message(error));
    }
  }

  int get _estimatedServerNowMs {
    final state = _state;
    if (state == null || state.serverNowMs <= 0 || _stateReceivedAtLocalMs <= 0) {
      return DateTime.now().millisecondsSinceEpoch;
    }
    final elapsed =
        DateTime.now().millisecondsSinceEpoch - _stateReceivedAtLocalMs;
    return state.serverNowMs + elapsed.clamp(0, 60000);
  }

  int _roundTime(String key) =>
      (_state?.round?[key] as num?)?.toInt() ?? 0;

  String get _greedyRoundStatus {
    final round = _state?.round;
    if (round == null) return 'betting';
    final now = _estimatedServerNowMs;
    final bettingCloses = (round['bettingClosesAtMs'] as num?)?.toInt() ?? 0;
    final reveal = (round['revealAtMs'] as num?)?.toInt() ??
        (round['closesAtMs'] as num?)?.toInt() ??
        0;
    final holdEnds = (round['resultHoldEndsAtMs'] as num?)?.toInt() ?? reveal;
    if (bettingCloses > 0 && now < bettingCloses) return 'betting';
    if (reveal > 0 && now < reveal) return 'spinning';
    if (holdEnds > 0 && now < holdEnds) return 'result_hold';
    return (round['status'] ?? 'transition').toString();
  }

  bool get _greedyBettingOpen =>
      _greedyRoundStatus == 'betting' &&
      _state?.round?['locked'] != true;

  void _scheduleGreedyPhaseRefresh(GameRuntimeState next) {
    _greedyPhaseTimer?.cancel();
    if (_selected?.gameId != 'greedy_cat' || next.round == null) return;

    final round = next.round!;
    final holdEnds =
        (round['resultHoldEndsAtMs'] as num?)?.toInt() ?? 0;
    if (holdEnds > 0 && _estimatedServerNowMs >= holdEnds) return;

    final status = _greedyRoundStatus;
    final boundary = status == 'betting'
        ? (round['bettingClosesAtMs'] as num?)?.toInt()
        : status == 'spinning'
            ? (round['revealAtMs'] as num?)?.toInt()
            : status == 'result_hold'
                ? holdEnds
                : null;
    if (boundary == null || boundary <= 0) return;

    final delayMs =
        (boundary - _estimatedServerNowMs + 40).clamp(40, 60000).toInt();
    _greedyPhaseTimer = Timer(Duration(milliseconds: delayMs), () {
      if (!mounted || _selected?.gameId != 'greedy_cat') return;
      if (status == 'betting') {
        _startGreedySpinPreview();
      } else if (status == 'result_hold') {
        setState(() {
          _greedyResultVisible = false;
          _greedyResolvedOutcomeId = null;
          _greedySpinHighlightId = null;
        });
      } else {
        setState(() => _clockTick++);
      }
      final current = _state;
      if (current != null) _scheduleGreedyPhaseRefresh(current);
    });
  }

  bool _eventMatchesSelectedGame(RoomRealtimeEvent event) {
    final game = _selected;
    if (game == null) return false;
    final payload = event.payload;
    final eventRoomId = (payload['roomId'] ?? '').toString();
    final eventGameId = (payload['gameId'] ?? '').toString();
    final eventMode = (payload['mode'] ?? '').toString();
    if (eventRoomId.isNotEmpty && eventRoomId != widget.roomId) return false;
    if (eventGameId != game.gameId) return false;
    if (game.gameId == 'witch' && eventMode != game.mode) return false;
    return true;
  }

  void _applyRealtimeRound(Map<String, dynamic> round, int serverTimeMs) {
    final current = _state;
    final game = _selected;
    if (current == null || game == null) return;

    final incomingOpensAtMs =
        (round['opensAtMs'] as num?)?.toInt() ?? 0;
    final currentOpensAtMs =
        (current.round?['opensAtMs'] as num?)?.toInt() ?? 0;
    if (incomingOpensAtMs > 0 &&
        currentOpensAtMs > incomingOpensAtMs) {
      return;
    }

    final next = GameRuntimeState(
      gameId: current.gameId,
      mode: current.mode,
      serverNowMs: serverTimeMs > 0
          ? serverTimeMs
          : DateTime.now().millisecondsSinceEpoch,
      bets: current.bets,
      round: round,
      currentRoundSelections: const <String, int>{},
      lastResult: current.lastResult,
      recentResults: current.recentResults,
      serverRoundSelections: const <String, int>{},
      totalRoundStakeCoins: 0,
      userDailyPayoutCoins: current.userDailyPayoutCoins,
    );
    setState(() {
      _state = next;
      _stateReceivedAtLocalMs = DateTime.now().millisecondsSinceEpoch;
      _greedyOptimisticRoundId = null;
      _greedyOptimisticUserTargets.clear();
      _greedyOptimisticServerTargets.clear();
      _clockTick++;
    });
    _syncGreedyRoundVisuals(next);
    _scheduleGreedyPhaseRefresh(next);
  }

  void _handleGameRealtimeEvent(RoomRealtimeEvent event) {
    if (!mounted) return;

    if (event.type == 'server.ready') {
      final game = _selected;
      if (game != null && game.gameId != 'slot' && _state != null) {
        unawaited(_loadState(silent: true));
      }
      return;
    }
    if (!_eventMatchesSelectedGame(event)) return;

    if (event.type == 'game.betting_closed') {
      if (_selected?.gameId == 'greedy_cat') {
        _startGreedySpinPreview();
      }
      setState(() => _clockTick++);
      return;
    }

    if (event.type == 'game.result') {
      final outcomeId = (event.payload['outcomeId'] ?? '').toString();
      if (_selected?.gameId == 'greedy_cat' && outcomeId.isNotEmpty) {
        _stopGreedySpinPreview();
        setState(() {
          _greedySpinHighlightId =
              _greedyChoiceOrder.contains(outcomeId) ? outcomeId : null;
          _greedyResolvedOutcomeId = outcomeId;
          _clockTick++;
        });
      }
      // One authoritative refresh is triggered by the pushed result event.
      // This settles the current user's due operation and returns their
      // personal payout/ranking. It is event-driven, never periodic polling.
      unawaited(_loadState(silent: true));
      return;
    }

    if (event.type == 'game.next_round' ||
        event.type == 'game.round_started') {
      final rawRound = event.type == 'game.next_round'
          ? event.payload['nextRound']
          : event.payload['round'];
      if (rawRound is Map) {
        _applyRealtimeRound(
          Map<String, dynamic>.from(rawRound),
          event.serverTimeMs,
        );
      }
    }
  }

  void _syncGreedyRoundVisuals(GameRuntimeState next) {
    if (_selected?.gameId != 'greedy_cat') return;
    final status = _greedyRoundStatus;
    final last = next.lastResult;
    final resultRoundId = (last?['roundId'] ?? '').toString();
    final outcomeId = (last?['outcomeId'] ?? '').toString();

    if (status == 'spinning') {
      _greedyResultTimer?.cancel();
      if (_greedyResultVisible && mounted) {
        setState(() {
          _greedyResultVisible = false;
          _greedyResolvedOutcomeId = null;
        });
      }
      _startGreedySpinPreview();
      return;
    }

    if (status == 'result_hold' && resultRoundId.isNotEmpty && outcomeId.isNotEmpty) {
      _seenGreedyResultId = resultRoundId;
      _revealGreedyOutcome(outcomeId);
      return;
    }

    if (_seenGreedyResultId == null && resultRoundId.isNotEmpty) {
      _seenGreedyResultId = resultRoundId;
    }
    if (status == 'betting') {
      _stopGreedySpinPreview(clear: true);
      _greedyResultTimer?.cancel();
      if (mounted && (_greedyResultVisible || _greedyResolvedOutcomeId != null)) {
        setState(() {
          _greedyResultVisible = false;
          _greedyResolvedOutcomeId = null;
          _greedySpinHighlightId = null;
        });
      }
    }
  }

  void _startGreedySpinPreview() {
    if (_greedySpinTimer?.isActive == true) return;
    _greedyResolvedOutcomeId = null;
    _greedySpinTimer = Timer.periodic(
      const Duration(milliseconds: 90),
      (_) {
        if (!mounted || _greedyRoundStatus != 'spinning') return;
        setState(() {
          _greedySpinHighlightId =
              _greedyChoiceOrder[_greedySpinIndex % _greedyChoiceOrder.length];
          _greedySpinIndex++;
        });
      },
    );
  }

  void _stopGreedySpinPreview({bool clear = false}) {
    _greedySpinTimer?.cancel();
    _greedySpinTimer = null;
    if (clear && mounted) {
      setState(() => _greedySpinHighlightId = null);
    }
  }

  void _revealGreedyOutcome(String outcomeId) {
    if (_selected?.gameId != 'greedy_cat' || outcomeId.isEmpty) return;
    _greedyResolving = false;
    _stopGreedySpinPreview();
    _greedyResultTimer?.cancel();
    final targetIndex = _greedyChoiceOrder.indexOf(outcomeId);
    if (mounted) {
      setState(() {
        _greedySpinHighlightId = targetIndex >= 0 ? outcomeId : null;
        _greedyResolvedOutcomeId = outcomeId;
        _greedyResultVisible = true;
      });
    }
    final holdEnds = _roundTime('resultHoldEndsAtMs');
    final remainingMs =
        (holdEnds - _estimatedServerNowMs).clamp(120, 10000).toInt();
    _greedyResultTimer = Timer(Duration(milliseconds: remainingMs), () {
      if (!mounted) return;
      setState(() {
        _greedyResultVisible = false;
        _greedyResolvedOutcomeId = null;
        _greedySpinHighlightId = null;
      });
    });
  }

  int _greedyUserTotal(String choiceId) {
    final authoritative = _state?.currentRoundSelections[choiceId] ?? 0;
    final optimistic = _greedyOptimisticUserTargets[choiceId] ?? 0;
    return authoritative > optimistic ? authoritative : optimistic;
  }

  int _greedyServerTotal(String choiceId) {
    final authoritative = _state?.serverRoundSelections[choiceId] ?? 0;
    final optimistic = _greedyOptimisticServerTargets[choiceId] ?? 0;
    return authoritative > optimistic ? authoritative : optimistic;
  }

  void _addGreedyOptimisticBet(String choiceId, int amount) {
    _greedyOptimisticRoundId = (_state?.round?['roundId'] ?? '').toString();
    final userNow = _greedyUserTotal(choiceId);
    final serverNow = _greedyServerTotal(choiceId);
    _greedyOptimisticUserTargets[choiceId] = userNow + amount;
    _greedyOptimisticServerTargets[choiceId] = serverNow + amount;
  }

  void _rollbackGreedyOptimisticBet(String choiceId, int amount) {
    final userAuthoritative = _state?.currentRoundSelections[choiceId] ?? 0;
    final serverAuthoritative = _state?.serverRoundSelections[choiceId] ?? 0;
    final userTarget =
        (_greedyOptimisticUserTargets[choiceId] ?? userAuthoritative) - amount;
    final serverTarget =
        (_greedyOptimisticServerTargets[choiceId] ?? serverAuthoritative) -
            amount;
    if (userTarget <= userAuthoritative) {
      _greedyOptimisticUserTargets.remove(choiceId);
    } else {
      _greedyOptimisticUserTargets[choiceId] = userTarget;
    }
    if (serverTarget <= serverAuthoritative) {
      _greedyOptimisticServerTargets.remove(choiceId);
    } else {
      _greedyOptimisticServerTargets[choiceId] = serverTarget;
    }
  }

  void _reconcileGreedyOptimistic(GameRuntimeState next) {
    final nextRoundId = (next.round?['roundId'] ?? '').toString();
    if (_greedyOptimisticRoundId != null &&
        _greedyOptimisticRoundId!.isNotEmpty &&
        nextRoundId.isNotEmpty &&
        nextRoundId != _greedyOptimisticRoundId) {
      _greedyOptimisticUserTargets.clear();
      _greedyOptimisticServerTargets.clear();
      _greedyOptimisticRoundId = null;
      return;
    }
    for (final choiceId in _greedyOptimisticUserTargets.keys.toList()) {
      final authoritative = next.currentRoundSelections[choiceId] ?? 0;
      if (authoritative >= (_greedyOptimisticUserTargets[choiceId] ?? 0)) {
        _greedyOptimisticUserTargets.remove(choiceId);
      }
    }
    for (final choiceId in _greedyOptimisticServerTargets.keys.toList()) {
      final authoritative = next.serverRoundSelections[choiceId] ?? 0;
      if (authoritative >= (_greedyOptimisticServerTargets[choiceId] ?? 0)) {
        _greedyOptimisticServerTargets.remove(choiceId);
      }
    }
    if (_greedyOptimisticUserTargets.isEmpty &&
        _greedyOptimisticServerTargets.isEmpty) {
      _greedyOptimisticRoundId = null;
    }
  }

  int get _currentBet {
    final game = _selected;
    final values = _state?.bets.isNotEmpty == true
        ? _state!.bets
        : game?.bets ?? const <int>[];
    if (values.isEmpty) return 0;
    final index = _betIndex.clamp(0, values.length - 1).toInt();
    return values[index];
  }

  List<int> get _betValues {
    final game = _selected;
    return _state?.bets.isNotEmpty == true
        ? _state!.bets
        : game?.bets ?? const <int>[];
  }

  Future<bool> _placeChoice(
    String choiceId, {
    int? amountOverride,
    bool silent = false,
  }) async {
    final game = _selected;
    final amount = amountOverride ?? _currentBet;
    final isGreedy = game?.gameId == 'greedy_cat';
    if (game == null ||
        amount <= 0 ||
        (!isGreedy && _placing) ||
        (isGreedy && !_greedyBettingOpen)) {
      return false;
    }

    if (isGreedy) {
      setState(() {
        _addGreedyOptimisticBet(choiceId, amount);
        _error = null;
      });
    } else {
      setState(() {
        _placing = true;
        _error = null;
      });
    }

    try {
      final result = await _service.placeBet(
        game: game,
        roomId: widget.roomId,
        amountCoins: amount,
        choiceId: choiceId,
      );
      if (!mounted) return false;
      setState(() => _slotResult = result);
      await _loadState(silent: true);
      if (!mounted) return false;
      if (!silent && !isGreedy) {
        final text = game.gameId == 'slot'
            ? 'تمت اللفة • الدفع: ${_coins(result.payoutCoins ?? 0)}'
            : 'تمت إضافة ${_coins(amount)} على الخيار';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(text)),
        );
      }
      return true;
    } catch (error) {
      if (!mounted) return false;
      setState(() {
        if (isGreedy) {
          _rollbackGreedyOptimisticBet(choiceId, amount);
        }
        _error = _message(error);
      });
      return false;
    } finally {
      if (mounted && !isGreedy) setState(() => _placing = false);
    }
  }

  Future<void> _toggleAutoPlay() async {
    if (_selected?.gameId != 'slot') return;
    if (_autoPlaying) {
      setState(() {
        _autoPlaying = false;
        _autoBetAmount = null;
      });
      return;
    }
    final fixedBet = _currentBet;
    if (fixedBet <= 0) return;
    setState(() {
      _autoPlaying = true;
      _autoBetAmount = fixedBet;
      _error = null;
    });
    while (mounted && _autoPlaying && _selected?.gameId == 'slot') {
      final ok = await _placeChoice(
        'spin',
        amountOverride: fixedBet,
        silent: true,
      );
      if (!ok || !mounted) {
        if (mounted) {
          setState(() {
            _autoPlaying = false;
            _autoBetAmount = null;
          });
        }
        break;
      }
      await Future<void>.delayed(const Duration(milliseconds: 900));
    }
  }

  String _message(Object error) {
    final text = error.toString();
    if (text.contains('insufficient_balance')) return 'رصيد Coins غير كافٍ.';
    if (text.contains('round_locked')) return 'أُغلق الرهان لهذه الجولة.';
    if (text.contains('game_disabled')) return 'اللعبة متوقفة حالياً.';
    if (text.contains('games_disabled')) return 'الألعاب متوقفة حالياً.';
    if (text.contains('user_not_in_room')) {
      return 'يجب أن تبقى داخل الروم أثناء اللعب.';
    }
    if (text.contains('account_required')) return 'الألعاب تحتاج حساباً مسجلاً.';
    if (text.contains('not_signed_in') || text.contains('unauthorized')) {
      return 'انتهت جلسة الدخول. سجّل الدخول من جديد ثم أعد المحاولة.';
    }
    if (text.contains('TimeoutException') ||
        text.contains('game_request_failed') ||
        text.contains('Failed host lookup') ||
        text.contains('ClientException')) {
      return 'تعذر الاتصال بخادم الألعاب. أعد المحاولة.';
    }
    if (text.contains('server_not_configured') ||
        text.contains('rng_not_configured')) {
      return 'إعداد خادم الألعاب غير مكتمل حالياً.';
    }
    return 'تعذر تنفيذ العملية حالياً.';
  }

  String _coins(int value) {
    if (value >= 1000000) {
      final n = value / 1000000;
      return '${n.toStringAsFixed(n % 1 == 0 ? 0 : 1)}M';
    }
    if (value >= 1000) {
      final n = value / 1000;
      return '${n.toStringAsFixed(n % 1 == 0 ? 0 : 1)}K';
    }
    return '$value';
  }

  int get _remainingSeconds {
    final bettingCloses = _roundTime('bettingClosesAtMs');
    if (bettingCloses <= 0) return 0;
    return ((bettingCloses - _estimatedServerNowMs) / 1000)
        .ceil()
        .clamp(0, 999)
        .toInt();
  }

  Color get _accent {
    switch (_selected?.gameId) {
      case 'witch':
        return _purple;
      case 'slot':
        return _cyan;
      default:
        return _gold;
    }
  }

  String? _heroAsset(GameCatalogEntry? game) {
    if (game == null) return null;
    switch (game.gameId) {
      case 'greedy_cat':
        return GameAssetPaths.greedyMascot;
      case 'witch':
        return GameAssetPaths.witchCharacter;
      case 'slot':
        return GameAssetPaths.slotCover;
      default:
        return null;
    }
  }

  String? _outcomeAsset(String id) {
    if (id == 'salad') return GameAssetPaths.greedySalad;
    if (id == 'pizza') return GameAssetPaths.greedyPizza;
    if (id == 'jackpot') return GameAssetPaths.slotJackpot;
    return GameAssetPaths.greedyChoices[id] ??
        GameAssetPaths.witchSymbols[id] ??
        GameAssetPaths.slotSymbols[id];
  }

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.sizeOf(context).height;
    final factor = _minimized
        ? .16
        : (_maximized
            ? .94
            : (_selected?.gameId == 'greedy_cat' ? .82 : .70));
    return Semantics(
      container: true,
      label: 'Shadow Live game overlay',
      child: AnimatedContainer(
      duration: const Duration(milliseconds: 220),
      height: screenHeight * factor,
      decoration: const BoxDecoration(
        color: Color(0xFF080A12),
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
        boxShadow: [
          BoxShadow(color: Colors.black54, blurRadius: 24),
        ],
      ),
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              _header(),
              if (!_minimized)
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : _error != null && _catalog.isEmpty
                          ? _errorView()
                          : _selected == null
                              ? _picker()
                              : _gameView(),
                ),
            ],
          ),
        ),
      ),
    ),
    );
  }

  Widget _header() {
    final game = _selected;
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: Colors.white.withValues(alpha: .07)),
        ),
      ),
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: _accent.withValues(alpha: .14),
              borderRadius: BorderRadius.circular(14),
            ),
            clipBehavior: Clip.antiAlias,
            child: _heroAsset(game) == null
                ? Icon(
                    Icons.sports_esports_rounded,
                    color: _accent,
                  )
                : Image.asset(
                    _heroAsset(game)!,
                    fit: BoxFit.cover,
                    filterQuality: FilterQuality.medium,
                    errorBuilder: (_, __, ___) => Icon(
                      game?.gameId == 'greedy_cat'
                          ? Icons.pets_rounded
                          : game?.gameId == 'witch'
                              ? Icons.auto_awesome_rounded
                              : Icons.casino_rounded,
                      color: _accent,
                    ),
                  ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: InkWell(
              onTap: _minimized
                  ? () => setState(() => _minimized = false)
                  : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    game?.label ?? 'ألعاب Shadow Live',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                    ),
                  ),
                  Text(
                    _minimized
                        ? 'اضغط للعودة للعبة'
                        : 'داخل الروم • الصوت مستمر',
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (!_minimized)
            IconButton(
              tooltip: _maximized ? 'الحجم الطبيعي' : 'تكبير',
              onPressed: () => setState(() => _maximized = !_maximized),
              icon: Icon(
                _maximized
                    ? Icons.close_fullscreen_rounded
                    : Icons.open_in_full_rounded,
                color: Colors.white70,
              ),
            ),
          IconButton(
            tooltip: _minimized ? 'فتح' : 'تصغير',
            onPressed: () => setState(() {
              _minimized = !_minimized;
              if (_minimized) _maximized = false;
            }),
            icon: Icon(
              _minimized
                  ? Icons.keyboard_arrow_up_rounded
                  : Icons.keyboard_arrow_down_rounded,
              color: Colors.white70,
            ),
          ),
          IconButton(
            tooltip: 'إغلاق اللعبة',
            onPressed: () => Navigator.pop(context),
            icon: const Icon(Icons.close_rounded, color: Colors.white70),
          ),
        ],
      ),
    );
  }

  Widget _errorView() => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.cloud_off_rounded,
                color: Colors.orangeAccent,
                size: 38,
              ),
              const SizedBox(height: 12),
              Text(
                _error!,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.orangeAccent),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                onPressed: _loading ? null : _loadCatalog,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('إعادة المحاولة'),
              ),
            ],
          ),
        ),
      );

  Widget _picker() {
    if (_catalog.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: Text(
            'لا توجد ألعاب مفعّلة حالياً من Shadow Control.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white54),
          ),
        ),
      );
    }
    final cards = <Widget>[];
    if (_hasGreedy) {
      cards.add(_gamePickerCard(
        keyName: 'greedy_cat',
        title: 'القط الجشع',
        subtitle: 'جولة جماعية عالمية',
        icon: Icons.pets_rounded,
        accent: _gold,
      ));
    }
    if (_hasWitch) {
      cards.add(_gamePickerCard(
        keyName: 'witch',
        title: 'الساحرة',
        subtitle: 'Normal / Advanced',
        icon: Icons.auto_awesome_rounded,
        accent: _purple,
      ));
    }
    if (_hasSlot) {
      cards.add(_gamePickerCard(
        keyName: 'slot',
        title: 'Shadow Slot',
        subtitle: 'Spin فردي',
        icon: Icons.casino_rounded,
        accent: _cyan,
      ));
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Text(
          'اختر لعبة',
          style: TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 12),
        ...cards,
      ],
    );
  }

  Widget _gamePickerCard({
    required String keyName,
    required String title,
    required String subtitle,
    required IconData icon,
    required Color accent,
  }) =>
      Card(
        color: const Color(0xFF111522),
        margin: const EdgeInsets.only(bottom: 10),
        child: ListTile(
          onTap: () => _selectBase(keyName),
          leading: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Container(
              width: 44,
              height: 44,
              color: accent.withValues(alpha: .12),
              child: Image.asset(
                GameAssetPaths.coverFor(keyName),
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Icon(icon, color: accent),
              ),
            ),
          ),
          title: Text(
            title,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
          subtitle: Text(
            subtitle,
            style: const TextStyle(color: Colors.white54),
          ),
          trailing: const Icon(
            Icons.chevron_left_rounded,
            color: Colors.white54,
          ),
        ),
      );

  Widget _gameView() {
    final game = _selected!;
    if (game.gameId == 'greedy_cat') {
      return _greedyGameView();
    }

    final background = GameAssetPaths.backgroundFor(game.gameId, game.mode);
    return Column(
      children: [
        _statusBar(game),
        if (_error != null) _gameErrorBanner(),
        Expanded(
          child: Container(
            decoration: background == null
                ? null
                : BoxDecoration(
                    image: DecorationImage(
                      image: AssetImage(background),
                      fit: BoxFit.cover,
                      opacity: .10,
                    ),
                  ),
            child: ListView(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
              children: [
                if (game.gameId == 'witch') _witchModesBar(),
                if (game.gameId != 'slot') _roundCard(),
                const SizedBox(height: 10),
                _betPicker(),
                const SizedBox(height: 12),
                if (game.gameId == 'witch') _witchBoard(),
                if (game.gameId == 'slot') _slotBoard(),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _greedyGameView() {
    return Stack(
      children: [
        Positioned.fill(
          child: Image.asset(
            GameAssetPaths.greedyBackground,
            fit: BoxFit.cover,
            alignment: Alignment.center,
            filterQuality: FilterQuality.high,
            errorBuilder: (_, __, ___) => const ColoredBox(
              color: Color(0xFF080A12),
            ),
          ),
        ),
        Positioned.fill(
          child: DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  const Color(0xFF080A12).withValues(alpha: .38),
                  const Color(0xFF080A12).withValues(alpha: .68),
                  const Color(0xFF080A12).withValues(alpha: .82),
                ],
              ),
            ),
          ),
        ),
        Column(
          children: [
            if (_error != null) _gameErrorBanner(),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
                children: [
                  _greedyInfoBar(),
                  const SizedBox(height: 6),
                  _greedyBoard(),
                ],
              ),
            ),
          ],
        ),
        if (_greedyResultVisible) _greedyRoundResultOverlay(),
      ],
    );
  }

  Widget _gameErrorBanner() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
      color: Colors.redAccent.withValues(alpha: .12),
      child: Text(
        _error!,
        style: const TextStyle(
          color: Colors.orangeAccent,
          fontSize: 11,
        ),
      ),
    );
  }

  Future<void> _openRechargeStore() async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => const RechargeScreen(initialTab: 0),
      ),
    );
  }

  Widget _greedyInfoBar() {
    String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      uid = null;
    }
    final roundNumber =
        (_state?.round?['roundNumber'] as num?)?.toInt() ?? 0;

    return Row(
      children: [
        Expanded(
          child: Container(
            height: 48,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: const Color(0xFF11172A).withValues(alpha: .92),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: _gold.withValues(alpha: .24)),
            ),
            child: uid == null
                ? const Center(
                    child: Text(
                      '0 Coins',
                      style: TextStyle(
                        color: _gold,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  )
                : StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                    stream: FirebaseFirestore.instance
                        .collection('users')
                        .doc(uid)
                        .snapshots(),
                    builder: (_, snapshot) {
                      final data = snapshot.data?.data();
                      final coins = (data?['coins'] as num?)?.toInt() ?? 0;
                      return Row(
                        children: [
                          const Icon(
                            Icons.monetization_on_rounded,
                            color: _gold,
                            size: 23,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              _coins(coins),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: _gold,
                                fontWeight: FontWeight.w900,
                                fontSize: 15,
                              ),
                            ),
                          ),
                          InkWell(
                            onTap: _openRechargeStore,
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              width: 32,
                              height: 32,
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(10),
                                color: _purple.withValues(alpha: .18),
                                border: Border.all(
                                  color: _purple.withValues(alpha: .45),
                                ),
                              ),
                              child: const Icon(
                                Icons.add_rounded,
                                color: Colors.white,
                                size: 20,
                              ),
                            ),
                          ),
                        ],
                      );
                    },
                  ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Container(
            height: 48,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              gradient: LinearGradient(
                colors: [
                  const Color(0xFF8D4B1F).withValues(alpha: .96),
                  const Color(0xFFC27A2B).withValues(alpha: .96),
                ],
              ),
              border: Border.all(color: _gold.withValues(alpha: .55)),
              boxShadow: [
                BoxShadow(
                  color: _gold.withValues(alpha: .14),
                  blurRadius: 14,
                ),
              ],
            ),
            child: Text(
              'الجولة $roundNumber',
              style: const TextStyle(
                color: Color(0xFFFFE2A1),
                fontWeight: FontWeight.w900,
                fontSize: 16,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _statusBar(GameCatalogEntry game) {
    String? uid;
    try {
      uid = FirebaseAuth.instance.currentUser?.uid;
    } catch (_) {
      uid = null;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      color: Colors.white.withValues(alpha: .025),
      child: Row(
        children: [
          Expanded(
            child: Text(
              game.gameId == 'slot'
                  ? 'Spin مستقل وآمن على السيرفر'
                  : 'الجولة نفسها لكل المستخدمين في كل الرومات',
              style: const TextStyle(color: Colors.white54, fontSize: 10),
            ),
          ),
          if (uid != null)
            StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
              stream: FirebaseFirestore.instance
                  .collection('users')
                  .doc(uid)
                  .snapshots(),
              builder: (_, snapshot) {
                final data = snapshot.data?.data();
                final coins = (data?['coins'] as num?)?.toInt() ?? 0;
                return Text(
                  '${_coins(coins)} Coins',
                  style: TextStyle(
                    color: _accent,
                    fontWeight: FontWeight.w900,
                    fontSize: 11,
                  ),
                );
              },
            ),
        ],
      ),
    );
  }

  Widget _roundCard() {
    final round = _state?.round;
    final number = (round?['roundNumber'] as num?)?.toInt() ?? 0;
    final last = _state?.lastResult;
    final lastOutcome = (last?['outcomeId'] ?? '').toString();
    final lastAsset = last == null ? null : _outcomeAsset(lastOutcome);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: _accent.withValues(alpha: .08),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: _accent.withValues(alpha: .22)),
      ),
      child: Row(
        children: [
          CircleAvatar(
            backgroundColor: _accent.withValues(alpha: .16),
            child: Text(
              '#$number',
              style: TextStyle(
                color: _accent,
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'الجولة الحالية • متبقي $_remainingSeconds ث',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                    fontSize: 11,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  last == null
                      ? 'لا توجد نتيجة سابقة بعد'
                      : 'آخر نتيجة #${last['roundNumber']}: '
                          '${_outcomeLabel((last['outcomeId'] ?? '').toString())}',
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 10,
                  ),
                ),
              ],
            ),
          ),
          if (lastAsset != null) ...[
            const SizedBox(width: 8),
            Container(
              width: 38,
              height: 38,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(12),
                color: Colors.black.withValues(alpha: .20),
              ),
              padding: const EdgeInsets.all(4),
              child: Image.asset(
                lastAsset,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.medium,
                errorBuilder: (_, __, ___) =>
                    Icon(Icons.public_rounded, color: _accent, size: 20),
              ),
            ),
          ] else
            Icon(Icons.public_rounded, color: _accent, size: 20),
        ],
      ),
    );
  }

  Widget _witchModesBar() {
    final modes = _witchModes;
    if (modes.length < 2) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: modes
            .map(
              (item) => Expanded(
                child: Padding(
                  padding: const EdgeInsetsDirectional.only(end: 6),
                  child: ChoiceChip(
                    label: Text(item.mode == 'advanced' ? 'متقدم' : 'عادي'),
                    selected: _selected?.key == item.key,
                    onSelected: (_) => _selectWitchMode(item),
                    showCheckmark: false,
                    selectedColor: _purple,
                    backgroundColor: const Color(0xFF151824),
                    labelStyle: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ),
              ),
            )
            .toList(growable: false),
      ),
    );
  }

  Widget _betPicker() {
    final values = _betValues;
    if (values.isEmpty) {
      return const Text(
        'لا يوجد سلم رهانات مفعّل.',
        style: TextStyle(color: Colors.orangeAccent),
      );
    }
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .035),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          IconButton(
            onPressed: _placing || _autoPlaying || _betIndex <= 0
                ? null
                : () => setState(() => _betIndex--),
            icon: const Icon(Icons.remove_rounded),
          ),
          Expanded(
            child: Column(
              children: [
                const Text(
                  'قيمة الرهان الحالية',
                  style: TextStyle(color: Colors.white54, fontSize: 9),
                ),
                Text(
                  '${_coins(_currentBet)} Coins',
                  style: TextStyle(
                    color: _accent,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: _placing || _autoPlaying || _betIndex >= values.length - 1
                ? null
                : () => setState(() => _betIndex++),
            icon: const Icon(Icons.add_rounded),
          ),
        ],
      ),
    );
  }

  Widget _greedyBoard() {
    final choices = <({
      String id,
      String title,
      String multiplier,
      String asset,
      Alignment alignment,
    })>[
      (
        id: 'shell45',
        title: 'محار',
        multiplier: '×45',
        asset: GameAssetPaths.greedyChoices['shell45']!,
        alignment: const Alignment(0, -1),
      ),
      (
        id: 'steak25',
        title: 'لحم',
        multiplier: '×25',
        asset: GameAssetPaths.greedyChoices['steak25']!,
        alignment: const Alignment(.72, -.70),
      ),
      (
        id: 'fish15',
        title: 'سمك',
        multiplier: '×15',
        asset: GameAssetPaths.greedyChoices['fish15']!,
        alignment: const Alignment(1, 0),
      ),
      (
        id: 'chicken10',
        title: 'دجاج',
        multiplier: '×10',
        asset: GameAssetPaths.greedyChoices['chicken10']!,
        alignment: const Alignment(.72, .70),
      ),
      (
        id: 'cabbage5',
        title: 'ملفوف',
        multiplier: '×5',
        asset: GameAssetPaths.greedyChoices['cabbage5']!,
        alignment: const Alignment(0, 1),
      ),
      (
        id: 'carrot5',
        title: 'جزر',
        multiplier: '×5',
        asset: GameAssetPaths.greedyChoices['carrot5']!,
        alignment: const Alignment(-.72, .70),
      ),
      (
        id: 'pepper5',
        title: 'فلفل',
        multiplier: '×5',
        asset: GameAssetPaths.greedyChoices['pepper5']!,
        alignment: const Alignment(-1, 0),
      ),
      (
        id: 'tomato5',
        title: 'طماطم',
        multiplier: '×5',
        asset: GameAssetPaths.greedyChoices['tomato5']!,
        alignment: const Alignment(-.72, -.70),
      ),
    ];

    final serverTotals = <String, int>{
      for (final item in choices) item.id: _greedyServerTotal(item.id),
    };
    String? hottestId;
    var hottestAmount = 0;
    var totalServerAmount = 0;
    for (final item in choices) {
      final amount = serverTotals[item.id] ?? 0;
      totalServerAmount += amount;
      if (amount > hottestAmount) {
        hottestAmount = amount;
        hottestId = item.id;
      }
    }
    final strongServerHeat = hottestId != null &&
        totalServerAmount > 0 &&
        hottestAmount * 100 >= totalServerAmount * 40;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        LayoutBuilder(
          builder: (context, constraints) {
            final boardSize = constraints.maxWidth.clamp(276.0, 320.0).toDouble();
            final nodeSize = (boardSize * .22).clamp(60.0, 72.0).toDouble();
            final centerSize = (boardSize * .34).clamp(94.0, 112.0).toDouble();
            return Center(
              child: SizedBox(
                width: boardSize,
                height: boardSize,
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    FractionallySizedBox(
                      widthFactor: .73,
                      heightFactor: .73,
                      child: Container(
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: const Color(0xFF1B3152).withValues(alpha: .30),
                          border: Border.all(
                            color: const Color(0xFF9B5B2D),
                            width: 10,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: _gold.withValues(alpha: .12),
                              blurRadius: 30,
                            ),
                          ],
                        ),
                      ),
                    ),
                    for (final item in choices)
                      Align(
                        alignment: item.alignment,
                        child: _greedyWheelChoice(
                          id: item.id,
                          title: item.title,
                          multiplier: item.multiplier,
                          assetPath: item.asset,
                          size: nodeSize,
                          serverHeat: item.id == hottestId
                              ? (strongServerHeat ? 2 : 1)
                              : 0,
                          serverAmount: serverTotals[item.id] ?? 0,
                          spinHighlighted:
                              _greedySpinHighlightId == item.id ||
                              _greedyResolvedOutcomeId == item.id,
                        ),
                      ),
                    Container(
                      width: centerSize,
                      height: centerSize,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: const RadialGradient(
                          colors: [
                            Color(0xFF31588A),
                            Color(0xFF10172B),
                          ],
                        ),
                        border: Border.all(
                          color: _gold.withValues(alpha: .75),
                          width: 4,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: _gold.withValues(alpha: .22),
                            blurRadius: 22,
                          ),
                        ],
                      ),
                      padding: const EdgeInsets.all(13),
                      child: Image.asset(
                        GameAssetPaths.greedyMascot,
                        fit: BoxFit.contain,
                        filterQuality: FilterQuality.high,
                        errorBuilder: (_, __, ___) => const Icon(
                          Icons.pets_rounded,
                          color: _gold,
                          size: 54,
                        ),
                      ),
                    ),
                    Positioned(
                      bottom: boardSize * .29,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 13,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(999),
                          color: const Color(0xFF4B260E),
                          border: Border.all(
                            color: _gold.withValues(alpha: .70),
                          ),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.timer_outlined,
                              size: 17,
                              color: Colors.white,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              _greedyRoundStatus == 'spinning'
                                  ? 'جاري الدوران'
                                  : _greedyRoundStatus == 'result_hold'
                                      ? 'إعلان النتيجة'
                                      : '$_remainingSeconds ث',
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w900,
                                fontSize: 15,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
        const SizedBox(height: 6),
        _greedySpecialOutcomes(),
        const SizedBox(height: 8),
        _greedyRecentResults(),
        const SizedBox(height: 10),
        _greedyBetValues(),
      ],
    );
  }

  Widget _greedyWheelChoice({
    required String id,
    required String title,
    required String multiplier,
    required String assetPath,
    required double size,
    required int serverHeat,
    required int serverAmount,
    required bool spinHighlighted,
  }) {
    final total = _greedyUserTotal(id);
    final selected = total > 0;
    return InkWell(
      onTap: !_greedyBettingOpen ? null : () => _placeChoice(id),
      customBorder: const CircleBorder(),
      child: SizedBox(
        width: size,
        height: size,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.center,
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              width: size * .88,
              height: size * .88,
              padding: EdgeInsets.all(size * .12),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: spinHighlighted
                      ? [
                          const Color(0xFFFFF1A6),
                          const Color(0xFFFF8B2A),
                        ]
                      : selected
                          ? [
                              _gold.withValues(alpha: .40),
                              const Color(0xFF6B3B1E),
                            ]
                          : const [
                              Color(0xFFF0C27B),
                              Color(0xFF8A4F25),
                            ],
                ),
                border: Border.all(
                  color: spinHighlighted
                      ? Colors.white
                      : (selected ? _gold : const Color(0xFFE1A14D)),
                  width: spinHighlighted ? 4 : (selected ? 3 : 2),
                ),
                boxShadow: spinHighlighted
                    ? [
                        BoxShadow(
                          color: const Color(0xFFFF9B32).withValues(alpha: .72),
                          blurRadius: 24,
                          spreadRadius: 3,
                        ),
                      ]
                    : selected
                        ? [
                            BoxShadow(
                              color: _gold.withValues(alpha: .30),
                              blurRadius: 16,
                            ),
                          ]
                        : const [],
              ),
              child: Image.asset(
                assetPath,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
                errorBuilder: (_, __, ___) => const Icon(
                  Icons.fastfood_rounded,
                  color: Colors.white,
                ),
              ),
            ),
            Positioned(
              bottom: -2,
              child: Container(
                constraints: BoxConstraints(minWidth: size * .82),
                padding: const EdgeInsets.symmetric(
                  horizontal: 6,
                  vertical: 3,
                ),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(999),
                  color: selected
                      ? const Color(0xFF7A5310)
                      : const Color(0xFF7D301C),
                  border: Border.all(
                    color: selected
                        ? _gold
                        : Colors.white.withValues(alpha: .28),
                  ),
                ),
                child: Text(
                  '$title  $multiplier',
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 9,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
            ),
            Positioned(
              top: 0,
              left: -4,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 5,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    color: const Color(0xFF101522).withValues(alpha: .94),
                    border: Border.all(
                      color: _cyan.withValues(alpha: .70),
                    ),
                  ),
                  child: Text(
                    '🌐 ${_coins(serverAmount)}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 7.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
            if (serverHeat > 0)
              Positioned(
                top: -18,
                child: Semantics(
                  label: 'الأكثر ضغطاً بالسيرفر',
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 6,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(999),
                      color: const Color(0xFF2B1207).withValues(alpha: .92),
                      border: Border.all(
                        color: const Color(0xFFFF8A2A).withValues(alpha: .80),
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: const Color(0xFFFF6B00).withValues(alpha: .24),
                          blurRadius: 10,
                        ),
                      ],
                    ),
                    child: Text(
                      serverHeat >= 2 ? '🔥🔥' : '🔥',
                      style: const TextStyle(fontSize: 13, height: 1),
                    ),
                  ),
                ),
              ),
            if (selected)
              Positioned(
                top: -2,
                right: -2,
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 5,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(999),
                    color: const Color(0xFF0A0D15),
                    border: Border.all(color: _gold),
                  ),
                  child: Text(
                    _coins(total),
                    style: const TextStyle(
                      color: _gold,
                      fontSize: 8,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _greedySpecialOutcomes() {
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Row(
        children: [
          _greedySpecialOutcomeTile(
            label: 'بيتزا',
            assetPath: GameAssetPaths.greedyPizza,
            highlighted: _greedyResolvedOutcomeId == 'pizza',
          ),
          const SizedBox(width: 7),
          Expanded(child: _greedyDailyPayoutTile()),
          const SizedBox(width: 7),
          _greedySpecialOutcomeTile(
            label: 'سلطة',
            assetPath: GameAssetPaths.greedySalad,
            highlighted: _greedyResolvedOutcomeId == 'salad',
          ),
        ],
      ),
    );
  }

  Widget _greedyDailyPayoutTile() {
    final value = _state?.userDailyPayoutCoins ?? 0;
    return Semantics(
      label: 'أرباحك اليوم ${_coins(value)} Coins',
      child: Container(
        height: 58,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFF253C5D),
              Color(0xFF111827),
            ],
          ),
          border: Border.all(
            color: _cyan.withValues(alpha: .52),
            width: 1.3,
          ),
          boxShadow: [
            BoxShadow(
              color: _cyan.withValues(alpha: .10),
              blurRadius: 12,
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text(
              'أرباحك اليوم',
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: Colors.white70,
                fontSize: 9,
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 3),
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _coins(value),
                    style: const TextStyle(
                      color: _gold,
                      fontSize: 14,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(width: 3),
                  const Icon(
                    Icons.monetization_on_rounded,
                    size: 15,
                    color: Color(0xFFFFBE3F),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _greedySpecialOutcomeTile({
    required String label,
    required String assetPath,
    required bool highlighted,
  }) {
    return Semantics(
      label: '$label • نتيجة خاصة',
      button: false,
      child: Container(
        width: 88,
        height: 58,
        padding: const EdgeInsets.fromLTRB(8, 6, 8, 5),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFF6F4620),
              Color(0xFF2B1A10),
            ],
          ),
          border: Border.all(
            color: highlighted ? Colors.white : _gold.withValues(alpha: .62),
            width: highlighted ? 3 : 1.4,
          ),
          boxShadow: [
            BoxShadow(
              color: (highlighted ? const Color(0xFFFF8A2A) : _gold)
                  .withValues(alpha: highlighted ? .60 : .12),
              blurRadius: highlighted ? 24 : 12,
              spreadRadius: highlighted ? 2 : 0,
            ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: Image.asset(
                assetPath,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.high,
                errorBuilder: (_, __, ___) => Icon(
                  label == 'بيتزا'
                      ? Icons.local_pizza_rounded
                      : Icons.eco_rounded,
                  color: _gold,
                  size: 28,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: const TextStyle(
                color: Color(0xFFFFE2A1),
                fontSize: 11,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _greedyRecentResults() {
    final recent = _state?.recentResults ?? const <Map<String, dynamic>>[];
    final fallback = _state?.lastResult;
    final currentRoundId = (_state?.round?['roundId'] ?? '').toString();
    final canRevealCurrent = _greedyRoundStatus == 'result_hold';
    final safeRecent = recent
        .where((result) =>
            (result['roundId'] ?? '').toString() != currentRoundId ||
            canRevealCurrent)
        .take(20)
        .toList(growable: false);
    final safeFallback = fallback != null &&
            ((fallback['roundId'] ?? '').toString() != currentRoundId ||
                canRevealCurrent)
        ? fallback
        : null;
    final items = safeRecent.isNotEmpty
        ? safeRecent
        : safeFallback == null
            ? const <Map<String, dynamic>>[]
            : <Map<String, dynamic>>[safeFallback];

    return Container(
      height: 58,
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 6),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        color: const Color(0xFF10162A).withValues(alpha: .96),
        border: Border.all(color: _purple.withValues(alpha: .28)),
      ),
      child: items.isEmpty
          ? const Center(
              child: Text(
                'تظهر النتائج هنا بعد انتهاء أول جولة',
                style: TextStyle(color: Colors.white38, fontSize: 10),
              ),
            )
          : LayoutBuilder(
              builder: (context, constraints) {
                final itemWidth =
                    ((constraints.maxWidth - 8) / 8).clamp(38.0, 54.0).toDouble();
                return ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: items.length,
                  itemExtent: itemWidth,
                  itemBuilder: (_, index) {
                    final result = items[index];
                    final outcomeId = (result['outcomeId'] ?? '').toString();
                    final asset = _outcomeAsset(outcomeId);
                    return Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 2),
                      child: Stack(
                        clipBehavior: Clip.none,
                        alignment: Alignment.center,
                        children: [
                          Container(
                            width: itemWidth - 5,
                            height: itemWidth - 5,
                            padding: const EdgeInsets.all(5),
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: const Color(0xFF0B1020),
                              border: Border.all(
                                color: index == 0
                                    ? _gold
                                    : _cyan.withValues(alpha: .55),
                                width: index == 0 ? 2.5 : 1.2,
                              ),
                              boxShadow: index == 0
                                  ? [
                                      BoxShadow(
                                        color: _gold.withValues(alpha: .26),
                                        blurRadius: 10,
                                      ),
                                    ]
                                  : const [],
                            ),
                            child: asset == null
                                ? const Icon(
                                    Icons.help_outline_rounded,
                                    color: Colors.white54,
                                  )
                                : Image.asset(
                                    asset,
                                    fit: BoxFit.contain,
                                    filterQuality: FilterQuality.medium,
                                    errorBuilder: (_, __, ___) => const Icon(
                                      Icons.help_outline_rounded,
                                      color: Colors.white54,
                                    ),
                                  ),
                          ),
                          if (index == 0)
                            Positioned(
                              top: -2,
                              right: -1,
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 4,
                                  vertical: 1,
                                ),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFFF315B),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: const Text(
                                  'New',
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 7,
                                    fontWeight: FontWeight.w900,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    );
                  },
                );
              },
            ),
    );
  }

  Widget _greedyBetValues() {
    final values = _betValues;
    if (values.isEmpty) {
      return const SizedBox.shrink();
    }
    final shown = values.take(4).toList(growable: false);
    return Row(
      children: List.generate(shown.length, (index) {
        final value = shown[index];
        final sourceIndex = values.indexOf(value);
        final selected = sourceIndex == _betIndex;
        return Expanded(
          child: Padding(
            padding: EdgeInsetsDirectional.only(
              end: index == shown.length - 1 ? 0 : 6,
            ),
            child: InkWell(
              onTap: !_greedyBettingOpen
                  ? null
                  : () => setState(() => _betIndex = sourceIndex),
              borderRadius: BorderRadius.circular(14),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 160),
                height: 46,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  color: selected
                      ? _gold.withValues(alpha: .17)
                      : const Color(0xFF151B30),
                  border: Border.all(
                    color: selected
                        ? _gold
                        : Colors.white.withValues(alpha: .10),
                  ),
                ),
                alignment: Alignment.center,
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      _coins(value),
                      style: TextStyle(
                        color: selected ? _gold : Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      Icons.monetization_on_rounded,
                      color: selected ? _gold : const Color(0xFFFFBE3F),
                      size: 18,
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      }),
    );
  }

  Widget _greedyRoundResultOverlay() {
    final last = _state?.lastResult;
    if (last == null) return const SizedBox.shrink();

    final outcomeId = (last['outcomeId'] ?? '').toString();
    final outcomeAsset = _outcomeAsset(outcomeId);
    final rawTop = last['topWinners'];
    final topWinners = rawTop is List
        ? rawTop
            .whereType<Map>()
            .map((item) => Map<String, dynamic>.from(item))
            .take(3)
            .toList(growable: false)
        : const <Map<String, dynamic>>[];
    final myRound = last['myRound'] is Map
        ? Map<String, dynamic>.from(last['myRound'] as Map)
        : null;
    final stake = (myRound?['stakeCoins'] as num?)?.toInt() ?? 0;
    final payout = (myRound?['payoutCoins'] as num?)?.toInt() ?? 0;

    return Positioned.fill(
      child: Container(
        color: Colors.black.withValues(alpha: .68),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(16),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 430),
          padding: const EdgeInsets.fromLTRB(14, 10, 14, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: const LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color(0xFF241A2D),
                Color(0xFF111522),
              ],
            ),
            border: Border.all(color: _gold.withValues(alpha: .65)),
            boxShadow: [
              BoxShadow(
                color: _gold.withValues(alpha: .24),
                blurRadius: 28,
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    onPressed: () => setState(() => _greedyResultVisible = false),
                    icon: const Icon(Icons.close_rounded, color: Colors.white70),
                  ),
                  const Spacer(),
                  Text(
                    'نتيجة الجولة #${last['roundNumber'] ?? ''}',
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                      fontSize: 15,
                    ),
                  ),
                  const Spacer(),
                  const SizedBox(width: 40),
                ],
              ),
              if (outcomeAsset != null)
                SizedBox(
                  width: 58,
                  height: 58,
                  child: Image.asset(
                    outcomeAsset,
                    fit: BoxFit.contain,
                    filterQuality: FilterQuality.high,
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                _outcomeLabel(outcomeId),
                style: const TextStyle(
                  color: _gold,
                  fontWeight: FontWeight.w900,
                  fontSize: 17,
                ),
              ),
              const SizedBox(height: 12),
              const Align(
                alignment: AlignmentDirectional.centerStart,
                child: Text(
                  'الأكثر ربحاً في هذه الجولة',
                  style: TextStyle(
                    color: Colors.white70,
                    fontWeight: FontWeight.w800,
                    fontSize: 11,
                  ),
                ),
              ),
              const SizedBox(height: 7),
              if (topWinners.isEmpty)
                const Text(
                  'لا يوجد رابحون في هذه الجولة',
                  style: TextStyle(color: Colors.white38, fontSize: 10),
                )
              else
                Row(
                  children: List.generate(topWinners.length, (index) {
                    final winner = topWinners[index];
                    final name = (winner['displayName'] ?? 'مستخدم').toString();
                    final photo = (winner['photoUrl'] ?? '').toString();
                    final won = (winner['payoutCoins'] as num?)?.toInt() ?? 0;
                    return Expanded(
                      child: Container(
                        margin: EdgeInsetsDirectional.only(
                          end: index == topWinners.length - 1 ? 0 : 6,
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 8,
                        ),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(16),
                          color: Colors.white.withValues(alpha: .055),
                          border: Border.all(
                            color: index == 0
                                ? _gold.withValues(alpha: .62)
                                : Colors.white.withValues(alpha: .10),
                          ),
                        ),
                        child: Column(
                          children: [
                            Text(
                              '#${index + 1}',
                              style: TextStyle(
                                color: index == 0 ? _gold : Colors.white54,
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                            const SizedBox(height: 4),
                            CircleAvatar(
                              radius: 18,
                              backgroundColor: Colors.white10,
                              backgroundImage:
                                  photo.isEmpty ? null : NetworkImage(photo),
                              child: photo.isEmpty
                                  ? const Icon(
                                      Icons.person_rounded,
                                      color: Colors.white54,
                                      size: 18,
                                    )
                                  : null,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 9,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            Text(
                              '+${_coins(won)}',
                              style: const TextStyle(
                                color: _gold,
                                fontSize: 10,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }),
                ),
              const SizedBox(height: 12),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(16),
                  color: _purple.withValues(alpha: .10),
                  border: Border.all(
                    color: _purple.withValues(alpha: .24),
                  ),
                ),
                child: Column(
                  children: [
                    const Text(
                      'نتيجتك في هذه الجولة',
                      style: TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.w900,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            'دفعت بالجولة: ${_coins(stake)} Coins',
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white70,
                              fontWeight: FontWeight.w800,
                              fontSize: 10,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'ربحت بالجولة: ${_coins(payout)} Coins',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              color: payout > 0 ? _gold : Colors.white60,
                              fontWeight: FontWeight.w900,
                              fontSize: 10,
                            ),
                          ),
                        ),
                      ],
                    ),
                    if (myRound == null) ...[
                      const SizedBox(height: 4),
                      const Text(
                        'لم تشارك في هذه الجولة',
                        style: TextStyle(
                          color: Colors.white54,
                          fontSize: 10,
                        ),
                      ),
                    ] else if (payout <= 0) ...[
                      const SizedBox(height: 4),
                      const Text(
                        'حظ أوفر 🍀',
                        style: TextStyle(
                          color: Colors.white54,
                          fontSize: 10,
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _witchBoard() {
    final advanced = _selected?.mode == 'advanced';
    final multipliers = advanced
        ? const ['×2.2', '×3', '×4.5', '×6', '×9', '×16']
        : const ['×1.8', '×2.2', '×3', '×4', '×6', '×10'];
    const ids = ['moon', 'mirror', 'potion', 'orb', 'owl', 'book'];
    final assets = ids.map((id) => GameAssetPaths.witchSymbols[id]!).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'اضغط على الرمز لإضافة الرهان • الضغطات على نفس الرمز تتجمع',
          style: TextStyle(color: Colors.white54, fontSize: 10),
        ),
        const SizedBox(height: 8),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: ids.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            childAspectRatio: 1.05,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
          ),
          itemBuilder: (_, index) =>
              _choiceTile(ids[index], multipliers[index], assets[index]),
        ),
      ],
    );
  }

  Widget _choiceTile(String id, String label, String assetPath) {
    final total = _state?.currentRoundSelections[id] ?? 0;
    return InkWell(
      onTap: _placing ? null : () => _placeChoice(id),
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(7),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: total > 0
              ? _accent.withValues(alpha: .16)
              : const Color(0xFF111522),
          border: Border.all(
            color: total > 0
                ? _accent.withValues(alpha: .65)
                : Colors.white.withValues(alpha: .07),
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 44,
              height: 44,
              child: Image.asset(
                assetPath,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.medium,
                errorBuilder: (_, __, ___) => Icon(
                  Icons.image_not_supported_outlined,
                  color: _accent,
                  size: 24,
                ),
              ),
            ),
            const SizedBox(height: 3),
            Text(
              label,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
                fontSize: 10,
              ),
            ),
            if (total > 0) ...[
              const SizedBox(height: 3),
              Text(
                'رهانك ${_coins(total)}',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: _accent,
                  fontWeight: FontWeight.w800,
                  fontSize: 8.5,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _slotBoard() {
    final result = _slotResult;
    final reels = result?.reels ?? const <String>[];
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF121934), Color(0xFF1A0D2D)],
            ),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: _cyan.withValues(alpha: .30)),
          ),
          child: Row(
            children: List.generate(
              3,
              (index) => Expanded(
                child: Container(
                  height: 88,
                  margin: EdgeInsetsDirectional.only(start: index == 0 ? 0 : 7),
                  decoration: BoxDecoration(
                    color: const Color(0xFF080B16),
                    borderRadius: BorderRadius.circular(16),
                  ),
                  alignment: Alignment.center,
                  child: index < reels.length &&
                          GameAssetPaths.slotSymbols[reels[index]] != null
                      ? Padding(
                          padding: const EdgeInsets.all(10),
                          child: Image.asset(
                            GameAssetPaths.slotSymbols[reels[index]]!,
                            fit: BoxFit.contain,
                            filterQuality: FilterQuality.medium,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.casino_rounded,
                              color: Colors.white70,
                              size: 30,
                            ),
                          ),
                        )
                      : const Icon(
                          Icons.casino_rounded,
                          color: Colors.white54,
                          size: 30,
                        ),
                ),
              ),
            ),
          ),
        ),
        if (result != null) ...[
          const SizedBox(height: 9),
          if (result.outcomeId == 'jackpot')
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: SizedBox(
                height: 58,
                child: Image.asset(
                  GameAssetPaths.slotJackpot,
                  fit: BoxFit.contain,
                  filterQuality: FilterQuality.medium,
                ),
              ),
            ),
          Text(
            'النتيجة: ${_outcomeLabel(result.outcomeId ?? '')} • '
            'الدفع ${_coins(result.payoutCoins ?? 0)}',
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w800,
              fontSize: 11,
            ),
          ),
        ],
        const SizedBox(height: 12),
        FilledButton.icon(
          onPressed: _placing || _autoPlaying ? null : () => _placeChoice('spin'),
          style: FilledButton.styleFrom(
            backgroundColor: _cyan,
            foregroundColor: const Color(0xFF041018),
            minimumSize: const Size.fromHeight(48),
          ),
          icon: _placing && !_autoPlaying
              ? const SizedBox(
                  width: 17,
                  height: 17,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.casino_rounded),
          label: Text(
            'Spin • ${_coins(_currentBet)} Coins',
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
        const SizedBox(height: 8),
        OutlinedButton.icon(
          onPressed: _placing && !_autoPlaying ? null : _toggleAutoPlay,
          style: OutlinedButton.styleFrom(
            foregroundColor: _autoPlaying ? Colors.orangeAccent : _cyan,
            side: BorderSide(
              color: (_autoPlaying ? Colors.orangeAccent : _cyan)
                  .withValues(alpha: .65),
            ),
            minimumSize: const Size.fromHeight(44),
          ),
          icon: Icon(
            _autoPlaying ? Icons.stop_circle_rounded : Icons.autorenew_rounded,
          ),
          label: Text(
            _autoPlaying
                ? 'إيقاف Auto Play • ${_coins(_autoBetAmount ?? _currentBet)}'
                : 'Auto Play • نفس الرهان حتى الإيقاف',
            style: const TextStyle(fontWeight: FontWeight.w900),
          ),
        ),
      ],
    );
  }

  String _outcomeLabel(String id) {
    const labels = {
      'salad': '🥗 سلطة',
      'pizza': '🍕 بيتزا',
      'pepper5': '🫑 ×5',
      'tomato5': '🍅 ×5',
      'cabbage5': '🥬 ×5',
      'carrot5': '🥕 ×5',
      'chicken10': '🍗 ×10',
      'fish15': '🐟 ×15',
      'steak25': '🥩 ×25',
      'shell45': '🐚 ×45',
      'moon': '🌙 القمر',
      'mirror': '🪞 المرآة',
      'potion': '🧪 الجرعة',
      'orb': '🔮 الكرة',
      'owl': '🦉 البومة',
      'book': '📖 الكتاب',
      'lose': 'بدون ربح',
      'pair': 'تطابق مزدوج',
      'jackpot': 'JACKPOT',
    };
    return labels[id] ?? id;
  }
}
