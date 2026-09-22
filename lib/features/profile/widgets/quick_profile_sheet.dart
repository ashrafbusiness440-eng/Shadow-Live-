import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../screens/public_profile_screen.dart';
import '../services/follow_service.dart';
import '../services/profile_action_service.dart';
import 'registry_badge.dart';

class QuickProfileAction {
  const QuickProfileAction({
    required this.icon,
    required this.label,
    required this.onTap,
    this.color = Colors.white,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final Color color;
}

Future<void> showQuickProfileSheet(
  BuildContext context, {
  required String userId,
  List<QuickProfileAction> adminActions = const [],
}) async {
  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0C101A),
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
    builder: (sheetContext) => _QuickProfileSheet(
      userId: userId,
      adminActions: adminActions,
    ),
  );
}

class _QuickProfileSheet extends StatefulWidget {
  const _QuickProfileSheet({
    required this.userId,
    required this.adminActions,
  });
  final String userId;
  final List<QuickProfileAction> adminActions;

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
    final navigator = Navigator.of(context);
    Navigator.pop(context);
    navigator.push(MaterialPageRoute(builder: (_) => PublicProfileScreen(userId: widget.userId)));
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
                              style: FilledButton.styleFrom(
                                backgroundColor: following ? const Color(0xFF262B38) : const Color(0xFF7B2DFF),
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
                          onPressed: () async {
                            final navigator = Navigator.of(context);
                            Navigator.pop(context);
                            await ProfileActionService.openChatWithNavigator(
                              navigator,
                              otherUid: widget.userId,
                              otherName: name,
                              otherPhoto: photo,
                            );
                          },
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
                          onPressed: () => _gift(context, name),
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
                  if (widget.adminActions.isNotEmpty) ...[
                    const SizedBox(height: 14),
                    const Divider(color: Colors.white10),
                    ...widget.adminActions.map(
                      (action) => ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(action.icon, color: action.color),
                        title: Text(
                          action.label,
                          style: TextStyle(
                            color: action.color,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        onTap: () {
                          Navigator.pop(context);
                          action.onTap();
                        },
                      ),
                    ),
                  ],
                  if (widget.canManageMic) ...[
                    const SizedBox(height: 12),
                    const Divider(color: Colors.white10),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        if (!widget.userOnMic && widget.onInviteToMic != null)
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.pop(context);
                                widget.onInviteToMic?.call();
                              },
                              icon: const Icon(Icons.mic_external_on_rounded),
                              label: const Text('دعوة للمايك'),
                            ),
                          ),
                        if (widget.userOnMic && widget.onRemoveFromMic != null) ...[
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.pop(context);
                                widget.onRemoveFromMic?.call();
                              },
                              icon: const Icon(Icons.person_remove_rounded),
                              label: const Text('إنزال'),
                            ),
                          ),
                          const SizedBox(width: 8),
                        ],
                        if (widget.userOnMic)
                          Expanded(
                            child: OutlinedButton.icon(
                              onPressed: () {
                                Navigator.pop(context);
                                if (widget.userMuted) {
                                  widget.onUnmuteMic?.call();
                                } else {
                                  widget.onMuteMic?.call();
                                }
                              },
                              icon: Icon(
                                widget.userMuted
                                    ? Icons.mic_rounded
                                    : Icons.mic_off_rounded,
                              ),
                              label: Text(
                                widget.userMuted
                                    ? 'إزالة الكتم'
                                    : 'كتم المايك',
                              ),
                            ),
                          ),
                      ],
                    ),
                  ],
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
