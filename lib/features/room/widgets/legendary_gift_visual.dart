import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'cosmetic_effect_widgets.dart';

/// Reusable presentation for both the admin preview and paid room effects.
/// The transaction/server selects the image and eligibility. This player
/// never emits a payment, loads a second subscription, or polls room state.
class LegendaryGiftVisual extends StatefulWidget {
  const LegendaryGiftVisual({
    super.key,
    required this.assetKey,
    this.fallbackAssetKey = '',
    this.imageUrl = '',
    this.durationMs = 4000,
    this.size = 0,
    this.preview = false,
  });

  final String assetKey;
  final String fallbackAssetKey;
  final String imageUrl;
  final int durationMs;
  final int size;
  final bool preview;

  @override
  State<LegendaryGiftVisual> createState() => _LegendaryGiftVisualState();
}

class _LegendaryGiftVisualState extends State<LegendaryGiftVisual>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller;
  bool _motionAllowed = true;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: Duration(milliseconds: widget.durationMs.clamp(300, 12000)),
    )..forward();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _syncMotion();
  }

  @override
  void didUpdateWidget(covariant LegendaryGiftVisual oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.durationMs != widget.durationMs) {
      _controller.duration =
          Duration(milliseconds: widget.durationMs.clamp(300, 12000));
    }
    if (oldWidget.assetKey != widget.assetKey ||
        oldWidget.imageUrl != widget.imageUrl ||
        oldWidget.durationMs != widget.durationMs) {
      _controller.forward(from: 0);
    }
    _syncMotion();
  }

  void _syncMotion() {
    _motionAllowed = TickerMode.of(context) &&
        !(MediaQuery.maybeOf(context)?.disableAnimations ?? false);
    if (!_motionAllowed && _controller.isAnimating) _controller.stop();
    if (_motionAllowed && _controller.value < 1 && !_controller.isAnimating) {
      _controller.forward();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(builder: (context, limits) {
      final available = limits.maxWidth.isFinite ? limits.maxWidth : 360.0;
      final wanted = widget.size <= 0 ? available * .80 : widget.size.toDouble();
      final width = math.min(available, wanted.clamp(140.0, 420.0));
      final visual = RepaintBoundary(
        child: SizedBox(
          width: width,
          height: width,
          child: Stack(
            fit: StackFit.expand,
            alignment: Alignment.center,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      const Color(0x45FFE5A0),
                      const Color(0x283C198B),
                      const Color(0x00000000),
                    ],
                    stops: const [.08, .52, 1],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(5),
                child: CosmeticAssetVisual(
                  assetKey: widget.assetKey,
                  imageUrl: widget.imageUrl,
                  fallbackAssetKey: widget.fallbackAssetKey,
                  fit: BoxFit.contain,
                ),
              ),
            ],
          ),
        ),
      );
      if (!_motionAllowed) return Center(child: visual);
      return AnimatedBuilder(
        animation: _controller,
        child: visual,
        builder: (context, child) {
          final progress = _controller.value;
          // One finite entrance / exit. The uploaded Animated WebP/GIF
          // supplies detailed movement; no second expensive particle loop.
          final appear = (progress / .17).clamp(0.0, 1.0);
          final disappear = ((1 - progress) / .18).clamp(0.0, 1.0);
          final alpha = math.min(appear, disappear);
          final ease = Curves.easeOutCubic.transform(appear);
          final scale = .86 + .14 * ease;
          return Center(
            child: Opacity(
              opacity: alpha,
              child: Transform.scale(
                scale: scale,
                child: child,
              ),
            ),
          );
        },
      );
    });
  }
}
