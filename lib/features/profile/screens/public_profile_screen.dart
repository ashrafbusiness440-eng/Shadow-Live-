import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/follow_service.dart';
import '../services/profile_action_service.dart';
import '../widgets/profile_gift_sheet.dart';
import '../widgets/registry_badge.dart';

class PublicProfileScreen extends StatefulWidget {
  final String userId;

  const PublicProfileScreen({super.key, required this.userId});

  @override
  State<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends State<PublicProfileScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _follow = FollowService();
  bool _followBusy = false;
  late Future<_PublicCounts> _countsFuture;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 5, vsync: this);
    _countsFuture = _loadCounts();
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  Future<_PublicCounts> _loadCounts() async {
    final follows = await _follow.counts(widget.userId);
    int gifts = 0;
    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('public_gifts')
          .doc(widget.userId)
          .collection('items')
          .count()
          .get();
      gifts = snapshot.count ?? 0;
    } catch (_) {}
    return _PublicCounts(
      followers: follows.followers,
      following: follows.following,
      gifts: gifts,
    );
  }

  ImageProvider? _avatar(Map<String, dynamic> data) {
    final photo = '\${data['profileImageUrl'] ?? ''}';
    final asset = '\${data['profileAvatarAsset'] ?? ''}';
    if (photo.isNotEmpty) return NetworkImage(photo);
    if (asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  List<String> _badges(Map<String, dynamic> data) {
    final raw = data['badges'];
    if (raw is! List) return const [];
    return raw.map((e) => '$e').where((e) => e.trim().isNotEmpty).toList();
  }

  List<String> _interests(Map<String, dynamic> data) {
    final raw = data['interests'];
    if (raw is! List) return const [];
    return raw.map((e) => '$e').where((e) => e.trim().isNotEmpty).toList();
  }

  Future<void> _toggleFollow(bool currentlyFollowing) async {
    if (_followBusy) return;
    setState(() => _followBusy = true);
    try {
      await _follow.setFollowing(widget.userId, !currentlyFollowing);
      if (mounted) {
        setState(() => _countsFuture = _loadCounts());
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر تحديث المتابعة')),
        );
      }
    } finally {
      if (mounted) setState(() => _followBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = FirebaseAuth.instance.currentUser?.uid;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance
              .collection('public_profiles')
              .doc(widget.userId)
              .snapshots(),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Center(
                child: Text(
                  'تعذر تحميل الملف الشخصي',
                  style: TextStyle(color: Colors.white60),
                ),
              );
            }
            if (!snapshot.hasData) {
              return const Center(
                child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
              );
            }
            final data = snapshot.data?.data();
            if (data == null) {
              return const Center(
                child: Text(
                  'هذا الملف غير متاح',
                  style: TextStyle(color: Colors.white60),
                ),
              );
            }

            final name = '\${data['displayName'] ?? 'مستخدم Shadow Live'}';
            final photo = '\${data['profileImageUrl'] ?? ''}';
            final isSelf = me == widget.userId;

            return NestedScrollView(
              headerSliverBuilder: (context, innerBoxIsScrolled) => [
                SliverAppBar(
                  pinned: true,
                  expandedHeight: 305,
                  backgroundColor: const Color(0xFF0B0D16),
                  foregroundColor: Colors.white,
                  title: innerBoxIsScrolled ? Text(name) : null,
                  flexibleSpace: FlexibleSpaceBar(
                    background: _profileHeader(data),
                  ),
                ),
                SliverToBoxAdapter(
                  child: _profileActions(
                    data,
                    isSelf: isSelf,
                    name: name,
                    photo: photo,
                  ),
                ),
                SliverToBoxAdapter(child: _profileDetails(data)),
                SliverPersistentHeader(
                  pinned: true,
                  delegate: _ProfileTabHeader(
                    TabBar(
                      controller: _tabs,
                      isScrollable: true,
                      tabAlignment: TabAlignment.center,
                      labelColor: const Color(0xFFFFD54A),
                      unselectedLabelColor: Colors.white54,
                      indicatorColor: const Color(0xFFFFD54A),
                      tabs: const [
                        Tab(text: 'منشورات'),
                        Tab(text: 'صور'),
                        Tab(text: 'أصدقاء'),
                        Tab(text: 'غرف'),
                        Tab(text: 'هدايا'),
                      ],
                    ),
                  ),
                ),
              ],
              body: TabBarView(
                controller: _tabs,
                children: [
                  _emptyTab(
                    Icons.dynamic_feed_outlined,
                    'لا توجد منشورات عامة بعد',
                  ),
                  _emptyTab(
                    Icons.photo_library_outlined,
                    'لا توجد صور عامة بعد',
                  ),
                  _friendsTab(),
                  _emptyTab(
                    Icons.mic_none_rounded,
                    'لا توجد غرف عامة مثبتة على الملف بعد',
                  ),
                  PublicReceivedGiftsTab(userId: widget.userId),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _profileHeader(Map<String, dynamic> data) {
    final provider = _avatar(data);
    final cover = '\${data['coverImageUrl'] ?? ''}';
    final name = '\${data['displayName'] ?? 'مستخدم Shadow Live'}';
    final publicId = '\${data['publicId'] ?? '—'}';
    final online = data['isOnline'] == true;
    final level = (data['level'] as num?)?.toInt() ?? 0;
    final vip = (data['vipLevel'] as num?)?.toInt() ?? 0;
    final badges = _badges(data);

    return Container(
      decoration: BoxDecoration(
        gradient: cover.isEmpty
            ? const RadialGradient(
                center: Alignment(.55, -.65),
                radius: 1.4,
                colors: [
                  Color(0xFF2A1250),
                  Color(0xFF0B0D16),
                  Color(0xFF05060D),
                ],
              )
            : null,
        image: cover.isNotEmpty
            ? DecorationImage(
                image: NetworkImage(cover),
                fit: BoxFit.cover,
                colorFilter: ColorFilter.mode(
                  Colors.black.withValues(alpha: .45),
                  BlendMode.darken,
                ),
              )
            : null,
      ),
      padding: const EdgeInsets.fromLTRB(18, 86, 18, 18),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              Container(
                padding: const EdgeInsets.all(3),
                decoration: const BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: LinearGradient(
                    colors: [Color(0xFF8A00FF), Color(0xFFFFD54A)],
                  ),
                ),
                child: CircleAvatar(
                  radius: 54,
                  backgroundColor: const Color(0xFF25183F),
                  backgroundImage: provider,
                  child: provider == null
                      ? const Icon(
                          Icons.person,
                          size: 52,
                          color: Color(0xFFFFD54A),
                        )
                      : null,
                ),
              ),
              if (online)
                Positioned(
                  left: 3,
                  bottom: 4,
                  child: Container(
                    width: 19,
                    height: 19,
                    decoration: BoxDecoration(
                      color: const Color(0xFF38D996),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: const Color(0xFF05060D),
                        width: 3,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            name,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            'ID: $publicId',
            textDirection: TextDirection.ltr,
            style: const TextStyle(color: Colors.white60),
          ),
          if (level > 0 || vip > 0 || badges.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 7,
              runSpacing: 7,
              children: [
                if (vip > 0)
                  RegistryBadge(
                    assetKey: 'vip.badge.$vip',
                    label: 'VIP $vip',
                  ),
                if (level > 0)
                  RegistryBadge(
                    assetKey: 'level.badge.$level',
                    label: 'Lv.$level',
                    fallbackIcon: Icons.star_rounded,
                  ),
                ...badges.map(
                  (badge) => RegistryBadge(
                    assetKey: normalizePublicBadgeKey(badge),
                    label: publicBadgeLabel(badge),
                    fallbackIcon: Icons.verified_rounded,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _profileActions(
    Map<String, dynamic> data, {
    required bool isSelf,
    required String name,
    required String photo,
  }) {
    if (isSelf) {
      return const SizedBox(height: 8);
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
      child: StreamBuilder<bool>(
        stream: _follow.isFollowing(widget.userId),
        builder: (context, snapshot) {
          final following = snapshot.data == true;
          return Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _followBusy
                      ? null
                      : () => _toggleFollow(following),
                  style: FilledButton.styleFrom(
                    backgroundColor: following
                        ? const Color(0xFF252B38)
                        : const Color(0xFF7B2DFF),
                    padding: const EdgeInsets.symmetric(vertical: 13),
                  ),
                  icon: Icon(
                    following
                        ? Icons.person_remove_alt_1_rounded
                        : Icons.person_add_alt_1_rounded,
                  ),
                  label: Text(
                    _followBusy
                        ? 'جارٍ...'
                        : (following ? 'إلغاء المتابعة' : 'متابعة'),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => ProfileActionService.openChat(
                    context,
                    otherUid: widget.userId,
                    otherName: name,
                    otherPhoto: photo,
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.white,
                    side: const BorderSide(color: Colors.white24),
                    padding: const EdgeInsets.symmetric(vertical: 13),
                  ),
                  icon: const Icon(Icons.chat_bubble_outline_rounded),
                  label: const Text('رسالة'),
                ),
              ),
              const SizedBox(width: 8),
              SizedBox(
                height: 48,
                width: 50,
                child: OutlinedButton(
                  onPressed: () => showProfileGiftSheet(
                    context,
                    receiverUid: widget.userId,
                    receiverName: name,
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: const Color(0xFFFFD54A),
                    padding: EdgeInsets.zero,
                    side: const BorderSide(color: Color(0x55FFD54A)),
                  ),
                  child: const Icon(Icons.card_giftcard_rounded),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _profileDetails(Map<String, dynamic> data) {
    final bio = '\${data['bio'] ?? ''}'.trim();
    final location = '\${data['location'] ?? ''}'.trim();
    final interests = _interests(data);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
      child: Column(
        children: [
          FutureBuilder<_PublicCounts>(
            future: _countsFuture,
            builder: (context, snapshot) {
              final counts = snapshot.data ?? const _PublicCounts();
              return Container(
                padding: const EdgeInsets.symmetric(vertical: 13),
                decoration: BoxDecoration(
                  color: const Color(0xFF101522),
                  borderRadius: BorderRadius.circular(18),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: _Stat(
                        label: 'المتابعون',
                        value: '\${counts.followers}',
                      ),
                    ),
                    Expanded(
                      child: _Stat(
                        label: 'يتابع',
                        value: '\${counts.following}',
                      ),
                    ),
                    Expanded(
                      child: _Stat(
                        label: 'الهدايا',
                        value: '\${counts.gifts}',
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
          if (bio.isNotEmpty || location.isNotEmpty) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: const Color(0xFF101522),
                borderRadius: BorderRadius.circular(18),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (bio.isNotEmpty)
                    Text(
                      bio,
                      style: const TextStyle(
                        color: Colors.white70,
                        height: 1.55,
                      ),
                    ),
                  if (location.isNotEmpty) ...[
                    if (bio.isNotEmpty) const SizedBox(height: 8),
                    Row(
                      children: [
                        const Icon(
                          Icons.location_on_outlined,
                          color: Colors.white38,
                          size: 17,
                        ),
                        const SizedBox(width: 5),
                        Expanded(
                          child: Text(
                            location,
                            style: const TextStyle(color: Colors.white54),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          ],
          if (interests.isNotEmpty) ...[
            const SizedBox(height: 10),
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                spacing: 7,
                runSpacing: 7,
                children: interests
                    .map(
                      (interest) => Chip(
                        label: Text(interest),
                        backgroundColor: const Color(0xFF171B28),
                        labelStyle: const TextStyle(
                          color: Colors.white70,
                          fontSize: 12,
                        ),
                        side: BorderSide.none,
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _friendsTab() {
    return FutureBuilder<FollowCounts>(
      future: _follow.counts(widget.userId),
      builder: (context, snapshot) {
        final counts = snapshot.data;
        if (!snapshot.hasData) {
          return const Center(
            child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
          );
        }
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _PeopleSummaryCard(
              icon: Icons.people_alt_outlined,
              title: 'المتابعون',
              count: counts?.followers ?? 0,
            ),
            const SizedBox(height: 10),
            _PeopleSummaryCard(
              icon: Icons.person_add_alt_1_rounded,
              title: 'يتابع',
              count: counts?.following ?? 0,
            ),
            const SizedBox(height: 18),
            const Text(
              'قائمة الحسابات التفصيلية ستُربط هنا مع شاشة الأصدقاء العامة، بينما العدادات والمتابعة الفعلية تعمل من الآن.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white38, height: 1.5),
            ),
          ],
        );
      },
    );
  }

  Widget _emptyTab(IconData icon, String text) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 50, color: Colors.white24),
          const SizedBox(height: 12),
          Text(text, style: const TextStyle(color: Colors.white54)),
        ],
      ),
    );
  }
}

class _PublicCounts {
  final int followers;
  final int following;
  final int gifts;

  const _PublicCounts({
    this.followers = 0,
    this.following = 0,
    this.gifts = 0,
  });
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Color(0xFFFFD54A),
            fontSize: 18,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          style: const TextStyle(color: Colors.white54, fontSize: 12),
        ),
      ],
    );
  }
}

class _PeopleSummaryCard extends StatelessWidget {
  const _PeopleSummaryCard({
    required this.icon,
    required this.title,
    required this.count,
  });

  final IconData icon;
  final String title;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(15),
      decoration: BoxDecoration(
        color: const Color(0xFF101522),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          Icon(icon, color: const Color(0xFFFFD54A)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          Text(
            '$count',
            style: const TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}

class _ProfileTabHeader extends SliverPersistentHeaderDelegate {
  const _ProfileTabHeader(this.tabBar);

  final TabBar tabBar;

  @override
  double get minExtent => tabBar.preferredSize.height;

  @override
  double get maxExtent => tabBar.preferredSize.height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(
      color: const Color(0xFF0B0D16),
      child: tabBar,
    );
  }

  @override
  bool shouldRebuild(covariant _ProfileTabHeader oldDelegate) => false;
}
