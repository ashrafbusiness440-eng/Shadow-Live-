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
    final pulse = (math.sin(t * math.pi * 2) + 1) / 2;
    final radius = shortest * .405;
    final outerRect = Rect.fromCircle(
      center: center,
      radius: shortest * .46,
    );

    final glow = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = shortest * .03
      ..color = const Color(0xFFFFB52E).withValues(
        alpha: .08 + (.05 * pulse),
      )
      ..maskFilter = MaskFilter.blur(
        BlurStyle.normal,
        shortest * .028,
      );
    canvas.drawCircle(center, radius, glow);

    final sweep = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = shortest * .018
      ..shader = SweepGradient(
        colors: [
          Colors.transparent,
          Colors.transparent,
          const Color(0x00FFD36A),
          const Color(0xAAFFD36A),
          const Color(0xEEFFF2C4),
          const Color(0x88FFB52E),
          Colors.transparent,
        ],
        stops: const [0, .60, .72, .80, .86, .92, 1],
        transform: GradientRotation(t * math.pi * 2),
      ).createShader(outerRect);
    canvas.drawCircle(center, radius, sweep);

    final sparkleAngles = <double>[
      -math.pi / 2,
      -math.pi * .72,
      -math.pi * .28,
      math.pi * .72,
      math.pi * .28,
    ];
    for (var i = 0; i < sparkleAngles.length; i++) {
      final angle = sparkleAngles[i];
      final phase = (t + i * .17) % 1.0;
      final alpha =
          .18 + .72 * math.pow(math.sin(phase * math.pi), 2).toDouble();
      final sparkleRadius = radius * (i == 0 ? .98 : 1.03);
      final point = Offset(
        center.dx + math.cos(angle) * sparkleRadius,
        center.dy + math.sin(angle) * sparkleRadius,
      );
      _drawSparkle(
        canvas,
        point,
        shortest * (i == 0 ? .024 : .018),
        alpha,
      );
    }
  }

  void _drawSparkle(
    Canvas canvas,
    Offset center,
    double radius,
    double alpha,
  ) {
    final paint = Paint()
      ..color = const Color(0xFFFFF4C8).withValues(alpha: alpha)
      ..strokeWidth = math.max(1, radius * .18)
      ..strokeCap = StrokeCap.round;

    canvas.drawCircle(center, radius * .20, paint);
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
