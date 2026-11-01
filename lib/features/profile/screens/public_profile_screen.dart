import '../services/profile_membership_days.dart';
import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../widgets/profile_gift_showcase.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../chat/services/chat_safety_service.dart';
import '../../diaries/screens/diaries_screen.dart';
import '../services/follow_service.dart';
import '../services/profile_action_service.dart';
import '../services/user_level_service.dart';
import 'user_level_screen.dart';
import 'public_user_support_screen.dart';
import '../../gift/widgets/direct_gift_sheet.dart';
import '../../relationships/services/relationship_service.dart';
import '../../vip/utils/vip_public_state.dart';
import '../../vip/services/profile_visit_service.dart';
import '../../vip/widgets/vip_avatar_frame.dart';
import '../../vip/widgets/vip_profile_avatar.dart';
import '../../vip/widgets/vip_profile_identity.dart';
import '../widgets/registry_badge.dart';
import '../widgets/profile_identity_status_strip.dart';
import '../widgets/profile_avatar_with_frame.dart';
import '../widgets/profile_identity_info_line.dart';
import '../widgets/store_verified_profile_card_backdrop.dart';

class PublicProfileScreen extends StatefulWidget {
  const PublicProfileScreen({super.key, required this.userId});
  final String userId;

  @override
  State<PublicProfileScreen> createState() => _PublicProfileScreenState();
}

class _PublicProfileScreenState extends State<PublicProfileScreen> with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  final _follow = FollowService();
  final _reports = ChatSafetyService();
  final _relationships = RelationshipService();
  late final UserLevelService _levelService;
  late final ProfileVisitService _profileVisits;
  late Future<DocumentSnapshot<Map<String, dynamic>>> _profileFuture;
  late Future<UserLevelSummary> _levelFuture;
  late Future<FollowCounts> _followCountsFuture;
  bool _changingFollow = false;
  bool _sendingRelationship = false;
  bool _reportingProfile = false;

  bool get _isSelf => FirebaseAuth.instance.currentUser?.uid == widget.userId;
  bool get _guest => FirebaseAuth.instance.currentUser?.isAnonymous == true;

  Future<void> _guestAction() async {
    if (!_guest || !mounted) return;
    final shouldLogin = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('تسجيل الدخول'),
        content: const Text(
          'يمكنك مشاهدة الملف واليوميات كضيف، لكن يلزم تسجيل الدخول للتفاعل.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('لاحقاً'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('تسجيل الدخول'),
          ),
        ],
      ),
    );
    if (shouldLogin == true && mounted) {
      context.read<AuthBloc>().add(SignOutRequested());
    }
  }

  Future<void> _copyUserIds({
    required String publicId,
    required String fancyId,
  }) async {
    final basic = publicId.trim();
    final fancy = fancyId.trim();
    if (fancy.isEmpty) {
      if (basic.isEmpty || basic == '—') return;
      await Clipboard.setData(ClipboardData(text: basic));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم نسخ Public ID')),
      );
      return;
    }

    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: const Color(0xFF0D111B),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Wrap(
            children: [
              ListTile(
                title: const Text(
                  'نسخ Fancy ID',
                  style: TextStyle(color: Colors.white),
                ),
                subtitle: Text(
                  fancy,
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(color: Colors.white54),
                ),
                onTap: () => Navigator.pop(sheetContext, fancy),
              ),
              ListTile(
                title: const Text(
                  'نسخ Public ID الأساسي',
                  style: TextStyle(color: Colors.white),
                ),
                subtitle: Text(
                  basic,
                  textDirection: TextDirection.ltr,
                  style: const TextStyle(color: Colors.white54),
                ),
                onTap: () => Navigator.pop(sheetContext, basic),
              ),
            ],
          ),
        ),
      ),
    );
    if (selected == null || selected.isEmpty) return;
    await Clipboard.setData(ClipboardData(text: selected));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('تم نسخ ID المستخدم')),
    );
  }

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 4, vsync: this);
    _levelService = UserLevelService();
    _profileVisits = ProfileVisitService();
    _loadProfileFutures();
    unawaited(_recordVisit());
  }

  void _loadProfileFutures() {
    _profileFuture = FirebaseFirestore.instance
        .collection('public_profiles')
        .doc(widget.userId)
        .get();
    _levelFuture = _levelService.loadForUser(widget.userId);
    // Reuse one aggregate future instead of querying followers on rebuild.
    _followCountsFuture = _follow.counts(widget.userId);
  }

  @override
  void didUpdateWidget(covariant PublicProfileScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userId != widget.userId) {
      _loadProfileFutures();
      unawaited(_recordVisit());
    }
  }

  Future<void> _recordVisit() async {
    if (_isSelf || _guest) return;
    try {
      await _profileVisits.record(widget.userId);
    } catch (_) {
      // Visit tracking must never block or degrade profile rendering.
    }
  }

  @override
  void dispose() {
    _profileVisits.close();
    _levelService.close();
    _tabs.dispose();
    super.dispose();
  }

  ImageProvider? _avatar(Map<String, dynamic> data) =>
      effectiveProfileAvatarProvider(data);

  Future<void> _showGiftInfo(String name) => showDirectGiftSheet(
        context,
        receiverId: widget.userId,
        receiverName: name,
      );

  Future<void> _requestRelationship(String name) async {
    if (_sendingRelationship) return;
    setState(() => _sendingRelationship = true);
    try {
      final types = await _relationships.types();
      if (!mounted) return;
      final enabled =
          types.where((type) => type.enabled).toList(growable: false);
      if (enabled.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('لا توجد أنواع علاقات متاحة حالياً.')),
        );
        return;
      }

      final selected = await showModalBottomSheet<RelationshipTypeOption>(
        context: context,
        backgroundColor: const Color(0xFF0D111B),
        showDragHandle: true,
        builder: (sheetContext) => Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
              children: [
                Text(
                  'طلب علاقة مع $name',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 10),
                ...enabled.map(
                  (type) => ListTile(
                    leading: const Icon(
                      Icons.favorite_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    title: Text(
                      type.labelAr,
                      style: const TextStyle(color: Colors.white),
                    ),
                    onTap: () => Navigator.pop(sheetContext, type),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
      if (selected == null || !mounted) return;

      await _relationships.sendRequest(
        targetUserId: widget.userId,
        relationshipType: selected.key,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم إرسال طلب ${selected.labelAr}.',
          ),
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(relationshipErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _sendingRelationship = false);
    }
  }


  Future<void> _reportProfile() async {
    if (_isSelf || _reportingProfile) return;
    if (_guest) {
      await _guestAction();
      return;
    }
    setState(() => _reportingProfile = true);
    final detailsController = TextEditingController();
    var reason = 'harassment';
    var sending = false;
    const labels = <String, String>{
      'spam': 'محتوى مزعج',
      'harassment': 'مضايقة أو إساءة',
      'inappropriate_content': 'محتوى غير مناسب',
      'scam': 'احتيال أو تضليل',
      'other': 'سبب آخر',
    };
    try {
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (dialogContext) => StatefulBuilder(
          builder: (dialogContext, setDialogState) => AlertDialog(
            backgroundColor: const Color(0xFF111522),
            title: const Text('الإبلاغ عن الحساب'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                DropdownButtonFormField<String>(
                  value: reason,
                  dropdownColor: const Color(0xFF171C2A),
                  decoration: const InputDecoration(labelText: 'سبب البلاغ'),
                  items: labels.entries.map((entry) => DropdownMenuItem(
                    value: entry.key,
                    child: Text(entry.value),
                  )).toList(),
                  onChanged: sending ? null : (value) {
                    if (value != null) setDialogState(() => reason = value);
                  },
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: detailsController,
                  maxLength: 500,
                  minLines: 2,
                  maxLines: 4,
                  enabled: !sending,
                  decoration: const InputDecoration(
                    hintText: 'تفاصيل إضافية (اختياري)',
                  ),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: sending ? null :
                  () => Navigator.pop(dialogContext),
                child: const Text('إلغاء'),
              ),
              FilledButton.icon(
                onPressed: sending ? null : () async {
                  setDialogState(() => sending = true);
                  try {
                    await _reports.reportProfile(
                      targetUserId: widget.userId,
                      reason: reason,
                      details: detailsController.text.trim(),
                    );
                    if (dialogContext.mounted) Navigator.pop(dialogContext);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text(
                          'تم إرسال بلاغ الحساب إلى الإدارة للمراجعة.',
                        )),
                      );
                    }
                  } on StateError catch (error) {
                    final message = switch (error.message) {
                      'report_recent_duplicate' =>
                        'سبق إرسال بلاغ عن نفس السبب مؤخرًا.',
                      'rate_limited' =>
                        'أرسلت عدة بلاغات مؤخرًا. حاول لاحقًا.',
                      'not_found' =>
                        'الحساب لم يعد متاحًا. حدّث الصفحة.',
                      _ => 'تعذر إرسال البلاغ. حاول مرة أخرى.',
                    };
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(message)),
                      );
                    }
                    if (dialogContext.mounted) {
                      setDialogState(() => sending = false);
                    }
                  } catch (_) {
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text(
                          'تعذر إرسال البلاغ. تحقق من الاتصال وحاول مجددًا.',
                        )),
                      );
                    }
                    if (dialogContext.mounted) {
                      setDialogState(() => sending = false);
                    }
                  }
                },
                icon: sending
                  ? const SizedBox.square(
                      dimension: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.flag_outlined),
                label: const Text('إرسال البلاغ'),
              ),
            ],
          ),
        ),
      );
    } finally {
      detailsController.dispose();
      if (mounted) setState(() => _reportingProfile = false);
    }
  }

  void _openLevel(int tabIndex) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => _isSelf
            ? UserLevelScreen(initialTabIndex: tabIndex)
            : PublicUserSupportScreen(
                userId: widget.userId,
                initialTabIndex: tabIndex,
              ),
      ),
    );
  }

  Widget _identityStatusStrip(Map<String, dynamic> profile, int vip) {
    return FutureBuilder<UserLevelSummary>(
      future: _levelFuture,
      builder: (context, snapshot) {
        final summary = snapshot.data;
        return ProfileIdentityStatusStrip(
          membershipDays: verifiedMembershipDays(profile),
          wealthLevel: summary?.wealth.level ?? 0,
          attractionLevel: summary?.attraction.level ?? 0,
          vipLevel: vip,
          age: profile['age'],
          gender: (profile['gender'] ?? '').toString(),
          location: (profile['location'] ?? profile['country'] ?? '').toString(),
          onLevelTap: _openLevel,
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          future: _profileFuture,
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
            final fancyId = (data['activeFancyId'] ?? '').toString().trim();
            final bio = (data['bio'] ?? '').toString();
            final location = (data['location'] ?? '').toString();
            final moodEmoji = (data['moodEmoji'] ?? '').toString().trim();
            final moodText = (data['moodText'] ?? '').toString().trim();
            final interests = data['interests'] is List
                ? (data['interests'] as List)
                    .map((e) => e.toString().trim())
                    .where((e) => e.isNotEmpty)
                    .toList(growable: false)
                : <String>[];
            final vip = effectivePublicVipLevel(data);
            final vipFrameLevel =
                (data['vipProfileFrameLevel'] as num?)?.toInt() ?? vip;
            // The cached public profile has no verified realtime presence.
            // Never claim that a user is online from its legacy isOnline flag.
            final badges = data['badges'] is List
                ? (data['badges'] as List).map((e) => e.toString()).where((e) => e.isNotEmpty).toList()
                : <String>[];
            final isSelf = _isSelf;

            return NestedScrollView(
              headerSliverBuilder: (_, __) => [
                SliverAppBar(
                  pinned: true,
                  expandedHeight: 390,
                  backgroundColor: const Color(0xFF0B0D16),
                  foregroundColor: Colors.white,
                  title: Text(isSelf ? 'بروفايلي' : 'الملف الشخصي'),
                  actions: [
                    if (!isSelf)
                      IconButton(
                        tooltip: 'الإبلاغ عن الحساب',
                        onPressed: _reportingProfile ? null : _reportProfile,
                        icon: const Icon(Icons.flag_outlined),
                      ),
                  ],
                  flexibleSpace: FlexibleSpaceBar(
                    background: _header(
                      profile: data,
                      name: name,
                      publicId: publicId,
                      fancyId: fancyId,
                      cover: cover,
                      vip: vip,
                      vipFrameLevel: vipFrameLevel,
                      badges: badges,
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 14, 16, 8),
                    child: Row(
                      children: [
                        if (!isSelf) ...[
                          Expanded(
                            child: StreamBuilder<bool>(
                              stream: _follow.isFollowing(widget.userId),
                              builder: (context, followSnapshot) {
                                final following = followSnapshot.data == true;
                                return FilledButton.icon(
                                  onPressed: _changingFollow
                                      ? null
                                      : () async {
                                          if (_guest) {
                                            await _guestAction();
                                            return;
                                          }
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
                              onPressed: () async {
                                if (_guest) {
                                  await _guestAction();
                                  return;
                                }
                                if (!context.mounted) return;
                                ProfileActionService.openChat(
                                  context,
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
                        ],
                        Expanded(
                          child: OutlinedButton.icon(
                            onPressed: () async {
                              if (_guest) {
                                await _guestAction();
                                return;
                              }
                              await _showGiftInfo(name);
                            },
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
                if (!isSelf)
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                      child: Align(
                        alignment: Alignment.center,
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 300),
                          child: OutlinedButton.icon(
                            onPressed: _sendingRelationship
                                ? null
                                : () async {
                                    if (_guest) {
                                      await _guestAction();
                                      return;
                                    }
                                    await _requestRelationship(name);
                                  },
                            style: OutlinedButton.styleFrom(
                              foregroundColor: const Color(0xFFFFD54A),
                              backgroundColor: const Color(0xFF161927),
                              side: const BorderSide(
                                color: Color(0xFF7352A1),
                                width: .8,
                              ),
                              padding: const EdgeInsets.symmetric(
                                horizontal: 14,
                                vertical: 10,
                              ),
                              minimumSize: const Size(0, 44),
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14),
                              ),
                            ),
                            icon: _sendingRelationship
                                ? const SizedBox.square(
                                    dimension: 17,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(Icons.favorite_outline_rounded, size: 18),
                            label: const Text('طلب علاقة'),
                          ),
                        ),
                      ),
                    ),
                  ),
                SliverToBoxAdapter(child: _stats()),
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
                        Tab(text: 'يومياتي'),
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
                  _about(
                    bio,
                    location,
                    moodEmoji,
                    moodText,
                    interests,
                  ),
                  DiariesScreen(
                    profileUserId: widget.userId,
                    embedded: true,
                    onGuestAction: _guestAction,
                  ),
                  _gifts(),
                  _badges(vip, badges),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _header({
    required Map<String, dynamic> profile,
    required String name,
    required String publicId,
    required String fancyId,
    required String cover,
    required int vip,
    required int vipFrameLevel,
    required List<String> badges,
  }) {
    return VipProfileIdentitySurface(
      vipLevel: vip,
      child: Container(
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
      child: StoreVerifiedProfileCardBackdrop(
        userId: widget.userId,
        child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          ProfileAvatarWithFrame(
            diameter: 110,
            protectAvatarCenter: true,
            userId: widget.userId,
            verifyStoreFrame: true,
            fallbackProfile: profile,
            vipLevel: vip,
            vipFrameLevel: vipFrameLevel,
            useVipFallback: true,
          ),
          const SizedBox(height: 2),
          VipStyledName(
            vipLevel: vip,
            name: name,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 25,
              fontWeight: FontWeight.w900,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 0),
          ProfileIdentityInfoLine(
            id: fancyId.isNotEmpty ? fancyId : publicId,
            location: '',
            copyKey: const Key('public-profile-copy-id'),
            onCopy: () => _copyUserIds(
              publicId: publicId,
              fancyId: fancyId,
            ),
          ),
          const SizedBox(height: 0),
          _identityStatusStrip(profile, vip),
          if (badges.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 7,
              runSpacing: 7,
              children: badges.take(4)
                  .map((b) => RegistryBadge(
                    assetKey: normalizePublicBadgeKey(b),
                    label: publicBadgeLabel(b),
                  ))
                  .toList(growable: false),
            ),
          ],
        ],
        ),
      ),
    ));
  }

  Widget _stats() {
    return FutureBuilder<FollowCounts>(
      future: _followCountsFuture,
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

  Widget _about(
    String bio,
    String location,
    String moodEmoji,
    String moodText,
    List<String> interests,
  ) {
    final mood = [
      if (moodEmoji.isNotEmpty) moodEmoji,
      if (moodText.isNotEmpty) moodText,
    ].join(' ').trim();

    return ListView(
      padding: const EdgeInsets.all(18),
      children: [
        _infoCard(
          'الحالة',
          mood.isEmpty ? 'لم يضف حالة حتى الآن' : mood,
          mood.isEmpty
              ? Icons.sentiment_neutral_outlined
              : Icons.sentiment_satisfied_alt_rounded,
        ),
        const SizedBox(height: 12),
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
        if (interests.isNotEmpty) ...[
          const SizedBox(height: 12),
          _interestsCard(interests),
        ],
      ],
    );
  }

  Widget _interestsCard(List<String> interests) {
    final preview = interests.take(6).toList(growable: false);
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFF101522),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Icon(Icons.interests_rounded, color: Color(0xFFFFD54A)),
              SizedBox(width: 10),
              Text(
                'الاهتمامات',
                style: TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 7,
            runSpacing: 7,
            children: preview
                .map(
                  (interest) => Chip(
                    label: Text(interest),
                    labelStyle: const TextStyle(
                      color: Colors.white,
                      fontSize: 11,
                    ),
                    backgroundColor: const Color(0xFF20263A),
                    side: BorderSide.none,
                    visualDensity: VisualDensity.compact,
                  ),
                )
                .toList(growable: false),
          ),
          if (interests.length > preview.length)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () => _showAllInterests(interests),
                child: Text(
                  'عرض الكل (' + interests.length.toString() + ')',
                  style: const TextStyle(color: Color(0xFFFFD54A)),
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _showAllInterests(List<String> interests) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF0D111B),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 26),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'الاهتمامات',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 7,
                  runSpacing: 7,
                  children: interests
                      .map(
                        (interest) => Chip(
                          label: Text(interest),
                          labelStyle: const TextStyle(color: Colors.white),
                          backgroundColor: const Color(0xFF20263A),
                          side: BorderSide.none,
                        ),
                      )
                      .toList(growable: false),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _gifts() => ProfileGiftShowcase(userId: widget.userId);

  Widget _badges(int vip, List<String> badges) {
    final entries = <MapEntry<String, String>>[
      if (vip > 0) MapEntry(ShadowAssetKeys.vipBadge(vip), 'VIP $vip'),
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
