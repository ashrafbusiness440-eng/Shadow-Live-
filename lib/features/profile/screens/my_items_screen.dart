import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/reward_inventory_service.dart';

class MyItemsScreen extends StatefulWidget {
  const MyItemsScreen({super.key});

  @override
  State<MyItemsScreen> createState() => _MyItemsScreenState();
}

class _MyItemsScreenState extends State<MyItemsScreen>
    with SingleTickerProviderStateMixin {
  final RewardInventoryService _service = RewardInventoryService();
  late final TabController _tabs;
  Timer? _clock;
  bool _loading = true;
  String? _error;
  String? _changingDocId;
  List<MyItemReward> _items = const [];

  static const _types = <String>[
    'frame',
    'entrance',
    'voice_wave',
    'room_background',
  ];

  static const _labels = <String>[
    'الإطارات',
    'الدخوليات',
    'الموجات الصوتية',
    'خلفيات الروم',
  ];

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: _types.length, vsync: this);
    _load();
    _clock = Timer.periodic(
      const Duration(seconds: 30),
      (_) {
        if (mounted) setState(() {});
      },
    );
  }

  @override
  void dispose() {
    _clock?.cancel();
    _tabs.dispose();
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final items = await _service.load();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _title(MyItemReward item) {
    if (item.nameAr.trim().isNotEmpty) return item.nameAr.trim();
    switch (item.type) {
      case 'frame':
        return 'إطار';
      case 'entrance':
        return 'دخولية';
      case 'voice_wave':
        return 'موجة صوتية';
      case 'room_background':
        return 'خلفية روم';
      default:
        return 'مقتنى';
    }
  }

  IconData _icon(String type) {
    switch (type) {
      case 'frame':
        return Icons.account_circle_rounded;
      case 'entrance':
        return Icons.auto_awesome_rounded;
      case 'voice_wave':
        return Icons.graphic_eq_rounded;
      case 'room_background':
        return Icons.wallpaper_rounded;
      default:
        return Icons.inventory_2_rounded;
    }
  }

  String _remaining(MyItemReward item) {
    final seconds = item.remainingSeconds();
    if (seconds <= 0) return 'منتهية';
    final days = seconds ~/ 86400;
    final hours = (seconds % 86400) ~/ 3600;
    final minutes = (seconds % 3600) ~/ 60;
    if (days > 0) {
      return hours > 0 ? 'متبقي ${days} يوم ${hours} ساعة' : 'متبقي ${days} يوم';
    }
    if (hours > 0) {
      return minutes > 0
          ? 'متبقي ${hours} ساعة ${minutes} دقيقة'
          : 'متبقي ${hours} ساعة';
    }
    final shownMinutes = minutes < 1 ? 1 : minutes;
    return 'متبقي ${shownMinutes} دقيقة';
  }

  Future<void> _toggle(MyItemReward item) async {
    if (_changingDocId != null || item.expired) return;
    setState(() => _changingDocId = item.docId);
    try {
      await _service.setActive(item, active: !item.active);
      await _load();
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            item.active
                ? 'تم إلغاء استخدام ${_title(item)}'
                : 'تم تفعيل ${_title(item)}',
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _changingDocId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تعذر تغيير المقتنى: $e')),
      );
    } finally {
      if (mounted) setState(() => _changingDocId = null);
    }
  }

  Widget _preview(MyItemReward item) {
    if (item.imageUrl.trim().isNotEmpty) {
      return Image.network(
        item.imageUrl,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => _fallbackPreview(item),
      );
    }
    if (item.assetKey.trim().isNotEmpty) {
      return FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(item.assetKey),
        builder: (context, snapshot) {
          final uri = snapshot.data;
          if (uri == null) return _fallbackPreview(item);
          return Image.network(
            uri.toString(),
            fit: BoxFit.contain,
            errorBuilder: (_, __, ___) => _fallbackPreview(item),
          );
        },
      );
    }
    return _fallbackPreview(item);
  }

  Widget _fallbackPreview(MyItemReward item) => Center(
        child: Icon(
          _icon(item.type),
          size: 68,
          color: const Color(0xFFBFA5FF),
        ),
      );

  Widget _card(MyItemReward item) {
    final changing = _changingDocId == item.docId;
    return Container(
      decoration: BoxDecoration(
        color: const Color(0xFF17181D),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: item.active
              ? const Color(0xFF7D5CFF)
              : Colors.white.withValues(alpha: .08),
          width: item.active ? 2 : 1,
        ),
      ),
      child: InkWell(
        onTap: item.expired || changing ? null : () => _toggle(item),
        borderRadius: BorderRadius.circular(18),
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: Stack(
                  children: [
                    Positioned.fill(child: _preview(item)),
                    if (item.active)
                      Positioned(
                        top: 2,
                        right: 2,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 5,
                          ),
                          decoration: BoxDecoration(
                            color: const Color(0xFF5B2BFF),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: const Text(
                            'تم الارتداء',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                    if (changing)
                      const Positioned.fill(
                        child: ColoredBox(
                          color: Color(0x66000000),
                          child: Center(
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Color(0xFFFFD54A),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Text(
                _title(item),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: item.expired ? Colors.white38 : Colors.white,
                  fontWeight: FontWeight.w800,
                  fontSize: 14,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _remaining(item),
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: item.expired
                      ? Colors.redAccent.withValues(alpha: .8)
                      : Colors.white54,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _tabBody(String type) {
    final items = _items
        .where((item) => item.type == type)
        .toList(growable: false);
    if (items.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                _icon(type),
                size: 56,
                color: Colors.white24,
              ),
              const SizedBox(height: 12),
              const Text(
                'ما عندك مقتنيات بهذا القسم حاليًا',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white54,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _load,
      child: GridView.builder(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
        physics: const AlwaysScrollableScrollPhysics(),
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          crossAxisSpacing: 12,
          mainAxisSpacing: 12,
          childAspectRatio: .78,
        ),
        itemCount: items.length,
        itemBuilder: (_, index) => _card(items[index]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF111214),
        appBar: AppBar(
          backgroundColor: const Color(0xFF111214),
          foregroundColor: Colors.white,
          title: const Text(
            'مقتنياتي',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          actions: [
            IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
          bottom: TabBar(
            controller: _tabs,
            isScrollable: true,
            tabAlignment: TabAlignment.start,
            labelColor: Colors.white,
            unselectedLabelColor: Colors.white54,
            indicatorColor: const Color(0xFF7D5CFF),
            indicatorWeight: 3,
            tabs: _labels.map((label) => Tab(text: label)).toList(),
          ),
        ),
        body: _loading
            ? const Center(
                child: CircularProgressIndicator(
                  color: Color(0xFF7D5CFF),
                ),
              )
            : _error != null
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'تعذر تحميل مقتنياتك\n$_error',
                            textAlign: TextAlign.center,
                            style: const TextStyle(color: Colors.white70),
                          ),
                          const SizedBox(height: 12),
                          FilledButton(
                            onPressed: _load,
                            child: const Text('إعادة المحاولة'),
                          ),
                        ],
                      ),
                    ),
                  )
                : TabBarView(
                    controller: _tabs,
                    children: _types.map(_tabBody).toList(),
                  ),
      ),
    );
  }
}
