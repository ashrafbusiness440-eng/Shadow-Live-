import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/game_runtime_service.dart';

class RoomGameOverlaySheet extends StatefulWidget {
  const RoomGameOverlaySheet({
    super.key,
    required this.roomId,
    this.initialGameKey,
  });

  final String roomId;
  final String? initialGameKey;

  @override
  State<RoomGameOverlaySheet> createState() => _RoomGameOverlaySheetState();
}

class _RoomGameOverlaySheetState extends State<RoomGameOverlaySheet> {
  final GameRuntimeService _service = GameRuntimeService();
  Timer? _poller;
  Timer? _ticker;

  List<GameCatalogEntry> _catalog = const [];
  GameCatalogEntry? _selected;
  GameRuntimeState? _state;
  GameBetResult? _slotResult;
  bool _loading = true;
  bool _placing = false;
  bool _minimized = false;
  bool _maximized = false;
  String? _error;
  int _betIndex = 0;
  int _clockTick = 0;

  static const _gold = Color(0xFFFFC84A);
  static const _purple = Color(0xFFB96CFF);
  static const _cyan = Color(0xFF49D7FF);

  @override
  void initState() {
    super.initState();
    _loadCatalog();
    _ticker = Timer.periodic(
      const Duration(seconds: 1),
      (_) {
        if (mounted) setState(() => _clockTick++);
      },
    );
  }

  @override
  void dispose() {
    _poller?.cancel();
    _ticker?.cancel();
    _service.close();
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
        _startPolling();
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

  void _startPolling() {
    _poller?.cancel();
    if (_selected?.gameId == 'slot') return;
    _poller = Timer.periodic(
      const Duration(seconds: 2),
      (_) => _loadState(silent: true),
    );
  }

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
    _startPolling();
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
    _startPolling();
  }

  Future<void> _loadState({bool silent = false}) async {
    final game = _selected;
    if (game == null) return;
    try {
      final state = await _service.loadState(game);
      if (!mounted || _selected?.key != game.key) return;
      setState(() {
        _state = state;
        _error = null;
        if (state.bets.isNotEmpty && _betIndex >= state.bets.length) {
          _betIndex = state.bets.length - 1;
        }
      });
    } catch (error) {
      if (!mounted || silent) return;
      setState(() => _error = _message(error));
    }
  }

  int get _currentBet {
    final game = _selected;
    final values = _state?.bets.isNotEmpty == true
        ? _state!.bets
        : game?.bets ?? const <int>[];
    if (values.isEmpty) return 0;
    final index = _betIndex.clamp(0, values.length - 1);
    return values[index];
  }

  List<int> get _betValues {
    final game = _selected;
    return _state?.bets.isNotEmpty == true
        ? _state!.bets
        : game?.bets ?? const <int>[];
  }

  Future<void> _placeChoice(String choiceId) async {
    final game = _selected;
    final amount = _currentBet;
    if (game == null || amount <= 0 || _placing) return;
    setState(() {
      _placing = true;
      _error = null;
    });
    try {
      final result = await _service.placeBet(
        game: game,
        roomId: widget.roomId,
        amountCoins: amount,
        choiceId: choiceId,
      );
      if (!mounted) return;
      setState(() => _slotResult = result);
      await _loadState(silent: true);
      if (!mounted) return;
      final text = game.gameId == 'slot'
          ? 'تمت اللفة • الدفع: ${_coins(result.payoutCoins ?? 0)}'
          : 'تمت إضافة ${_coins(amount)} على الخيار';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(text)),
      );
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = _message(error));
    } finally {
      if (mounted) setState(() => _placing = false);
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
    final round = _state?.round;
    if (round == null) return 0;
    final closes = (round['closesAtMs'] as num?)?.toInt() ?? 0;
    final serverAtFetch = _state?.serverNowMs ?? 0;
    if (closes <= 0 || serverAtFetch <= 0) return 0;
    final delta = serverAtFetch - DateTime.now().millisecondsSinceEpoch;
    final serverNow = DateTime.now().millisecondsSinceEpoch + delta;
    return ((closes - serverNow) / 1000).ceil().clamp(0, 999);
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

  @override
  Widget build(BuildContext context) {
    final screenHeight = MediaQuery.sizeOf(context).height;
    final factor = _minimized ? .16 : (_maximized ? .94 : .70);
    return AnimatedContainer(
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
            child: Icon(
              game == null
                  ? Icons.sports_esports_rounded
                  : game.gameId == 'greedy_cat'
                      ? Icons.pets_rounded
                      : game.gameId == 'witch'
                          ? Icons.auto_awesome_rounded
                          : Icons.casino_rounded,
              color: _accent,
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
          child: Text(
            _error!,
            style: const TextStyle(color: Colors.orangeAccent),
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
          leading: CircleAvatar(
            backgroundColor: accent.withValues(alpha: .14),
            child: Icon(icon, color: accent),
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
    return Column(
      children: [
        _statusBar(game),
        if (_error != null)
          Container(
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
          ),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 20),
            children: [
              if (game.gameId == 'witch') _witchModesBar(),
              if (game.gameId != 'slot') _roundCard(),
              const SizedBox(height: 10),
              _betPicker(),
              const SizedBox(height: 12),
              if (game.gameId == 'greedy_cat') _greedyBoard(),
              if (game.gameId == 'witch') _witchBoard(),
              if (game.gameId == 'slot') _slotBoard(),
            ],
          ),
        ),
      ],
    );
  }

  Widget _statusBar(GameCatalogEntry game) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
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
            onPressed: _placing || _betIndex <= 0
                ? null
                : () => setState(() => _betIndex--),
            icon: const Icon(Icons.remove_rounded),
          ),
          Expanded(
            child: Column(
              children: [
                const Text(
                  'قيمة الضغطة الحالية',
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
            onPressed: _placing || _betIndex >= values.length - 1
                ? null
                : () => setState(() => _betIndex++),
            icon: const Icon(Icons.add_rounded),
          ),
        ],
      ),
    );
  }

  Widget _greedyBoard() {
    const choices = [
      ('pepper5', '×5 • فلفل', '🫑'),
      ('tomato5', '×5 • طماطم', '🍅'),
      ('cabbage5', '×5 • ملفوف', '🥬'),
      ('carrot5', '×5 • جزر', '🥕'),
      ('chicken10', '×10', '🍗'),
      ('fish15', '×15', '🐟'),
      ('steak25', '×25', '🥩'),
      ('shell45', '×45', '🐚'),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Text(
          'اضغط على الخيار لإضافة الرهان • كل ضغطة تتراكم',
          style: TextStyle(color: Colors.white54, fontSize: 10),
        ),
        const SizedBox(height: 8),
        GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: choices.length,
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 4,
            childAspectRatio: .88,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
          ),
          itemBuilder: (_, index) {
            final item = choices[index];
            return _choiceTile(item.$1, item.$2, item.$3);
          },
        ),
        const SizedBox(height: 10),
        Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(14),
            color: Colors.white.withValues(alpha: .03),
          ),
          child: const Text(
            '🥗 سلطة: كل خانات ×5 تربح معاً • 🍕 بيتزا: ×10 + ×15 + ×25 + ×45 تربح معاً',
            style: TextStyle(
              color: Colors.white70,
              fontSize: 10,
              height: 1.4,
            ),
          ),
        ),
      ],
    );
  }

  Widget _witchBoard() {
    final advanced = _selected?.mode == 'advanced';
    final multipliers = advanced
        ? const ['×2.2', '×3', '×4.5', '×6', '×9', '×16']
        : const ['×1.8', '×2.2', '×3', '×4', '×6', '×10'];
    const ids = ['moon', 'mirror', 'potion', 'orb', 'owl', 'book'];
    const icons = ['🌙', '🪞', '🧪', '🔮', '🦉', '📖'];
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
              _choiceTile(ids[index], multipliers[index], icons[index]),
        ),
      ],
    );
  }

  Widget _choiceTile(String id, String label, String emoji) {
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
            Text(emoji, style: const TextStyle(fontSize: 24)),
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
    String symbol(String raw) {
      switch (raw) {
        case 'crown':
          return '👑';
        case 'diamond':
          return '💎';
        case 'star':
          return '⭐';
        case 'mic':
          return '🎙️';
        case 'moon':
          return '🌙';
        case 'fire':
          return '🔥';
        default:
          return '✦';
      }
    }

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
                  child: Text(
                    index < reels.length ? symbol(reels[index]) : '✦',
                    style: const TextStyle(fontSize: 34),
                  ),
                ),
              ),
            ),
          ),
        ),
        if (result != null) ...[
          const SizedBox(height: 9),
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
          onPressed: _placing ? null : () => _placeChoice('spin'),
          style: FilledButton.styleFrom(
            backgroundColor: _cyan,
            foregroundColor: const Color(0xFF041018),
            minimumSize: const Size.fromHeight(48),
          ),
          icon: _placing
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
