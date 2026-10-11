import 'package:flutter/material.dart';

import '../../core/assets/shadow_asset_registry.dart';

/// One shared wallpaper beneath every Navigator route (including dialogs).
/// The app-bundled copy remains readable offline, while the asset registry
/// allows the owner to replace the same wallpaper from the Asset Studio.
class ShadowGlobalWallpaper extends StatefulWidget {
  const ShadowGlobalWallpaper({
    super.key,
    required this.child,
    this.resolveUrl,
  });

  final Widget child;
  final Future<Uri?> Function()? resolveUrl;

  @override
  State<ShadowGlobalWallpaper> createState() => _ShadowGlobalWallpaperState();
}

class _ShadowGlobalWallpaperState extends State<ShadowGlobalWallpaper>
    with WidgetsBindingObserver {
  Future<Uri?>? _remote;
  DateTime? _lastCheckedAt;
  static const Duration _minRefreshInterval = Duration(minutes: 5);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _reload();
  }

  Future<Uri?> _resolve({bool refresh = false}) async {
    try {
      return await (widget.resolveUrl?.call() ??
          ShadowAssetRegistry.remoteUrl(ShadowAssetKeys.globalWallpaper,
              refresh: refresh));
    } catch (_) {
      // Network and registry outages must not hide the bundled wallpaper.
      return null;
    }
  }

  void _reload({bool refresh = false}) {
    _lastCheckedAt = DateTime.now();
    _remote = _resolve(refresh: refresh);
  }

  @override
  void didUpdateWidget(covariant ShadowGlobalWallpaper oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.resolveUrl != widget.resolveUrl) {
      setState(() => _reload(refresh: true));
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) return;
    final last = _lastCheckedAt;
    if (last == null ||
        DateTime.now().difference(last) >= _minRefreshInterval) {
      if (mounted) setState(() => _reload(refresh: true));
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Widget _bundledImage() => Image.asset(
        ShadowAssetKeys.globalWallpaperBundledPath,
        fit: BoxFit.cover,
        filterQuality: FilterQuality.low,
        errorBuilder: (_, __, ___) =>
            const ColoredBox(color: Color(0xFF080711)),
      );

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        Positioned.fill(
          child: FutureBuilder<Uri?>(
            future: _remote,
            builder: (context, snapshot) {
              final url = snapshot.data;
              if (url == null || !url.hasScheme ||
                  (url.scheme != 'https' && url.scheme != 'http')) {
                return _bundledImage();
              }
              return Image.network(
                url.toString(),
                fit: BoxFit.cover,
                filterQuality: FilterQuality.low,
                gaplessPlayback: true,
                errorBuilder: (_, __, ___) => _bundledImage(),
              );
            },
          ),
        ),
        // Keep foreground text, chat, controls and rank cards legible.
        const Positioned.fill(
          child: IgnorePointer(
            child: ColoredBox(color: Color(0x6605060D)),
          ),
        ),
        widget.child,
      ],
    );
  }
}
