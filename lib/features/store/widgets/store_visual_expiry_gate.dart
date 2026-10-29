import 'dart:async';

import 'package:flutter/widgets.dart';

/// Pure presentation deadline. The server remains authoritative for
/// entitlement, equipment and revocation. An expired, previously verified
/// visual stops painting at its exact deadline without polling or extra reads.
class StoreVisualExpiryGate extends StatefulWidget {
  const StoreVisualExpiryGate({
    super.key,
    required this.expiresAtMs,
    required this.builder,
  });

  final int? expiresAtMs;
  final Widget Function(BuildContext context, bool active) builder;

  @override
  State<StoreVisualExpiryGate> createState() => _StoreVisualExpiryGateState();
}

class _StoreVisualExpiryGateState extends State<StoreVisualExpiryGate> {
  Timer? _deadline;
  bool _deadlineReached = false;

  @override
  void initState() {
    super.initState();
    _schedule();
  }

  @override
  void didUpdateWidget(covariant StoreVisualExpiryGate oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.expiresAtMs != widget.expiresAtMs) _schedule();
  }

  void _schedule() {
    _deadline?.cancel();
    _deadline = null;
    _deadlineReached = false;
    final timestamp = widget.expiresAtMs;
    if (timestamp == null) return; // Permanent verified item.
    final remaining = timestamp - DateTime.now().millisecondsSinceEpoch;
    if (remaining <= 0) {
      _deadlineReached = true;
      return;
    }
    // One scheduled repaint, not a timer loop or background API polling.
    _deadline = Timer(Duration(milliseconds: remaining), () {
      if (mounted) setState(() => _deadlineReached = true);
    });
  }

  @override
  void dispose() {
    _deadline?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final timestamp = widget.expiresAtMs;
    final active = !_deadlineReached &&
        (timestamp == null || timestamp > DateTime.now().millisecondsSinceEpoch);
    return widget.builder(context, active);
  }
}
