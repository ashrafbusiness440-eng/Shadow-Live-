import 'dart:async';

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
