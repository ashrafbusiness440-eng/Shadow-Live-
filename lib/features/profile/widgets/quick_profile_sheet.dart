import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../screens/public_profile_screen.dart';
import '../services/follow_service.dart';
import '../services/profile_action_service.dart';
import 'registry_badge.dart';

Future<void> showQuickProfileSheet(BuildContext context, {required String userId}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    builder: (sheetContext) => _QuickProfileSheet(userId: userId),
  );
}

class _QuickProfileSheet extends StatefulWidget {
  const _QuickProfileSheet({required this.userId});
  final String userId;

  @override
  State<_QuickProfileSheet> createState() => _QuickProfileSheetState();
}

class _QuickProfileSheetState extends State<_QuickProfileSheet> {
  final _follow = FollowService();
  bool _changingFollow = false;

  ImageProvider? _avatar(Map<String, dynamic> data) {
    final photo = (data['profileImageUrl'] ?? '').toString().trim();
    final asset = (data['profileAvatarAsset'] ?? '').toString().trim();
    if (photo.isNotEmpty) return NetworkImage(photo);
    if (asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  Future<void> _gift(BuildContext context, String name) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF111625),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (giftContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(22),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.card_giftcard_rounded, color: Color(0xFFFFD54A), size: 42),
                const SizedBox(height: 12),
                Text('إرسال هدية إلى $name', style: const TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w900)),
                const SizedBox(height: 8),
                const Text(
                  'واجهة الإرسال جاهزة. تنفيذ الخصم والتحويل المالي سيتم عبر Backend آمن ضمن نظام الهدايا والاقتصاد، وليس مباشرة من التطبيق.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white60, height: 1.5),
                ),
                const SizedBox(height: 16),
                FilledButton(onPressed: () => Navigator.pop(giftContext), child: const Text('حسنًا')),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _openFull() {
    Navigator.pop(context);
    Navigator.of(this.context).push(MaterialPageRoute(builder: (_) => PublicProfileScreen(userId: widget.userId)));
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          future: FirebaseFirestore.instance.collection('public_profiles').doc(widget.userId).get(),
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const SizedBox(height: 330, child: Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF))));
            }
            final data = snapshot.data?.data();
            if (data == null) {
              return const SizedBox(height: 240, child: Center(child: Text('هذا الملف غير متاح', style: TextStyle(color: Colors.white60))));
            }
            final name = (data['displayName'] ?? 'مستخدم Shadow Live').toString();
            final photo = (data['profileImageUrl'] ?? '').toString();
            final publicId = (data['publicId'] ?? '—').toString();
            final level = (data['level'] as num?)?.toInt() ?? 0;
            final vip = (data['vipLevel'] as num?)?.toInt() ?? 0;
            final online = data['isOnline'] == true;
            final badges = data['badges'] is List
                ? (data['badges'] as List).map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
                : <String>[];
            final provider = _avatar(data);

            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(width: 44, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(4))),
                  const SizedBox(height: 18),
                  InkWell(
                    borderRadius: BorderRadius.circular(70),
                    onTap: _openFull,
                    child: Stack(
                      children: [
                        CircleAvatar(
                          radius: 48,
                          backgroundColor: const Color(0xFF25183F),
                          backgroundImage: provider,
                          child: provider == null ? const Icon(Icons.person, color: Color(0xFFFFD54A), size: 44) : null,
                        ),
                        if (online)
                          Positioned(
                            left: 3,
                            bottom: 3,
                            child: Container(
                              width: 17,
                              height: 17,
                              decoration: BoxDecoration(
                                color: const Color(0xFF38D996),
                                shape: BoxShape.circle,
                                border: Border.all(color: const Color(0xFF0C101A), width: 3),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  InkWell(
                    onTap: _openFull,
                    child: Column(
                      children: [
                        Text(name, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 4),
                        Text('ID: $publicId', textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white54)),
                      ],
                    ),
                  ),
                  if (vip > 0 || level > 0 || badges.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Wrap(
                      alignment: WrapAlignment.center,
                      spacing: 7,
                      runSpacing: 7,
                      children: [
                        if (vip > 0) RegistryBadge(assetKey: 'vip.badge.$vip', label: 'VIP $vip'),
                        if (level > 0) RegistryBadge(assetKey: 'level.badge.$level', label: 'Lv.$level', fallbackIcon: Icons.star_rounded),
                        ...badges.take(3).map((b) => RegistryBadge(assetKey: normalizePublicBadgeKey(b), label: publicBadgeLabel(b))),
                      ],
                    ),
                  ],
                  const SizedBox(height: 20),
                  Row(
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
                              style: FilledButton.styleFrom(backgroundColor: following ? const Color(0xFF262B38) : const Color(0xFF7B2DFF)),
                              icon: Icon(following ? Icons.person_remove_alt_1_rounded : Icons.person_add_alt_1_rounded),
                              label: Text(following ? 'إلغاء المتابعة' : 'متابعة'),
                            );
                          },
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () async {
                            Navigator.pop(context);
                            await ProfileActionService.openChat(
                              this.context,
                              otherUid: widget.userId,
                              otherName: name,
                              otherPhoto: photo,
                            );
                          },
                          icon: const Icon(Icons.chat_bubble_outline_rounded),
                          label: const Text('رسالة'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () => _gift(context, name),
                          icon: const Icon(Icons.card_giftcard_rounded, color: Color(0xFFFFD54A)),
                          label: const Text('هدية'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextButton.icon(onPressed: _openFull, icon: const Icon(Icons.open_in_new_rounded), label: const Text('عرض الملف الشخصي الكامل')),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
