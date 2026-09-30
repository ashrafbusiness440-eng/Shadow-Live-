import 'package:flutter/material.dart';

import '../services/notification_service.dart';

class NotificationsPage extends StatefulWidget {
  const NotificationsPage({super.key});

  @override
  State<NotificationsPage> createState() => _NotificationsPageState();
}

class _NotificationsPageState extends State<NotificationsPage> {
  final NotificationService _service = NotificationService();
  final List<AppNotification> _items = [];
  NotificationPage? _page;
  bool _loading = true;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  Future<void> _refresh() async {
    await _reload();
  }

  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final page = await _service.load();
      if (!mounted) return;
      setState(() {
        _items
          ..clear()
          ..addAll(page.items);
        _page = page;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    final page = _page;
    if (_loading || page?.cursor == null || page?.hasMore != true) return;
    setState(() => _loading = true);
    try {
      final next = await _service.load(after: page!.cursor);
      if (!mounted) return;
      setState(() {
        _items.addAll(next.items);
        _items.sort((a, b) => (b.createdAt?.millisecondsSinceEpoch ?? 0)
            .compareTo(a.createdAt?.millisecondsSinceEpoch ?? 0));
        _page = next;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _open(AppNotification item) async {
    if (!item.read) {
      await _service.markRead(item.id);
      if (!mounted) return;
      final index = _items.indexWhere((entry) => entry.id == item.id);
      if (index < 0) return;
      setState(() {
        _items[index] = AppNotification(
          id: item.id,
          title: item.title,
          body: item.body,
          type: item.type,
          read: true,
          createdAt: item.createdAt,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF070B16),
          appBar: AppBar(
            backgroundColor: const Color(0xFF11182A),
            title: const Text('الإشعارات'),
          ),
          body: Builder(
            builder: (context) {
              if (_loading && _items.isEmpty) {
                return const Center(child: CircularProgressIndicator());
              }
              if (_error != null && _items.isEmpty) {
                return Center(
                  child: FilledButton.icon(
                    onPressed: _refresh,
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('تعذر تحميل الإشعارات — إعادة المحاولة'),
                  ),
                );
              }
              if (_items.isEmpty) {
                return RefreshIndicator(
                  onRefresh: _refresh,
                  child: ListView(
                    children: const [
                      SizedBox(height: 180),
                      Icon(Icons.notifications_none_rounded,
                          size: 58, color: Colors.white38),
                      SizedBox(height: 12),
                      Center(child: Text('لا توجد إشعارات حالياً')),
                    ],
                  ),
                );
              }
              return RefreshIndicator(
                onRefresh: _refresh,
                child: ListView.separated(
                  padding: const EdgeInsets.all(14),
                  itemCount: _items.length + (_page?.hasMore == true ? 1 : 0),
                  separatorBuilder: (_, __) => const SizedBox(height: 9),
                  itemBuilder: (context, index) {
                    if (index == _items.length) {
                      return Center(
                        child: OutlinedButton.icon(
                          onPressed: _loading ? null : _loadMore,
                          icon: _loading
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.expand_more_rounded),
                          label: const Text('تحميل المزيد'),
                        ),
                      );
                    }
                    final item = _items[index];
                    return Card(
                      color: item.read
                          ? const Color(0xFF11182A)
                          : const Color(0xFF202344),
                      child: ListTile(
                        onTap: () => _open(item),
                        leading: Icon(
                          item.read
                              ? Icons.notifications_none_rounded
                              : Icons.notifications_active_rounded,
                          color: item.read
                              ? Colors.white54
                              : const Color(0xFFFFD54F),
                        ),
                        title: Text(item.title,
                            style:
                                const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: item.body.isEmpty ? null : Text(item.body),
                        trailing: item.read
                            ? null
                            : const Icon(Icons.circle,
                                size: 9, color: Color(0xFFFFD54F)),
                      ),
                    );
                  },
                ),
              );
            },
          ),
        ),
      );
}
