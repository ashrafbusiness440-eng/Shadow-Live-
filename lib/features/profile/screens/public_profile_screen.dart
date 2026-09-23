import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../services/follow_service.dart';
import '../services/profile_action_service.dart';
import '../../gift/widgets/direct_gift_sheet.dart';
import '../widgets/registry_badge.dart';

class PublicProfileScreen extends StatefulWidget {
  const PublicProfileScreen({super.key, required this.userId});
  final String userId;

  @override
  State<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends State<PublicProfileScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _follow = FollowService();
  bool _changingFollow = false;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  ImageProvider? _avatar(Map<String, dynamic> data) {
    final photo = (data['profileImageUrl'] ?? '').toString().trim();
    final asset = (data['profileAvatarAsset'] ?? '').toString().trim();
    if (photo.isNotEmpty) return NetworkImage(photo);
    if (asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  Future<void> _showGiftInfo(String name) => showDirectGiftSheet(
        context,
        receiverId: widget.userId,
        receiverName: name,
      );

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          future: FirebaseFirestore.instance.collection('public_profiles').doc(widget.userId).get(),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return const Center(child: Text('تعذر تحميل الملف الشخصي', style: TextStyle(color: Colors.white60)));
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF)));
            }
            final data = snapshot.data?.data();
            if (data == null) {
              return const Center(child: Text('هذا الملف غير متاح', style: TextStyle(color: Colors.white60)));
            }

            final name = (data['displayName'] ?? 'مستخدم Shadow Live').toString();
            final photo = (data['profileImageUrl'] ?? '').toString();
            final cover = (data['coverImageUrl'] ?? '').toString();
            final publicId = (data['publicId'] ?? '—').toString();
            final bio = (data['bio'] ?? '').toString();
            final location = (data['location'] ?? '').toString();
            final level = (data['level'] as num?)?.toInt() ?? 0;
            final vip = (data['vipLevel'] as num?)?.toInt() ?? 0;
            final online = data['isOnline'] == true;
            final badges = data['badges'] is List
                ? (data['badges'] as List).map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
                : <String>[];
            final provider = _avatar(data);

            return NestedScrollView(
              headerSliverBuilder: (_, __) => [
                SliverAppBar(
                  pinned: true,
                  expandedHeight: 330,
                  backgroundColor: const Color(0xFF0B0D16),
                  foregroundColor: Colors.white,
                  title: const Text('الملف الشخصي'),
                  flexibleSpace: FlexibleSpaceBar(
                    background: _header(
                      name: name,
                      publicId: publicId,
                      photo: provider,
                      cover: cover,
                      online: online,
                      vip: vip,
                      level: level,
                      badges: badges,
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                    child: Row(
                      children: [
                        Expanded(
                          child: StreamBuilder<bool>(
                            stream: _follow.isFollowing(widget.userId),
                            builder: (context, followSnapshot) {
                              final following = followSnapshot.data == true;
                              return FilledButton.icon(
                                onPressed: _changingFollow
                                    ? null
                                    : () async {
                                        setState(() => _changingFollow = true);
                                        try {
                                          await _follow.setFollowing(widget.userId, !following);
                                        } catch (_) {
                                          if (mounted) {
                                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر تحديث المتابعة')));
                                          }
                                        } finally {
                                          if (mounted) setState(() => _changingFollow = false);
                                        }
                                      },
                                style: FilledButton.styleFrom(
                                  backgroundColor: following ? const Color(0xFF272C39) : const Color(0xFF7B2DFF),
                                  foregroundColor: Colors.white,
                                  disabledForegroundColor: Colors.white54,
                                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 13),
                                  minimumSize: const Size(0, 48),
                                  textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
                                ),
                                icon: Icon(
                                  following ? Icons.person_remove_alt_1_rounded : Icons.person_add_alt_1_rounded,
                                  size: 18,
                                ),
                                label: FittedBox(
                                  fit: BoxFit.scaleDown,
                                  child: Text(
                                    following ? 'إلغاء المتابعة' : 'متابعة',
                                    maxLines: 1,
                                    softWrap: false,
                                  ),
                                ),
                              );
                            },
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
                              foregroundColor: const Color(0xFFFFD54A),
                              side: const BorderSide(color: Colors.white70),
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 13),
                              minimumSize: const Size(0, 48),
                            ),
                            icon: const Icon(Icons.chat_bubble_outline_rounded, size: 18),
                            label: const FittedBox(fit: BoxFit.scaleDown, child: Text('رسالة', maxLines: 1)),
                          ),
                        ),
                        const SizedBox(width: 8),
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () => _showGiftInfo(name),
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFFFFD54A),
                              side: const BorderSide(color: Colors.white70),
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 13),
                              minimumSize: const Size(0, 48),
                            ),
                            icon: const Icon(Icons.card_giftcard_rounded, size: 18),
                            label: const FittedBox(fit: BoxFit.scaleDown, child: Text('هدية', maxLines: 1)),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                SliverToBoxAdapter(child: _stats(widget.userId)),
                SliverPersistentHeader(
                  pinned: true,
                  delegate: _TabHeaderDelegate(
                    TabBar(
                      controller: _tabs,
                      labelColor: const Color(0xFFFFD54A),
                      unselectedLabelColor: Colors.white54,
                      indicatorColor: const Color(0xFFFFD54A),
                      tabs: const [
                        Tab(text: 'حول'),
                        Tab(text: 'الهدايا'),
                        Tab(text: 'الشارات'),
                      ],
                    ),
                  ),
                ),
              ],
              body: TabBarView(
                controller: _tabs,
                children: [
                  _about(bio, location),
                  _gifts(),
                  _badges(vip, level, badges),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _header({
    required String name,
    required String publicId,
    required ImageProvider? photo,
    required String cover,
    required bool online,
    required int vip,
    required int level,
    required List<String> badges,
  }) {
    return Container(
      decoration: BoxDecoration(
        gradient: cover.isEmpty
            ? const RadialGradient(center: Alignment(.6, -.5), radius: 1.3, colors: [Color(0xFF251044), Color(0xFF07111F), Color(0xFF05060D)])
            : null,
        image: cover.isNotEmpty
            ? DecorationImage(
                image: NetworkImage(cover),
                fit: BoxFit.cover,
                colorFilter: ColorFilter.mode(Colors.black.withValues(alpha: .45), BlendMode.darken),
              )
            : null,
      ),
      padding: const EdgeInsets.fromLTRB(18, 92, 18, 18),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          Stack(
            clipBehavior: Clip.none,
            children: [
              CircleAvatar(
                radius: 55,
                backgroundColor: const Color(0xFF25183F),
                backgroundImage: photo,
                child: photo == null ? const Icon(Icons.person, size: 52, color: Color(0xFFFFD54A)) : null,
              ),
              if (online)
                Positioned(
                  left: 3,
                  bottom: 3,
                  child: Container(
                    width: 19,
                    height: 19,
                    decoration: BoxDecoration(
                      color: const Color(0xFF38D996),
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFF07111F), width: 3),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 11),
          Text(name, style: const TextStyle(color: Colors.white, fontSize: 25, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('ID: $publicId', textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white60)),
          if (vip > 0 || level > 0 || badges.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 7,
              runSpacing: 7,
              children: [
                if (vip > 0) RegistryBadge(assetKey: ShadowAssetKeys.vipBadge(vip), label: 'VIP $vip'),
                if (level > 0) RegistryBadge(assetKey: ShadowAssetKeys.levelBadge(level), label: 'Lv.$level', fallbackIcon: Icons.star_rounded),
                ...badges.take(4).map((b) => RegistryBadge(assetKey: normalizePublicBadgeKey(b), label: publicBadgeLabel(b))),
              ],
            ),
          ],
        ],
      ),
    );
  }

  Widget _stats(String userId) {
    return FutureBuilder<FollowCounts>(
      future: _follow.counts(userId),
      builder: (context, snapshot) {
        final counts = snapshot.data;
        return Container(
          margin: const EdgeInsets.fromLTRB(16, 6, 16, 12),
          padding: const EdgeInsets.symmetric(vertical: 16),
          decoration: BoxDecoration(color: const Color(0xFF101522), borderRadius: BorderRadius.circular(20)),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _Stat('المتابعون', counts == null ? '—' : '${counts.followers}'),
              _Stat('يتابع', counts == null ? '—' : '${counts.following}'),
            ],
          ),
        );
      },
    );
  }

  Widget _about(String bio, String location) {
    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        _infoCard(
          'نبذة',
          bio.isEmpty ? 'لا توجد نبذة بعد.' : bio,
          Icons.notes_rounded,
        ),
        const SizedBox(height: 12),
        _infoCard(
          'الموقع',
          location.isEmpty ? 'غير محدد' : location,
          Icons.location_on_outlined,
        ),
      ],
    );
  }

  Widget _gifts() {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('public_gift_showcases')
          .doc(widget.userId)
          .collection('items')
          .orderBy('updatedAt', descending: true)
          .limit(60)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Center(child: Text('لا توجد هدايا عامة لعرضها حالياً', style: TextStyle(color: Colors.white54)));
        }
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF)));
        }
        final docs = snapshot.data!.docs;
        if (docs.isEmpty) {
          return const Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.card_giftcard_rounded, size: 50, color: Colors.white30),
                SizedBox(height: 10),
                Text('لم يستلم هدايا معروضة بعد', style: TextStyle(color: Colors.white54)),
              ],
            ),
          );
        }
        return GridView.builder(
          padding: const EdgeInsets.all(16),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 10, mainAxisSpacing: 10, childAspectRatio: .78),
          itemCount: docs.length,
          itemBuilder: (_, index) {
            final data = docs[index].data();
            return _GiftTile(data: data);
          },
        );
      },
    );
  }

  Widget _badges(int vip, int level, List<String> badges) {
    final entries = <MapEntry<String, String>>[
      if (vip > 0) MapEntry(ShadowAssetKeys.vipBadge(vip), 'VIP $vip'),
      if (level > 0) MapEntry(ShadowAssetKeys.levelBadge(level), 'المستوى $level'),
      ...badges.map((b) => MapEntry(normalizePublicBadgeKey(b), publicBadgeLabel(b))),
    ];
    if (entries.isEmpty) {
      return const Center(child: Text('لا توجد شارات عامة بعد', style: TextStyle(color: Colors.white54)));
    }
    return ListView(
      padding: const EdgeInsets.all(18),
      children: entries
          .map(
            (e) => Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: const Color(0xFF101522), borderRadius: BorderRadius.circular(18)),
              child: Row(
                children: [
                  RegistryBadge(assetKey: e.key, label: e.value),
                  const Spacer(),
                  const Icon(Icons.verified_rounded, color: Color(0xFFFFD54A), size: 18),
                ],
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _infoCard(String title, String text, IconData icon) => Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(color: const Color(0xFF101522), borderRadius: BorderRadius.circular(20)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: const Color(0xFFFFD54A)),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 5),
                  Text(text, style: const TextStyle(color: Colors.white60, height: 1.5)),
                ],
              ),
            ),
          ],
        ),
      );
}

class _GiftTile extends StatelessWidget {
  const _GiftTile({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final name = (data['name'] ?? data['giftName'] ?? 'هدية').toString();
    final count = (data['count'] as num?)?.toInt() ?? 1;
    final imageUrl = (data['imageUrl'] ?? '').toString().trim();
    final assetKey = (data['assetKey'] ?? '').toString().trim();

    Widget fallback() => const Icon(Icons.card_giftcard_rounded, color: Color(0xFFFFD54A), size: 42);

    Widget image;
    if (imageUrl.isNotEmpty) {
      image = Image.network(imageUrl, fit: BoxFit.contain, errorBuilder: (_, __, ___) => fallback());
    } else if (assetKey.isNotEmpty) {
      image = FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(assetKey),
        builder: (_, snap) => snap.data == null
            ? fallback()
            : Image.network(snap.data.toString(), fit: BoxFit.contain, errorBuilder: (_, __, ___) => fallback()),
      );
    } else {
      image = fallback();
    }

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(color: const Color(0xFF101522), borderRadius: BorderRadius.circular(18), border: Border.all(color: Colors.white10)),
      child: Column(
        children: [
          Expanded(child: Center(child: image)),
          const SizedBox(height: 6),
          Text(name, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 12)),
          const SizedBox(height: 3),
          Text('×$count', style: const TextStyle(color: Color(0xFFFFD54A), fontWeight: FontWeight.w900)),
        ],
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.label, this.value);
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
        children: [
          Text(value, style: const TextStyle(color: Color(0xFFFFD54A), fontSize: 18, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text(label, style: const TextStyle(color: Colors.white54, fontSize: 12)),
        ],
      );
}

class _TabHeaderDelegate extends SliverPersistentHeaderDelegate {
  _TabHeaderDelegate(this.bar);
  final TabBar bar;

  @override
  double get minExtent => bar.preferredSize.height;
  @override
  double get maxExtent => bar.preferredSize.height;
  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) => Container(color: const Color(0xFF0B0D16), child: bar);
  @override
  bool shouldRebuild(covariant _TabHeaderDelegate oldDelegate) => false;
}
