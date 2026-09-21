import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/follow_service.dart';
import '../services/profile_action_service.dart';
import '../widgets/profile_gift_sheet.dart';
import '../widgets/registry_badge.dart';
import 'public_profile_screen.dart';

Future<void> showProfilePreviewSheet(
  BuildContext context, {
  required String userId,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0D101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
    ),
    builder: (_) => ProfilePreviewSheet(userId: userId),
  );
}

class ProfilePreviewSheet extends StatefulWidget {
  const ProfilePreviewSheet({super.key, required this.userId});

  final String userId;

  @override
  State<ProfilePreviewSheet> createState() => _ProfilePreviewSheetState();
}

class _ProfilePreviewSheetState extends State<ProfilePreviewSheet> {
  final _follow = FollowService();
  bool _followBusy = false;

  ImageProvider? _avatar(Map<String, dynamic> data) {
    final photo = '${data['profileImageUrl'] ?? ''}';
    final asset = '${data['profileAvatarAsset'] ?? ''}';
    if (photo.isNotEmpty) return NetworkImage(photo);
    if (asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  List<String> _badges(Map<String, dynamic> data) {
    final raw = data['badges'];
    if (raw is! List) return const [];
    return raw.map((e) => '$e').where((e) => e.trim().isNotEmpty).toList();
  }

  Future<void> _toggleFollow(bool currentlyFollowing) async {
    if (_followBusy) return;
    setState(() => _followBusy = true);
    try {
      await _follow.setFollowing(widget.userId, !currentlyFollowing);
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

  void _openFullProfile() {
    final navigator = Navigator.of(context);
    navigator.pop();
    navigator.push(
      MaterialPageRoute(
        builder: (_) => PublicProfileScreen(userId: widget.userId),
      ),
    );
  }

  Future<void> _openChat(Map<String, dynamic> data) async {
    final navigator = Navigator.of(context);
    final name = '${data['displayName'] ?? 'مستخدم Shadow Live'}';
    final photo = '${data['profileImageUrl'] ?? ''}';
    navigator.pop();
    await ProfileActionService.openChat(
      navigator.context,
      otherUid: widget.userId,
      otherName: name,
      otherPhoto: photo,
    );
  }

  @override
  Widget build(BuildContext context) {
    final me = FirebaseAuth.instance.currentUser?.uid;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance
              .collection('public_profiles')
              .doc(widget.userId)
              .snapshots(),
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const SizedBox(
                height: 360,
                child: Center(
                  child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
                ),
              );
            }
            final data = snapshot.data?.data();
            if (data == null) {
              return const SizedBox(
                height: 280,
                child: Center(
                  child: Text(
                    'هذا الملف غير متاح',
                    style: TextStyle(color: Colors.white60),
                  ),
                ),
              );
            }

            final name = '${data['displayName'] ?? 'مستخدم Shadow Live'}';
            final publicId = '${data['publicId'] ?? '—'}';
            final level = (data['level'] as num?)?.toInt() ?? 0;
            final vip = (data['vipLevel'] as num?)?.toInt() ?? 0;
            final online = data['isOnline'] == true;
            final provider = _avatar(data);
            final badges = _badges(data);
            final isSelf = me == widget.userId;

            return SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(18, 14, 18, 22),
              child: Column(
                children: [
                  Container(
                    width: 44,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(99),
                    ),
                  ),
                  const SizedBox(height: 18),
                  InkWell(
                    onTap: _openFullProfile,
                    borderRadius: BorderRadius.circular(72),
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        CircleAvatar(
                          radius: 58,
                          backgroundColor: const Color(0xFF25183F),
                          backgroundImage: provider,
                          child: provider == null
                              ? const Icon(
                                  Icons.person,
                                  size: 54,
                                  color: Color(0xFFFFD54A),
                                )
                              : null,
                        ),
                        if (online)
                          Positioned(
                            left: 2,
                            bottom: 4,
                            child: Container(
                              width: 19,
                              height: 19,
                              decoration: BoxDecoration(
                                color: const Color(0xFF38D996),
                                shape: BoxShape.circle,
                                border: Border.all(
                                  color: const Color(0xFF0D101A),
                                  width: 3,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  InkWell(
                    onTap: _openFullProfile,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      child: Text(
                        name,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 23,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'ID: $publicId',
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(color: Colors.white54),
                  ),
                  if (level > 0 || vip > 0 || badges.isNotEmpty) ...[
                    const SizedBox(height: 12),
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
                  const SizedBox(height: 20),
                  if (!isSelf)
                    StreamBuilder<bool>(
                      stream: _follow.isFollowing(widget.userId),
                      builder: (context, followSnapshot) {
                        final following = followSnapshot.data == true;
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
                            _ActionCircle(
                              tooltip: 'رسالة',
                              icon: Icons.chat_bubble_outline_rounded,
                              onTap: () => _openChat(data),
                            ),
                            const SizedBox(width: 8),
                            _ActionCircle(
                              tooltip: 'إرسال هدية',
                              icon: Icons.card_giftcard_rounded,
                              onTap: () => showProfileGiftSheet(
                                context,
                                receiverUid: widget.userId,
                                receiverName: name,
                              ),
                            ),
                          ],
                        );
                      },
                    ),
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _openFullProfile,
                      icon: const Icon(Icons.account_circle_outlined),
                      label: const Text('عرض الملف الشخصي الكامل'),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: Colors.white,
                        side: const BorderSide(color: Colors.white24),
                        padding: const EdgeInsets.symmetric(vertical: 13),
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _ActionCircle extends StatelessWidget {
  const _ActionCircle({
    required this.tooltip,
    required this.icon,
    required this.onTap,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 50,
          height: 50,
          decoration: BoxDecoration(
            color: const Color(0xFF171B28),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white12),
          ),
          child: Icon(icon, color: const Color(0xFFFFD54A)),
        ),
      ),
    );
  }
}
