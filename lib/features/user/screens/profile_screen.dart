import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';

import '../../../services/navigation_service.dart';
import '../../../shared/widgets/custom_button.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../utils/compact_number.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../wallet/screens/recharge_screen.dart';
import '../../profile/screens/my_items_screen.dart';
import '../../profile/services/reward_inventory_service.dart';
import '../../room/widgets/cosmetic_effect_widgets.dart';
import '../bloc/user_bloc.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  bool _loggingOut = false;
  bool _openingEdit = false;
  StreamSubscription<DocumentSnapshot<Map<String, dynamic>>>? _profileSub;
  final RewardInventoryService _inventoryService = RewardInventoryService();
  MyItemReward? _activeFrame;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _watchProfile();
      _load();
    });
  }

  @override
  void dispose() {
    _profileSub?.cancel();
    _inventoryService.close();
    _tabs.dispose();
    super.dispose();
  }

  bool get _guest {
    final firebaseUser = FirebaseAuth.instance.currentUser;
    if (firebaseUser?.isAnonymous == true) return true;

    final auth = context.read<AuthBloc>().state;
    return auth is Authenticated &&
        (auth.user.isAnonymous || auth.userData?['isGuest'] == true);
  }

  void _watchProfile() {
    if (!mounted || _guest) return;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null || uid.isEmpty) return;

    _profileSub?.cancel();
    _profileSub = FirebaseFirestore.instance
        .collection('users')
        .doc(uid)
        .snapshots()
        .skip(1)
        .listen(
      (_) {
        if (mounted) _load();
      },
      onError: (_) {
        // Expected if authentication ends before this screen is disposed.
      },
    );
  }

  void _load() {
    if (!mounted || _guest) return;

    final firebaseUser = FirebaseAuth.instance.currentUser;
    String? uid = firebaseUser?.uid;

    if (uid == null) {
      final auth = context.read<AuthBloc>().state;
      if (auth is Authenticated) uid = auth.user.uid;
    }

    if (uid != null && uid.isNotEmpty) {
      context.read<UserBloc>().add(LoadUserProfile(uid));
      unawaited(_loadActiveFrame());
    }
  }

  Future<void> _loadActiveFrame() async {
    try {
      final items = await _inventoryService.load();
      final now = DateTime.now().millisecondsSinceEpoch;
      MyItemReward? active;
      for (final item in items) {
        if (item.type == 'frame' &&
            item.active &&
            !item.expired &&
            item.expiresAtMs > now) {
          active = item;
          break;
        }
      }
      if (!mounted) return;
      setState(() => _activeFrame = active);
    } catch (_) {
      // Profile still works if cosmetic metadata cannot be loaded.
    }
  }

  Future<void> _openMyItems() async {
    await Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => const MyItemsScreen()),
    );
    if (mounted) _load();
  }

  Future<void> _edit() async {
    if (_openingEdit) return;

    setState(() => _openingEdit = true);
    try {
      final changed =
          await Navigator.of(context).pushNamed(AppRoutes.editProfile);
      if (changed == true && mounted) _load();
    } finally {
      if (mounted) setState(() => _openingEdit = false);
    }
  }

  Future<void> _recharge(int tab) async {
    await Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => RechargeScreen(initialTab: tab)),
    );
    if (mounted) _load();
  }

  void _guestLogin() {
    if (_loggingOut) return;
    setState(() => _loggingOut = true);
    context.read<AuthBloc>().add(SignOutRequested());
  }

  String _text(
    Map<String, dynamic> profile,
    String key, [
    String fallback = '—',
  ]) {
    final value = profile[key];
    if (value == null || value.toString().trim().isEmpty) return fallback;
    return value.toString();
  }

  int _num(Map<String, dynamic> profile, List<String> keys) {
    for (final key in keys) {
      final value = profile[key];
      if (value is num) return value.toInt();
      final parsed = int.tryParse(value?.toString() ?? '');
      if (parsed != null) return parsed;
    }
    return 0;
  }

  ImageProvider? _avatar(Map<String, dynamic> profile) {
    final url = profile['profileImageUrl'] ?? profile['avatarUrl'];
    if (url is String && url.isNotEmpty) return NetworkImage(url);

    final asset = profile['profileAvatarAsset'];
    if (asset is String && asset.isNotEmpty) return AssetImage(asset);

    return null;
  }

  List<String> _ids(Map<String, dynamic> profile) {
    final result = <String>[];
    final current = profile['publicId']?.toString();
    if (current != null && current.isNotEmpty) result.add(current);

    final history = profile['publicIdHistory'];
    if (history is List) {
      for (final item in history) {
        final id = item is Map ? item['id']?.toString() : item.toString();
        if (id != null && id.isNotEmpty && !result.contains(id)) {
          result.add(id);
        }
      }
    }

    return result;
  }

  Future<void> _copyId(Map<String, dynamic> profile) async {
    final ids = _ids(profile);
    if (ids.isEmpty) return;

    String? id;
    if (ids.length == 1) {
      id = ids.first;
    } else {
      id = await showModalBottomSheet<String>(
        context: context,
        backgroundColor: const Color(0xFF101827),
        builder: (sheetContext) => Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Text(
                    'اختر ID للنسخ',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                ...ids.asMap().entries.map(
                      (entry) => ListTile(
                        title: Text(
                          entry.value,
                          style: const TextStyle(color: Colors.white),
                        ),
                        subtitle: Text(
                          entry.key == 0 ? 'ID الحالي' : 'ID سابق',
                          style: const TextStyle(color: Colors.white54),
                        ),
                        trailing: const Icon(
                          Icons.copy_rounded,
                          color: Color(0xFF8B5CF6),
                        ),
                        onTap: () =>
                            Navigator.pop(sheetContext, entry.value),
                      ),
                    ),
              ],
            ),
          ),
        ),
      );
    }

    if (id == null) return;
    await Clipboard.setData(ClipboardData(text: id));
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('تم نسخ ID')),
    );
  }

  Widget _guestView() => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const CircleAvatar(
                radius: 54,
                backgroundColor: Color(0xFF251044),
                child: Icon(
                  Icons.person_outline_rounded,
                  size: 62,
                  color: Color(0xFFFFD54A),
                ),
              ),
              const SizedBox(height: 20),
              const Text(
                'أنت داخل كضيف',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              const Text(
                'سجّل الدخول أو أنشئ حساباً لحفظ ملفك الشخصي واستخدام ميزات الحساب.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white60, height: 1.6),
              ),
              const SizedBox(height: 26),
              CustomButton(
                text: _loggingOut
                    ? 'جارٍ العودة...'
                    : 'العودة لتسجيل الدخول',
                onPressed: _loggingOut ? null : _guestLogin,
              ),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    return BlocListener<AuthBloc, AuthState>(
      listener: (context, state) {
        if (state is Authenticated && !_loggingOut) {
          if (mounted) setState(() {});
          _load();
        } else if (state is Unauthenticated && _loggingOut) {
          NavigationService.navigateToAndRemoveUntil(AppRoutes.authChoice);
        } else if (state is AuthError && _loggingOut) {
          setState(() => _loggingOut = false);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.message)),
          );
        }
      },
      child: Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF020711),
          body: _guest
              ? _guestView()
              : BlocBuilder<UserBloc, UserState>(
                  builder: (context, state) {
                    if (state is UserInitial) {
                      return Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const LoadingIndicator(),
                            const SizedBox(height: 12),
                            TextButton(
                              onPressed: _load,
                              child: const Text('إعادة تحميل الملف الشخصي'),
                            ),
                          ],
                        ),
                      );
                    }

                    if (state is UserLoading) {
                      return const LoadingIndicator();
                    }

                    if (state is UserError) {
                      return Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(
                              state.message,
                              textAlign: TextAlign.center,
                              style: const TextStyle(color: Colors.white70),
                            ),
                            const SizedBox(height: 12),
                            CustomButton(
                              text: 'إعادة المحاولة',
                              onPressed: _load,
                            ),
                          ],
                        ),
                      );
                    }

                    final currentUid =
                        FirebaseAuth.instance.currentUser?.uid ?? '';
                    final profile = state is UserProfileLoaded &&
                            state.userId == currentUid
                        ? state.profile
                        : state is UserProfileUpdated &&
                                state.userId == currentUid
                            ? state.profile
                            : null;

                    if (profile == null) {
                      return Center(
                        child: CustomButton(
                          text: 'إعادة تحميل الملف الشخصي',
                          onPressed: _load,
                        ),
                      );
                    }

                    return NestedScrollView(
                      headerSliverBuilder: (_, __) => [
                        SliverAppBar(
                          backgroundColor: const Color(0xFF07111F),
                          foregroundColor: Colors.white,
                          automaticallyImplyLeading: false,
                          expandedHeight: 390,
                          pinned: true,
                          title: const Text(
                            'Shadow Live',
                            style: TextStyle(
                              color: Color(0xFFFFD54A),
                              fontWeight: FontWeight.w900,
                              letterSpacing: .4,
                            ),
                          ),
                          flexibleSpace: FlexibleSpaceBar(
                            background: _header(profile),
                          ),
                          actions: [
                            IconButton(
                              tooltip: _openingEdit
                                  ? 'جارٍ فتح التعديل'
                                  : 'تعديل الملف الشخصي',
                              icon: const Icon(Icons.edit_rounded),
                              onPressed:
                                  _loggingOut || _openingEdit ? null : _edit,
                            ),
                            IconButton(
                              tooltip: 'الإعدادات',
                              icon: const Icon(Icons.settings_rounded),
                              onPressed: _loggingOut
                                  ? null
                                  : () => Navigator.pushNamed(
                                        context,
                                        AppRoutes.settings,
                                      ),
                            ),
                          ],
                        ),
                        SliverPersistentHeader(
                          pinned: true,
                          delegate: _Delegate(
                            TabBar(
                              controller: _tabs,
                              labelColor: const Color(0xFFFFD54A),
                              unselectedLabelColor: Colors.white54,
                              tabs: const [
                                Tab(text: 'حول'),
                                Tab(text: 'الغرف'),
                                Tab(text: 'الهدايا'),
                              ],
                            ),
                          ),
                        ),
                      ],
                      body: TabBarView(
                        controller: _tabs,
                        children: [
                          _about(profile),
                          const Center(
                            child: Text(
                              'غرف المستخدم',
                              style: TextStyle(color: Colors.white54),
                            ),
                          ),
                          const Center(
                            child: Text(
                              'هدايا المستخدم',
                              style: TextStyle(color: Colors.white54),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }

  Widget _header(Map<String, dynamic> profile) {
    final image = _avatar(profile);
    final cover = _text(
      profile,
      'coverImageUrl',
      _text(profile, 'coverUrl', ''),
    );
    final name = _text(
      profile,
      'displayName',
      _text(profile, 'username', 'مستخدم Shadow Live'),
    );
    final id = _text(profile, 'publicId');
    final location = _text(
      profile,
      'location',
      _text(profile, 'country', ''),
    );
    final gender = _text(profile, 'gender', '');
    final bio = _text(profile, 'bio', '');

    return Container(
      decoration: BoxDecoration(
        gradient: cover.isEmpty
            ? const RadialGradient(
                center: Alignment(.65, -.65),
                radius: 1.35,
                colors: [
                  Color(0xFF381267),
                  Color(0xFF11152A),
                  Color(0xFF020711),
                ],
              )
            : null,
        image: cover.isNotEmpty
            ? DecorationImage(
                image: NetworkImage(cover),
                fit: BoxFit.cover,
                colorFilter: ColorFilter.mode(
                  Colors.black.withValues(alpha: .42),
                  BlendMode.darken,
                ),
              )
            : null,
      ),
      padding: const EdgeInsets.fromLTRB(18, 96, 18, 18),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          SizedBox(
            width: 116,
            height: 116,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    gradient: LinearGradient(
                      colors: [Color(0xFFFFC84A), Color(0xFF8A3DFF)],
                    ),
                  ),
                  child: CircleAvatar(
                    radius: 50,
                    backgroundColor: const Color(0xFF171D31),
                    backgroundImage: image,
                    child: image == null
                        ? const Icon(
                            Icons.person_rounded,
                            size: 56,
                            color: Colors.white54,
                          )
                        : null,
                  ),
                ),
                if (_activeFrame != null)
                  Positioned.fill(
                    child: IgnorePointer(
                      child: CosmeticAssetVisual(
                        assetKey: _activeFrame!.assetKey,
                        imageUrl: _activeFrame!.imageUrl,
                      ),
                    ),
                  ),
              ],
            ),
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
          const SizedBox(height: 7),
          Wrap(
            alignment: WrapAlignment.center,
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 8,
            runSpacing: 6,
            children: [
              InkWell(
                onTap: () => _copyId(profile),
                borderRadius: BorderRadius.circular(16),
                child: Padding(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'ID: $id',
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(
                          color: Color(0xFFFFD54A),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(width: 6),
                      const Icon(
                        Icons.copy_rounded,
                        size: 15,
                        color: Color(0xFFFFD54A),
                      ),
                    ],
                  ),
                ),
              ),
              if (location.isNotEmpty)
                Text(
                  location,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 12,
                  ),
                ),
              if (gender == 'ذكر' || gender == 'أنثى')
                Text(
                  gender == 'ذكر' ? '♂' : '♀',
                  style: TextStyle(
                    color: gender == 'ذكر'
                        ? const Color(0xFF42A5F5)
                        : const Color(0xFFFF69B4),
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
            ],
          ),
          if (bio.isNotEmpty) ...[
            const SizedBox(height: 7),
            Text(
              bio,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.white70,
                fontSize: 12,
                height: 1.4,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _balanceChip(
                Icons.monetization_on_rounded,
                '${formatCompactAmount(_num(profile, ['coins', 'balance']))} عملة',
                0,
              ),
              const SizedBox(width: 10),
              _balanceChip(
                Icons.diamond_rounded,
                '${formatCompactAmount(_num(profile, ['diamonds']))} ألماس',
                1,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _balanceChip(IconData icon, String text, int tab) {
    return InkWell(
      onTap: () => _recharge(tab),
      borderRadius: BorderRadius.circular(20),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: Colors.black.withValues(alpha: .38),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white24),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color: tab == 0
                  ? const Color(0xFFFFD54A)
                  : const Color(0xFF66E1FF),
              size: 18,
            ),
            const SizedBox(width: 6),
            Text(
              text,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(width: 5),
            const Icon(
              Icons.add_circle_rounded,
              color: Color(0xFF9A5CFF),
              size: 18,
            ),
          ],
        ),
      ),
    );
  }

  Widget _about(Map<String, dynamic> profile) {
    final followers = _num(profile, ['followersCount', 'followers']);
    final following = _num(profile, ['followingCount', 'following']);
    final rooms = _num(profile, ['roomsCount']);
    final gifts = _num(profile, ['giftsCount', 'totalGiftsReceived']);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
      children: [
        Container(
          padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 8),
          decoration: BoxDecoration(
            color: const Color(0xFF0C1728),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.white.withValues(alpha: .06)),
          ),
          child: Row(
            children: [
              Expanded(child: _stat(formatCompactAmount(followers), 'متابعون')),
              Expanded(child: _stat(formatCompactAmount(following), 'أتابع')),
              Expanded(child: _stat(formatCompactAmount(rooms), 'غرف')),
              Expanded(child: _stat(formatCompactAmount(gifts), 'هدايا')),
            ],
          ),
        ),
        const SizedBox(height: 14),
        Row(
          children: [
            Expanded(
              child: _action(
                Icons.edit_rounded,
                'تعديل الملف',
                _openingEdit ? null : _edit,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _action(
                Icons.add_card_rounded,
                'شحن',
                () => _recharge(0),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _action(
                Icons.settings_rounded,
                'الإعدادات',
                () => Navigator.pushNamed(context, AppRoutes.settings),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        _action(
          Icons.inventory_2_rounded,
          'مقتنياتي',
          () => unawaited(_openMyItems()),
        ),
        const SizedBox(height: 16),
        _card(
          'الملف الشخصي',
          [
            _row('ID', _text(profile, 'publicId')),
            _row(
              'الاسم الظاهر',
              _text(
                profile,
                'displayName',
                _text(profile, 'username'),
              ),
            ),
            _row(
              'الموقع',
              _text(
                profile,
                'location',
                _text(profile, 'country'),
              ),
            ),
            _row('نبذة', _text(profile, 'bio', 'لا توجد نبذة')),
          ],
        ),
        const SizedBox(height: 16),
        _card(
          'الرصيد',
          [
            _row(
              'العملات',
              formatCompactAmount(_num(profile, ['coins', 'balance'])),
            ),
            _row(
              'الألماس',
              formatCompactAmount(_num(profile, ['diamonds'])),
            ),
          ],
        ),
      ],
    );
  }

  Widget _stat(String value, String label) => Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white54,
              fontSize: 11,
            ),
          ),
        ],
      );

  Widget _action(
    IconData icon,
    String label,
    VoidCallback? onTap,
  ) =>
      Material(
        color: const Color(0xFF111321),
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(16),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 5),
            child: Column(
              children: [
                Icon(
                  icon,
                  color: const Color(0xFFFFD54A),
                  size: 23,
                ),
                const SizedBox(height: 6),
                FittedBox(
                  child: Text(
                    label,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w700,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );

  Widget _card(String title, List<Widget> children) => Card(
        color: const Color(0xFF0C1728),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                title,
                style: const TextStyle(
                  color: Color(0xFFFFD54A),
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      );

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          children: [
            Text(
              label,
              style: const TextStyle(color: Colors.white54),
            ),
            const Spacer(),
            Flexible(
              child: Text(
                value,
                textAlign: TextAlign.left,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      );
}

class _Delegate extends SliverPersistentHeaderDelegate {
  final TabBar bar;

  _Delegate(this.bar);

  @override
  double get minExtent => bar.preferredSize.height;

  @override
  double get maxExtent => bar.preferredSize.height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) =>
      Container(
        color: const Color(0xFF07111F),
        child: bar,
      );

  @override
  bool shouldRebuild(_Delegate oldDelegate) => false;
}
