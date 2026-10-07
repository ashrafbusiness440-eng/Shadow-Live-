import 'package:flutter/material.dart';

import '../services/profile_visit_service.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';

class ProfileVisitHistoryScreen extends StatefulWidget {
  const ProfileVisitHistoryScreen({super.key});

  @override
  State<ProfileVisitHistoryScreen> createState() =>
      _ProfileVisitHistoryScreenState();
}

class _ProfileVisitHistoryScreenState extends State<ProfileVisitHistoryScreen>
    with SingleTickerProviderStateMixin {
  final ProfileVisitService _service = ProfileVisitService();
  late final TabController _tabs;
  late Future<List<ProfileVisitItem>> _visitors;
  late Future<List<ProfileVisitItem>> _visited;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _reload();
  }

  void _reload() {
    _visitors = _service.history(visited: false);
    _visited = _service.history(visited: true);
  }

  @override
  void dispose() {
    _service.close();
    _tabs.dispose();
    super.dispose();
  }

  Future<void> _refresh() async {
    setState(_reload);
    await Future.wait([_visitors, _visited]);
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF050814),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0B1220),
          foregroundColor: Colors.white,
          title: const Text(
            'سجل الزيارات',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          bottom: TabBar(
            controller: _tabs,
            labelColor: const Color(0xFFFFD166),
            unselectedLabelColor: Colors.white54,
            indicatorColor: const Color(0xFFFFD166),
            tabs: const [
              Tab(text: 'من زار ملفي'),
              Tab(text: 'الملفات التي زرتها'),
            ],
          ),
        ),
        body: TabBarView(
          controller: _tabs,
          children: [
            _history(_visitors),
            _history(_visited),
          ],
        ),
      ),
    );
  }

  Widget _history(Future<List<ProfileVisitItem>> future) {
    return FutureBuilder<List<ProfileVisitItem>>(
      future: future,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError) {
          final text = snapshot.error.toString();
          final requiresVip =
              text.contains('profile_visit_history_requires_vip1');
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                const SizedBox(height: 160),
                Icon(
                  requiresVip
                      ? Icons.workspace_premium_rounded
                      : Icons.error_outline_rounded,
                  color: const Color(0xFFFFD166),
                  size: 44,
                ),
                const SizedBox(height: 12),
                Center(
                  child: Text(
                    requiresVip
                        ? 'سجل الزيارات متاح من VIP1.'
                        : 'تعذر تحميل سجل الزيارات.',
                    style: const TextStyle(color: Colors.white60),
                  ),
                ),
              ],
            ),
          );
        }

        final items = snapshot.data ?? const <ProfileVisitItem>[];
        if (items.isEmpty) {
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: const [
                SizedBox(height: 170),
                Icon(
                  Icons.visibility_outlined,
                  color: Colors.white38,
                  size: 46,
                ),
                SizedBox(height: 12),
                Center(
                  child: Text(
                    'لا توجد زيارات بعد.',
                    style: TextStyle(color: Colors.white54),
                  ),
                ),
              ],
            ),
          );
        }

        return RefreshIndicator(
          onRefresh: _refresh,
          child: ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(14, 14, 14, 28),
            itemCount: items.length,
            separatorBuilder: (_, __) =>
                const Divider(height: 1, color: Colors.white10),
            itemBuilder: (context, index) => _tile(items[index]),
          ),
        );
      },
    );
  }

  Widget _tile(ProfileVisitItem item) {
    final date = item.lastVisitedAt?.toLocal();
    final dateText = date == null
        ? ''
        : '${date.year}/${date.month.toString().padLeft(2, '0')}/${date.day.toString().padLeft(2, '0')} '
            '${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 7),
      leading: ProfileAvatarWithFrame(
        diameter: 48,
        userId: item.uid,
        backgroundColor: const Color(0xFF25183F),
        placeholderColor: const Color(0xFFFFD166),
        fallbackProfile: <String, dynamic>{
          'profileImageUrl': item.profileImageUrl,
        },
        vipLevel: item.effectiveVipLevel,
        useVipFallback: true,
      ),
      title: Text(
        item.displayName,
        style: const TextStyle(
          color: Colors.white,
          fontWeight: FontWeight.w800,
        ),
      ),
      subtitle: Text(
        [
          if (item.publicId.isNotEmpty) 'ID: ${item.publicId}',
          if (dateText.isNotEmpty) dateText,
        ].join(' • '),
        textDirection: TextDirection.rtl,
        style: const TextStyle(color: Colors.white54, fontSize: 12),
      ),
      trailing: item.effectiveVipLevel > 0
          ? Text(
              'VIP${item.effectiveVipLevel}',
              textDirection: TextDirection.ltr,
              style: const TextStyle(
                color: Color(0xFFFFD166),
                fontWeight: FontWeight.w900,
                fontSize: 12,
              ),
            )
          : null,
    );
  }
}
