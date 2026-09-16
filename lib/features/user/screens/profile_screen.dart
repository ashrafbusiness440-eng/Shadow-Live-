import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/user_bloc.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../../shared/widgets/custom_button.dart';
import '../../../shared/widgets/loading_indicator.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
    _loadUserProfile();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  void _loadUserProfile() {
    final authState = context.read<AuthBloc>().state;
    final userId = authState is Authenticated ? authState.user.uid : null;
    if (userId != null) {
      context.read<UserBloc>().add(LoadUserProfile(userId));
    }
  }

  void _handleEditProfile() {
    Navigator.of(context).pushNamed('/profile-setup');
  }

  void _handleSignOut() {
    context.read<AuthBloc>().add(SignOutRequested());
  }

  String _text(Map<String, dynamic> profile, String key,
      [String fallback = '—']) {
    final value = profile[key];
    if (value == null || value.toString().trim().isEmpty) return fallback;
    return value.toString();
  }

  int _number(Map<String, dynamic> profile, List<String> keys) {
    for (final key in keys) {
      final value = profile[key];
      if (value is num) return value.toInt();
      final parsed = int.tryParse(value?.toString() ?? '');
      if (parsed != null) return parsed;
    }
    return 0;
  }

  ImageProvider? _profileImage(Map<String, dynamic> profile) {
    final url = profile['profileImageUrl'] ?? profile['avatarUrl'];
    if (url is String && url.isNotEmpty) return NetworkImage(url);
    final asset = profile['profileAvatarAsset'];
    if (asset is String && asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF020711),
        body: BlocBuilder<UserBloc, UserState>(
          builder: (context, state) {
            if (state is UserLoading) return const LoadingIndicator();

            if (state is UserError) {
              return Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('تعذر تحميل الملف الشخصي'),
                    const SizedBox(height: 16),
                    CustomButton(text: 'إعادة المحاولة', onPressed: _loadUserProfile),
                  ],
                ),
              );
            }

            final profile = state is UserProfileLoaded
                ? state.profile
                : state is UserProfileUpdated
                    ? state.profile
                    : null;

            if (profile == null) {
              return const Center(child: Text('لا توجد بيانات للملف الشخصي'));
            }

            return NestedScrollView(
              headerSliverBuilder: (context, innerBoxIsScrolled) => [
                SliverAppBar(
                  backgroundColor: const Color(0xFF07111F),
                  leading: IconButton(
                    icon: const Icon(Icons.arrow_forward_ios_rounded),
                    onPressed: () => Navigator.of(context).maybePop(),
                  ),
                  expandedHeight: 330,
                  pinned: true,
                  flexibleSpace: FlexibleSpaceBar(
                    background: _buildProfileHeader(profile),
                  ),
                  actions: [
                    IconButton(
                      tooltip: 'تعديل الملف الشخصي',
                      icon: const Icon(Icons.edit_rounded),
                      onPressed: _handleEditProfile,
                    ),
                    IconButton(
                      tooltip: 'الإعدادات',
                      icon: const Icon(Icons.settings_rounded),
                      onPressed: () => Navigator.of(context).pushNamed('/settings'),
                    ),
                  ],
                ),
                SliverPersistentHeader(
                  pinned: true,
                  delegate: _SliverAppBarDelegate(
                    TabBar(
                      controller: _tabController,
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
                controller: _tabController,
                children: [
                  _buildAboutTab(profile),
                  const Center(child: Text('الغرف')),
                  const Center(child: Text('الهدايا')),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildProfileHeader(Map<String, dynamic> profile) {
    final image = _profileImage(profile);
    final displayName = _text(profile, 'displayName', _text(profile, 'username'));
    final username = _text(profile, 'username');
    final publicId = _text(profile, 'publicId');
    final coins = _number(profile, ['coins', 'balance']);
    final diamonds = _number(profile, ['diamonds']);

    return Container(
      decoration: const BoxDecoration(
        gradient: RadialGradient(
          center: Alignment(0.6, -0.5),
          radius: 1.3,
          colors: [Color(0xFF251044), Color(0xFF07111F), Color(0xFF020711)],
        ),
      ),
      padding: const EdgeInsets.fromLTRB(20, 80, 20, 20),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          CircleAvatar(
            radius: 52,
            backgroundColor: const Color(0xFF171D31),
            backgroundImage: image,
            child: image == null
                ? const Icon(Icons.person_rounded, size: 58, color: Colors.white54)
                : null,
          ),
          const SizedBox(height: 12),
          Text(displayName,
              style: const TextStyle(
                  color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
          const SizedBox(height: 4),
          Text('@$username', style: const TextStyle(color: Colors.white60)),
          const SizedBox(height: 6),
          Text('ID: $publicId',
              textDirection: TextDirection.ltr,
              style: const TextStyle(
                  color: Color(0xFFFFD54A), fontWeight: FontWeight.w800)),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              _balanceChip(Icons.monetization_on_rounded, '$coins عملة'),
              const SizedBox(width: 10),
              _balanceChip(Icons.diamond_rounded, '$diamonds ألماس'),
            ],
          ),
        ],
      ),
    );
  }

  Widget _balanceChip(IconData icon, String text) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.07),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white12),
      ),
      child: Row(children: [
        Icon(icon, color: const Color(0xFFFFD54A), size: 18),
        const SizedBox(width: 6),
        Text(text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ]),
    );
  }

  Widget _buildAboutTab(Map<String, dynamic> profile) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _infoCard('الملف الشخصي', [
          _infoRow('ID', _text(profile, 'publicId')),
          _infoRow('الاسم الظاهر', _text(profile, 'displayName')),
          _infoRow('اسم المستخدم', _text(profile, 'username')),
          _infoRow('الموقع', _text(profile, 'location')),
          _infoRow('نبذة', _text(profile, 'bio', 'لا توجد نبذة')),
        ]),
        const SizedBox(height: 16),
        _infoCard('الرصيد', [
          _infoRow('العملات', _number(profile, ['coins', 'balance']).toString()),
          _infoRow('الألماس', _number(profile, ['diamonds']).toString()),
        ]),
        const SizedBox(height: 24),
        CustomButton(text: 'تسجيل الخروج', onPressed: _handleSignOut, isOutlined: true),
      ],
    );
  }

  Widget _infoCard(String title, List<Widget> children) {
    return Card(
      color: const Color(0xFF0C1728),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title,
                style: const TextStyle(
                    color: Color(0xFFFFD54A), fontSize: 17, fontWeight: FontWeight.w900)),
            const SizedBox(height: 14),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: Colors.white54)),
          const Spacer(),
          Flexible(
            child: Text(value,
                textAlign: TextAlign.left,
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );
  }
}

class _SliverAppBarDelegate extends SliverPersistentHeaderDelegate {
  final TabBar _tabBar;
  _SliverAppBarDelegate(this._tabBar);

  @override
  double get minExtent => _tabBar.preferredSize.height;
  @override
  double get maxExtent => _tabBar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Container(color: const Color(0xFF07111F), child: _tabBar);
  }

  @override
  bool shouldRebuild(_SliverAppBarDelegate oldDelegate) => false;
}
