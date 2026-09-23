import 'dart:async';
import 'dart:math';

import 'package:flutter/material.dart';

const _bg = Color(0xFF05060D);
const _gold = Color(0xFFFFC84A);
const _purple = Color(0xFF8A3DFF);

String _formatCoins(int value) {
  if (value >= 1000000) {
    final number = value / 1000000;
    return '${number.toStringAsFixed(number % 1 == 0 ? 0 : 1)}M';
  }
  if (value >= 1000) {
    final number = value / 1000;
    return '${number.toStringAsFixed(number % 1 == 0 ? 0 : 1)}K';
  }
  return '$value';
}

String _dayKey() {
  final now = DateTime.now();
  return '${now.year}-${now.month}-${now.day}';
}

class _RoundResult {
  const _RoundResult({
    required this.round,
    required this.label,
    required this.multiplier,
  });

  final int round;
  final String label;
  final String multiplier;
}

class GreedyCatGameScreen extends StatefulWidget {
  const GreedyCatGameScreen({super.key});

  @override
  State<GreedyCatGameScreen> createState() => _GreedyCatGameScreenState();
}

class _GreedyCatGameScreenState extends State<GreedyCatGameScreen> {
  static const _bets = [200, 2000, 20000, 200000];
  static const _options = [
    ('سمكة ذهبية', '×2.0', Icons.set_meal_rounded),
    ('حليب', '×2.4', Icons.local_drink_rounded),
    ('جرس', '×3.1', Icons.notifications_active_rounded),
    ('كرة صوف', '×3.8', Icons.sports_baseball_rounded),
    ('تاج', '×5.0', Icons.workspace_premium_rounded),
    ('ماسة', '×7.5', Icons.diamond_rounded),
    ('خزنة', '×10', Icons.lock_rounded),
    ('ظل القط', '×18', Icons.pets_rounded),
  ];

  final _random = Random();
  final List<_RoundResult> _history = [];
  Timer? _dayTimer;
  String _day = _dayKey();
  int _betIndex = 0;
  int? _selected;
  int? _winner;
  bool _locked = false;
  bool _settling = false;
  String _status = 'اختر بابًا قبل إغلاق الجولة';
  int _round = 1;

  @override
  void initState() {
    super.initState();
    _dayTimer = Timer.periodic(
      const Duration(seconds: 30),
      (_) => _syncDailyRound(),
    );
  }

  @override
  void dispose() {
    _dayTimer?.cancel();
    super.dispose();
  }

  void _syncDailyRound() {
    final nextDay = _dayKey();
    if (!mounted || nextDay == _day) return;
    setState(() {
      _day = nextDay;
      _round = 1;
      _selected = null;
      _winner = null;
      _locked = false;
      _settling = false;
      _history.clear();
      _status = 'يوم جديد • الجولة رقم 1 جاهزة';
    });
  }

  Future<void> _joinRound() async {
    if (_selected == null || _settling) return;
    setState(() {
      _locked = true;
      _settling = true;
      _winner = null;
      _status = 'تم تثبيت اختيارك • جارٍ حسم الجولة...';
    });
    await Future<void>.delayed(const Duration(milliseconds: 850));
    if (!mounted) return;
    final winner = _random.nextInt(_options.length);
    final item = _options[winner];
    setState(() {
      _winner = winner;
      _status = winner == _selected
          ? 'ربحت الجولة! الفائز: ${item.$1} ${item.$2}'
          : 'انتهت الجولة • الفائز: ${item.$1} ${item.$2}';
      _history.insert(
        0,
        _RoundResult(
          round: _round,
          label: item.$1,
          multiplier: item.$2,
        ),
      );
      if (_history.length > 6) _history.removeLast();
      _settling = false;
    });
  }

  void _nextRound() {
    setState(() {
      _round++;
      _selected = null;
      _winner = null;
      _locked = false;
      _settling = false;
      _status = 'اختر بابًا قبل إغلاق الجولة';
    });
  }

  @override
  Widget build(BuildContext context) {
    return _GameScaffold(
      title: 'القط الجشع',
      subtitle: 'جولة عالمية موحّدة • اليوم #$_round',
      accent: _gold,
      icon: Icons.pets_rounded,
      child: Column(
        children: [
          const _DemoNotice(),
          const SizedBox(height: 12),
          _DailyRoundBar(
            round: _round,
            accent: _gold,
            gameLabel: 'القط الجشع',
          ),
          const SizedBox(height: 12),
          _GameIdentityBanner(
            accent: _gold,
            icon: Icons.pets_rounded,
            title: 'اختَر غنيمتك قبل أن يصل القط',
            subtitle: 'ثمانية اختيارات • نتيجة واحدة موحّدة لكل اللاعبين',
          ),
          const SizedBox(height: 12),
          _RoundStatusCard(
            label: _status,
            accent: _gold,
            locked: _locked,
          ),
          const SizedBox(height: 14),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _options.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              childAspectRatio: 1.55,
              crossAxisSpacing: 10,
              mainAxisSpacing: 10,
            ),
            itemBuilder: (context, index) {
              final item = _options[index];
              return _ChoiceTile(
                title: item.$1,
                multiplier: item.$2,
                icon: item.$3,
                accent: _gold,
                selected: _selected == index,
                winner: _winner == index,
                disabled: _locked,
                onTap: () => setState(() => _selected = index),
              );
            },
          ),
          const SizedBox(height: 16),
          _BetPicker(
            values: _bets,
            index: _betIndex,
            accent: _gold,
            enabled: !_locked,
            onChanged: (index) => setState(() => _betIndex = index),
          ),
          const SizedBox(height: 12),
          _PrimaryGameButton(
            label: _locked
                ? 'الجولة التالية'
                : 'شارك بـ ${_formatCoins(_bets[_betIndex])} Coins',
            accent: _gold,
            enabled: _locked || _selected != null,
            busy: _settling,
            onPressed: _locked ? _nextRound : _joinRound,
          ),
          const SizedBox(height: 16),
          _RoundHistory(
            title: 'آخر نتائج القط الجشع',
            items: _history,
            accent: _gold,
          ),
        ],
      ),
    );
  }
}

class WitchGameScreen extends StatefulWidget {
  const WitchGameScreen({super.key});

  @override
  State<WitchGameScreen> createState() => _WitchGameScreenState();
}

class _WitchGameScreenState extends State<WitchGameScreen> {
  static const _normalBets = [100, 1000, 10000, 100000];
  static const _advancedBets = [200, 2000, 20000, 200000];
  static const _choices = [
    ('القمر', Icons.dark_mode_rounded),
    ('المرآة', Icons.blur_on_rounded),
    ('الجرعة', Icons.science_rounded),
    ('الكرة', Icons.circle_outlined),
    ('البومة', Icons.visibility_rounded),
    ('الكتاب', Icons.menu_book_rounded),
  ];

  final _random = Random();
  bool _advanced = false;
  int _betIndex = 0;
  int? _selected;
  bool _settling = false;
  String _message = 'اختَر رمز الساحرة';
  int _round = 7831;

  List<int> get _bets => _advanced ? _advancedBets : _normalBets;

  Future<void> _play() async {
    if (_selected == null || _settling) return;
    setState(() {
      _settling = true;
      _message = 'الساحرة تحسم النتيجة...';
    });
    await Future<void>.delayed(const Duration(milliseconds: 900));
    if (!mounted) return;
    final winner = _random.nextInt(_choices.length);
    setState(() {
      _message = winner == _selected
          ? 'اختيار موفق • ${_choices[winner].$1}'
          : 'النتيجة: ${_choices[winner].$1}';
      _settling = false;
      _round++;
    });
  }

  @override
  Widget build(BuildContext context) {
    const accent = Color(0xFFB96CFF);
    return _GameScaffold(
      title: 'الساحرة',
      subtitle: 'Round #$_round • ${_advanced ? 'متقدم' : 'عادي'}',
      accent: accent,
      icon: Icons.auto_awesome_rounded,
      child: Column(
        children: [
          const _DemoNotice(),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(5),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: .04),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.white.withValues(alpha: .08)),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _ModeButton(
                    text: 'عادي',
                    selected: !_advanced,
                    accent: accent,
                    onTap: () => setState(() {
                      _advanced = false;
                      _betIndex = 0;
                    }),
                  ),
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: _ModeButton(
                    text: 'متقدم',
                    selected: _advanced,
                    accent: accent,
                    onTap: () => setState(() {
                      _advanced = true;
                      _betIndex = 0;
                    }),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          _RoundStatusCard(
            label: _message,
            accent: accent,
            locked: _settling,
          ),
          const SizedBox(height: 12),
          GridView.builder(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _choices.length,
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 3,
              childAspectRatio: .98,
              crossAxisSpacing: 9,
              mainAxisSpacing: 9,
            ),
            itemBuilder: (context, index) {
              final multiplier = _advanced
                  ? ['×2.2', '×3', '×4.5', '×6', '×9', '×16'][index]
                  : ['×1.8', '×2.2', '×3', '×4', '×6', '×10'][index];
              return _ChoiceTile(
                title: _choices[index].$1,
                multiplier: multiplier,
                icon: _choices[index].$2,
                accent: accent,
                selected: _selected == index,
                disabled: _settling,
                compact: true,
                onTap: () => setState(() => _selected = index),
              );
            },
          ),
          const SizedBox(height: 16),
          _BetPicker(
            values: _bets,
            index: _betIndex,
            accent: accent,
            enabled: !_settling,
            onChanged: (index) => setState(() => _betIndex = index),
          ),
          const SizedBox(height: 12),
          _PrimaryGameButton(
            label: 'شارك بـ ${_formatCoins(_bets[_betIndex])} Coins',
            accent: accent,
            enabled: _selected != null,
            busy: _settling,
            onPressed: _play,
          ),
        ],
      ),
    );
  }
}

class ShadowSlotGameScreen extends StatefulWidget {
  const ShadowSlotGameScreen({super.key});

  @override
  State<ShadowSlotGameScreen> createState() => _ShadowSlotGameScreenState();
}

class _ShadowSlotGameScreenState extends State<ShadowSlotGameScreen> {
  static const _bets = [200, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000];
  static const _symbols = [
    ('👑', 'تاج'),
    ('💎', 'ماسة'),
    ('⭐', 'نجمة'),
    ('🎙️', 'مايك'),
    ('🌙', 'قمر'),
    ('🔥', 'نار'),
  ];

  final _random = Random();
  int _betIndex = 0;
  List<int> _reels = [0, 1, 2];
  bool _spinning = false;
  bool _auto = false;
  String _message = 'اضغط Spin وابدأ';
  Timer? _autoTimer;

  @override
  void dispose() {
    _autoTimer?.cancel();
    super.dispose();
  }

  Future<void> _spin() async {
    if (_spinning) return;
    setState(() {
      _spinning = true;
      _message = 'Spin...';
    });
    await Future<void>.delayed(const Duration(milliseconds: 620));
    if (!mounted) return;
    final next = List.generate(3, (_) => _random.nextInt(_symbols.length));
    final jackpot = next.toSet().length == 1;
    final pair = next.toSet().length == 2;
    setState(() {
      _reels = next;
      _spinning = false;
      _message = jackpot
          ? 'JACKPOT • ثلاث رموز متطابقة!'
          : pair
              ? 'تطابق مزدوج'
              : 'جرّب لفة جديدة';
    });
  }

  void _toggleAuto() {
    final next = !_auto;
    setState(() => _auto = next);
    _autoTimer?.cancel();
    if (next) {
      _autoTimer = Timer.periodic(const Duration(milliseconds: 1200), (_) {
        if (mounted) _spin();
      });
      _spin();
    }
  }

  @override
  Widget build(BuildContext context) {
    const accent = Color(0xFF49D7FF);
    return _GameScaffold(
      title: 'Shadow Slot',
      subtitle: 'Spin • Auto Play',
      accent: accent,
      icon: Icons.casino_rounded,
      child: Column(
        children: [
          const _DemoNotice(),
          const SizedBox(height: 14),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(26),
              gradient: const LinearGradient(
                colors: [Color(0xFF121934), Color(0xFF1A0D2D)],
              ),
              border: Border.all(
                color: accent.withValues(alpha: .32),
              ),
              boxShadow: [
                BoxShadow(
                  color: accent.withValues(alpha: .12),
                  blurRadius: 22,
                ),
              ],
            ),
            child: Column(
              children: [
                Row(
                  children: List.generate(3, (index) {
                    final symbol = _symbols[_reels[index]];
                    return Expanded(
                      child: Container(
                        height: 112,
                        margin: EdgeInsetsDirectional.only(
                          start: index == 0 ? 0 : 7,
                        ),
                        decoration: BoxDecoration(
                          color: const Color(0xFF080B16),
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: .10),
                          ),
                        ),
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 220),
                          child: Column(
                            key: ValueKey('${_reels[index]}-$_spinning'),
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Text(
                                _spinning ? '✦' : symbol.$1,
                                style: const TextStyle(fontSize: 38),
                              ),
                              const SizedBox(height: 5),
                              Text(
                                _spinning ? '...' : symbol.$2,
                                style: const TextStyle(
                                  color: Colors.white60,
                                  fontSize: 10.5,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  }),
                ),
                const SizedBox(height: 12),
                Text(
                  _message,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          _BetPicker(
            values: _bets,
            index: _betIndex,
            accent: accent,
            enabled: !_spinning && !_auto,
            onChanged: (index) => setState(() => _betIndex = index),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _SecondaryButton(
                  label: _auto ? 'إيقاف Auto' : 'Auto Play',
                  active: _auto,
                  accent: accent,
                  onPressed: _toggleAuto,
                ),
              ),
              const SizedBox(width: 9),
              Expanded(
                flex: 2,
                child: _PrimaryGameButton(
                  label: 'Spin • ${_formatCoins(_bets[_betIndex])}',
                  accent: accent,
                  enabled: !_auto,
                  busy: _spinning,
                  onPressed: _spin,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _GameScaffold extends StatelessWidget {
  const _GameScaffold({
    required this.title,
    required this.subtitle,
    required this.accent,
    required this.icon,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Color accent;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: _bg,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 10, 14, 8),
                child: Row(
                  children: [
                    InkWell(
                      onTap: () => Navigator.of(context).maybePop(),
                      borderRadius: BorderRadius.circular(999),
                      child: Container(
                        width: 42,
                        height: 42,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: .05),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: .09),
                          ),
                        ),
                        child: const Icon(
                          Icons.arrow_forward_rounded,
                          color: Colors.white,
                        ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    Container(
                      width: 42,
                      height: 42,
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(14),
                        color: accent.withValues(alpha: .16),
                      ),
                      child: Icon(icon, color: accent, size: 24),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 19,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          Text(
                            subtitle,
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 10.5,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 9,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        color: _gold.withValues(alpha: .10),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Row(
                        children: [
                          Icon(
                            Icons.toll_rounded,
                            size: 15,
                            color: _gold,
                          ),
                          SizedBox(width: 4),
                          Text(
                            'Coins',
                            style: TextStyle(
                              color: Color(0xFFFFE082),
                              fontSize: 10.5,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(14, 8, 14, 26),
                  child: child,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DemoNotice extends StatelessWidget {
  const _DemoNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        color: const Color(0xFF70C7FF).withValues(alpha: .08),
        border: Border.all(
          color: const Color(0xFF70C7FF).withValues(alpha: .20),
        ),
      ),
      child: const Row(
        children: [
          Icon(
            Icons.science_outlined,
            color: Color(0xFF70C7FF),
            size: 17,
          ),
          SizedBox(width: 8),
          Expanded(
            child: Text(
              'نسخة تصميم واختبار: التفاعل يعمل الآن بدون خصم أو إضافة Coins.',
              style: TextStyle(
                color: Color(0xFFB8E4FF),
                fontSize: 10.5,
                height: 1.35,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _RoundStatusCard extends StatelessWidget {
  const _RoundStatusCard({
    required this.label,
    required this.accent,
    required this.locked,
  });

  final String label;
  final Color accent;
  final bool locked;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(13),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: LinearGradient(
          colors: [
            accent.withValues(alpha: .12),
            Colors.white.withValues(alpha: .02),
          ],
        ),
        border: Border.all(color: accent.withValues(alpha: .20)),
      ),
      child: Row(
        children: [
          Icon(
            locked ? Icons.lock_clock_rounded : Icons.timer_outlined,
            color: accent,
            size: 21,
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ChoiceTile extends StatelessWidget {
  const _ChoiceTile({
    required this.title,
    required this.multiplier,
    required this.icon,
    required this.accent,
    required this.selected,
    required this.disabled,
    required this.onTap,
    this.compact = false,
  });

  final String title;
  final String multiplier;
  final IconData icon;
  final Color accent;
  final bool selected;
  final bool disabled;
  final bool compact;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: disabled ? null : onTap,
      borderRadius: BorderRadius.circular(18),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 170),
        padding: EdgeInsets.all(compact ? 9 : 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(18),
          gradient: selected
              ? LinearGradient(
                  colors: [
                    accent.withValues(alpha: .34),
                    accent.withValues(alpha: .10),
                  ],
                )
              : const LinearGradient(
                  colors: [Color(0xFF111420), Color(0xFF0A0C14)],
                ),
          border: Border.all(
            color: selected
                ? accent.withValues(alpha: .75)
                : Colors.white.withValues(alpha: .08),
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: selected ? accent : Colors.white70, size: compact ? 25 : 29),
            const SizedBox(height: 7),
            Text(
              title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: selected ? Colors.white : Colors.white70,
                fontWeight: FontWeight.w800,
                fontSize: compact ? 10.5 : 11.5,
              ),
            ),
            const SizedBox(height: 3),
            Text(
              multiplier,
              style: TextStyle(
                color: accent,
                fontWeight: FontWeight.w900,
                fontSize: compact ? 10 : 11,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BetPicker extends StatelessWidget {
  const _BetPicker({
    required this.values,
    required this.index,
    required this.accent,
    required this.enabled,
    required this.onChanged,
  });

  final List<int> values;
  final int index;
  final Color accent;
  final bool enabled;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final current = values[index];
    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: .035),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white.withValues(alpha: .08)),
      ),
      child: Row(
        children: [
          IconButton.filledTonal(
            onPressed: enabled && index > 0 ? () => onChanged(index - 1) : null,
            icon: const Icon(Icons.remove_rounded),
            style: IconButton.styleFrom(
              backgroundColor: accent.withValues(alpha: .12),
              foregroundColor: accent,
            ),
          ),
          Expanded(
            child: Column(
              children: [
                const Text(
                  'قيمة المشاركة',
                  style: TextStyle(
                    color: Colors.white54,
                    fontSize: 10,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  '${_formatCoins(current)} Coins',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 16,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
          ),
          IconButton.filledTonal(
            onPressed: enabled && index < values.length - 1
                ? () => onChanged(index + 1)
                : null,
            icon: const Icon(Icons.add_rounded),
            style: IconButton.styleFrom(
              backgroundColor: accent.withValues(alpha: .12),
              foregroundColor: accent,
            ),
          ),
        ],
      ),
    );
  }
}

class _PrimaryGameButton extends StatelessWidget {
  const _PrimaryGameButton({
    required this.label,
    required this.accent,
    required this.enabled,
    required this.busy,
    required this.onPressed,
  });

  final String label;
  final Color accent;
  final bool enabled;
  final bool busy;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 52,
      child: FilledButton(
        onPressed: enabled && !busy ? onPressed : null,
        style: FilledButton.styleFrom(
          backgroundColor: accent,
          foregroundColor: const Color(0xFF090A10),
          disabledBackgroundColor: Colors.white.withValues(alpha: .08),
          disabledForegroundColor: Colors.white38,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: busy
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2.4,
                  color: Colors.white,
                ),
              )
            : Text(
                label,
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 13,
                ),
              ),
      ),
    );
  }
}

class _SecondaryButton extends StatelessWidget {
  const _SecondaryButton({
    required this.label,
    required this.active,
    required this.accent,
    required this.onPressed,
  });

  final String label;
  final bool active;
  final Color accent;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 52,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          side: BorderSide(
            color: active ? accent : Colors.white24,
          ),
          backgroundColor:
              active ? accent.withValues(alpha: .10) : Colors.transparent,
          foregroundColor: active ? accent : Colors.white70,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        child: Text(
          label,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontWeight: FontWeight.w800,
            fontSize: 11,
          ),
        ),
      ),
    );
  }
}

class _ModeButton extends StatelessWidget {
  const _ModeButton({
    required this.text,
    required this.selected,
    required this.accent,
    required this.onTap,
  });

  final String text;
  final bool selected;
  final Color accent;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          color: selected ? accent.withValues(alpha: .18) : Colors.transparent,
          border: Border.all(
            color: selected ? accent.withValues(alpha: .42) : Colors.transparent,
          ),
        ),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(
            color: selected ? Colors.white : Colors.white54,
            fontWeight: FontWeight.w900,
            fontSize: 12,
          ),
        ),
      ),
    );
  }
}
