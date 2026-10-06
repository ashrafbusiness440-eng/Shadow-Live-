import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

class CosmeticAssetVisual extends StatelessWidget {
  const CosmeticAssetVisual({
    super.key,
    this.assetKey = '',
    this.imageUrl = '',
    this.fit = BoxFit.contain,
    this.alignment = Alignment.center,
  });

  final String assetKey;
  final String imageUrl;
  final BoxFit fit;
  final Alignment alignment;

  Widget _network(String url) => Image.network(
        url,
        fit: fit,
        alignment: alignment,
        gaplessPlayback: true,
        filterQuality: FilterQuality.high,
        errorBuilder: (_, __, ___) => const SizedBox.shrink(),
      );

  @override
  Widget build(BuildContext context) {
    final direct = imageUrl.trim();
    if (direct.isNotEmpty) return _network(direct);

    final key = assetKey.trim();
    if (key.isEmpty) return const SizedBox.shrink();

    return FutureBuilder<Uri?>(
      future: ShadowAssetRegistry.remoteUrl(key),
      builder: (context, snapshot) {
        final uri = snapshot.data;
        if (uri == null) return const SizedBox.shrink();
        return _network(uri.toString());
      },
    );
  }
}


const kAnimatedWealthLv2630FrameAssetKey =
    'levels.wealth.lv26_30.profileFrame';

bool usesAnimatedProfileFramePoc(String assetKey) =>
    assetKey.trim() == kAnimatedWealthLv2630FrameAssetKey;

class AnimatedProfileFrameVisual extends StatefulWidget {
  const AnimatedProfileFrameVisual({
    super.key,
    required this.assetKey,
    this.imageUrl = '',
    this.fit = BoxFit.contain,
    this.alignment = Alignment.center,
  });

  final String assetKey;
  final String imageUrl;
  final BoxFit fit;
  final Alignment alignment;

  @override
  State<AnimatedProfileFrameVisual> createState() =>
      _AnimatedProfileFrameVisualState();
}

class _AnimatedProfileFrameVisualState extends State<AnimatedProfileFrameVisual>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _environmentAllowsMotion = true;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 4),
    );
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final media = MediaQuery.maybeOf(context);
    _environmentAllowsMotion =
        TickerMode.of(context) && !(media?.disableAnimations ?? false);
    _syncController();
  }

  @override
  void didUpdateWidget(covariant AnimatedProfileFrameVisual oldWidget) {
    super.didUpdateWidget(oldWidget);
    _syncController();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _syncController() {
    final shouldAnimate = usesAnimatedProfileFramePoc(widget.assetKey) &&
        _environmentAllowsMotion;
    if (shouldAnimate) {
      if (!_controller.isAnimating) {
        _controller.repeat();
      }
    } else if (_controller.isAnimating) {
      _controller.stop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final base = CosmeticAssetVisual(
      assetKey: widget.assetKey,
      imageUrl: widget.imageUrl,
      fit: widget.fit,
      alignment: widget.alignment,
    );

    if (!usesAnimatedProfileFramePoc(widget.assetKey)) return base;

    return RepaintBoundary(
      key: const Key('wealth-lv26-30-animated-frame'),
      child: Stack(
        fit: StackFit.expand,
        alignment: Alignment.center,
        children: [
          base,
          IgnorePointer(
            child: CustomPaint(
              key: const Key('wealth-lv26-30-native-fx'),
              painter: _WealthLv2630FrameFxPainter(_controller),
            ),
          ),
        ],
      ),
    );
  }
}

class _WealthLv2630FrameFxPainter extends CustomPainter {
  _WealthLv2630FrameFxPainter(this.animation) : super(repaint: animation);

  final Animation<double> animation;

  @override
  void paint(Canvas canvas, Size size) {
    final shortest = size.shortestSide;
    if (shortest <= 0) return;

    final center = Offset(size.width / 2, size.height / 2);
    final t = animation.value;
    final cycle = t * math.pi * 2;
    final pulse = (math.sin(cycle) + 1) / 2;
    final slowPulse = (math.sin(cycle * .5 - math.pi / 2) + 1) / 2;
    final ringRadius = shortest * .405;
    final outerRadius = shortest * .455;
    final ringRect = Rect.fromCircle(center: center, radius: ringRadius);

    // Royal outer aura: two counter-moving arcs create depth without touching
    // the avatar center.
    final auraPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = shortest * .030
      ..color = const Color(0xFFFFA51F).withValues(
        alpha: .075 + (.055 * slowPulse),
      )
      ..maskFilter = MaskFilter.blur(
        BlurStyle.normal,
        shortest * .030,
      )
      ..blendMode = BlendMode.plus;
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: outerRadius),
      -math.pi * .95 + cycle * .35,
      math.pi * .56,
      false,
      auraPaint,
    );
    canvas.drawArc(
      Rect.fromCircle(center: center, radius: outerRadius),
      math.pi * .05 - cycle * .28,
      math.pi * .50,
      false,
      auraPaint,
    );

    // Main polished-gold sweep.
    final sweepStart = -math.pi / 2 + cycle;
    const sweepAngle = math.pi * .42;
    final specularHalo = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = shortest * .045
      ..color = const Color(0xFFFFC34A).withValues(alpha: .30)
      ..maskFilter = MaskFilter.blur(
        BlurStyle.normal,
        shortest * .024,
      )
      ..blendMode = BlendMode.plus;
    canvas.drawArc(
      ringRect,
      sweepStart,
      sweepAngle,
      false,
      specularHalo,
    );

    final specularCore = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = shortest * .018
      ..shader = SweepGradient(
        colors: const [
          Color(0x00FFF1B8),
          Color(0x88FFD36A),
          Color(0xFFFFF9E8),
          Color(0xFFFFE49A),
          Color(0x00FFD36A),
        ],
        stops: [0, .20, .50, .78, 1],
        transform: GradientRotation(sweepStart),
      ).createShader(ringRect)
      ..blendMode = BlendMode.plus;
    canvas.drawArc(
      ringRect,
      sweepStart,
      sweepAngle,
      false,
      specularCore,
    );

    // Opposing wing accents: two shorter highlights move in opposite
    // directions so the frame feels alive rather than simply rotating.
    final wingPaint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = shortest * .014
      ..color = const Color(0xFFFFE9A8).withValues(alpha: .72)
      ..maskFilter = MaskFilter.blur(
        BlurStyle.normal,
        shortest * .009,
      )
      ..blendMode = BlendMode.plus;
    canvas.drawArc(
      ringRect,
      math.pi * .72 - cycle * .55,
      math.pi * .17,
      false,
      wingPaint,
    );
    canvas.drawArc(
      ringRect,
      math.pi * .11 + cycle * .55,
      math.pi * .17,
      false,
      wingPaint,
    );

    // Crown / upper-gem pulse.
    final crown = Offset(center.dx, center.dy - shortest * .455);
    final crownGlow = Paint()
      ..shader = RadialGradient(
        colors: [
          const Color(0xFFFFF7D8).withValues(alpha: .48 + .28 * pulse),
          const Color(0xFFFFB52E).withValues(alpha: .20 + .18 * pulse),
          Colors.transparent,
        ],
        stops: const [0, .38, 1],
      ).createShader(
        Rect.fromCircle(center: crown, radius: shortest * .075),
      )
      ..blendMode = BlendMode.plus;
    canvas.drawCircle(crown, shortest * .075, crownGlow);
    _drawSparkle(
      canvas,
      crown,
      shortest * (.020 + .010 * pulse),
      .48 + .44 * pulse,
    );

    // Four tiny orbiting particles add premium motion while staying bounded.
    final particlePaint = Paint()
      ..blendMode = BlendMode.plus
      ..color = const Color(0xFFFFE7A0);
    for (var i = 0; i < 4; i++) {
      final phase = (t + i * .25) % 1.0;
      final angle = phase * math.pi * 2 + (i.isEven ? .18 : -.18);
      final orbit = outerRadius + shortest * (i.isEven ? .012 : -.004);
      final point = Offset(
        center.dx + math.cos(angle) * orbit,
        center.dy + math.sin(angle) * orbit,
      );
      final alpha =
          .20 + .62 * math.pow(math.sin(phase * math.pi), 2).toDouble();
      particlePaint.color =
          const Color(0xFFFFE7A0).withValues(alpha: alpha);
      canvas.drawCircle(
        point,
        shortest * (i.isEven ? .010 : .007),
        particlePaint,
      );
    }

    // Timed sparkle burst: brief accents on the outer ornaments instead of
    // constant visual noise.
    final burst = _burstEnvelope(t);
    if (burst > 0) {
      final burstAngles = <double>[
        -math.pi * .78,
        -math.pi * .22,
        math.pi * .22,
        math.pi * .78,
      ];
      for (var i = 0; i < burstAngles.length; i++) {
        final angle = burstAngles[i];
        final point = Offset(
          center.dx + math.cos(angle) * outerRadius,
          center.dy + math.sin(angle) * outerRadius,
        );
        _drawSparkle(
          canvas,
          point,
          shortest * (i.isEven ? .017 : .014),
          burst * (i.isEven ? .82 : .64),
        );
      }
    }
  }

  double _burstEnvelope(double t) {
    final local = ((t - .62) % 1.0 + 1.0) % 1.0;
    if (local > .20) return 0;
    final normalized = local / .20;
    return math.pow(math.sin(normalized * math.pi), 2).toDouble();
  }

  void _drawSparkle(
    Canvas canvas,
    Offset center,
    double radius,
    double alpha,
  ) {
    final glow = Paint()
      ..color = const Color(0xFFFFE6A3).withValues(alpha: alpha * .42)
      ..maskFilter = MaskFilter.blur(BlurStyle.normal, radius * .80)
      ..blendMode = BlendMode.plus;
    canvas.drawCircle(center, radius * .90, glow);

    final paint = Paint()
      ..color = const Color(0xFFFFF9EA).withValues(alpha: alpha)
      ..strokeWidth = math.max(1.0, radius * .15).toDouble()
      ..strokeCap = StrokeCap.round
      ..blendMode = BlendMode.plus;

    canvas.drawCircle(center, radius * .15, paint);
    canvas.drawLine(
      Offset(center.dx - radius, center.dy),
      Offset(center.dx + radius, center.dy),
      paint,
    );
    canvas.drawLine(
      Offset(center.dx, center.dy - radius),
      Offset(center.dx, center.dy + radius),
      paint,
    );
  }

  @override
  bool shouldRepaint(covariant _WealthLv2630FrameFxPainter oldDelegate) =>
      oldDelegate.animation != animation;
}

class RoomEntranceEffectHost extends StatefulWidget {
  const RoomEntranceEffectHost({
    super.key,
    required this.event,
  });

  final Map<String, dynamic>? event;

  @override
  State<RoomEntranceEffectHost> createState() => _RoomEntranceEffectHostState();
}

class _RoomEntranceEffectHostState extends State<RoomEntranceEffectHost> {
  Timer? _hideTimer;
  String _visibleEventId = '';
  Map<String, dynamic>? _visibleEvent;

  @override
  void initState() {
    super.initState();
    _sync(widget.event);
  }

  @override
  void didUpdateWidget(covariant RoomEntranceEffectHost oldWidget) {
    super.didUpdateWidget(oldWidget);
    _sync(widget.event);
  }

  @override
  void dispose() {
    _hideTimer?.cancel();
    super.dispose();
  }

  void _sync(Map<String, dynamic>? event) {
    if (event == null) return;
    final eventId = (event['eventId'] ?? '').toString().trim();
    if (eventId.isEmpty || eventId == _visibleEventId) return;

    final now = DateTime.now().millisecondsSinceEpoch;
    final eventAtMs = (event['eventAtMs'] as num?)?.toInt() ?? 0;
    final rewardExpiresAtMs =
        (event['rewardExpiresAtMs'] as num?)?.toInt() ?? 0;
    final recent = eventAtMs > 0 && now - eventAtMs <= 12000;
    final rewardValid = rewardExpiresAtMs > now;
    if (!recent || !rewardValid) return;

    _hideTimer?.cancel();
    _visibleEventId = eventId;
    _visibleEvent = Map<String, dynamic>.from(event);
    _hideTimer = Timer(const Duration(seconds: 5), () {
      if (!mounted) return;
      setState(() => _visibleEvent = null);
    });

    if (mounted) {
      setState(() {});
    }
  }

  @override
  Widget build(BuildContext context) {
    final event = _visibleEvent;
    if (event == null) return const SizedBox.shrink();

    final assetKey = (event['assetKey'] ?? '').toString();
    final imageUrl = (event['imageUrl'] ?? '').toString();

    return IgnorePointer(
      child: Center(
        child: SizedBox(
          width: 300,
          height: 300,
          child: CosmeticAssetVisual(
            assetKey: assetKey,
            imageUrl: imageUrl,
            fit: BoxFit.contain,
          ),
        ),
      ),
    );
  }
}
