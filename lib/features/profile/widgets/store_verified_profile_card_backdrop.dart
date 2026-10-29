import 'package:flutter/material.dart';

import '../../store/services/store_visual_presentation_service.dart';
import '../../store/widgets/store_visual_expiry_gate.dart';

/// Header-only decoration. The server is authoritative for ownership,
/// equipment, expiry and published Studio .visual; no public profile field
/// or catalogue thumbnail is accepted as an entitlement.
class StoreVerifiedProfileCardBackdrop extends StatefulWidget {
  const StoreVerifiedProfileCardBackdrop({
    super.key,
    required this.userId,
    required this.child,
    this.borderRadius = BorderRadius.zero,
  });

  final String userId;
  final Widget child;
  final BorderRadius borderRadius;

  @override
  State<StoreVerifiedProfileCardBackdrop> createState() =>
      _StoreVerifiedProfileCardBackdropState();
}

class _StoreVerifiedProfileCardBackdropState
    extends State<StoreVerifiedProfileCardBackdrop> {
  late Future<StoreVerifiedFrame?> _visual;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void didUpdateWidget(covariant StoreVerifiedProfileCardBackdrop oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userId != widget.userId) _refresh();
  }

  void _refresh() {
    _visual = _readVerifiedVisual(widget.userId);
  }

  Future<StoreVerifiedFrame?> _readVerifiedVisual(String uid) async {
    final service = StoreVisualPresentationService();
    try {
      return await service.loadProfileCard(uid);
    } finally {
      service.close();
    }
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<StoreVerifiedFrame?>(
      future: _visual,
      builder: (context, snapshot) {
        final visual = snapshot.data;
        if (visual == null || !visual.activeNow) return widget.child;
        return StoreVisualExpiryGate(
          expiresAtMs: visual.expiresAtMs,
          builder: (context, active) => !active ? widget.child : ClipRRect(
          borderRadius: widget.borderRadius,
          child: Stack(
            fit: StackFit.passthrough,
            children: [
              Positioned.fill(
                child: IgnorePointer(
                  child: Opacity(
                    opacity: .30,
                    child: Image.network(
                      visual.imageUrl,
                      fit: BoxFit.cover,
                      gaplessPlayback: true,
                      errorBuilder: (_, __, ___) =>
                          const SizedBox.shrink(),
                    ),
                  ),
                ),
              ),
              widget.child,
            ],
          ),
        ),
        );
      },
    );
  }
}
