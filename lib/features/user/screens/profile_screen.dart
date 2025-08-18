import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/user_bloc.dart';
import '../../auth/bloc/auth_bloc.dart';
import '../../../shared/widgets/custom_button.dart';
import '../../../shared/widgets/loading_indicator.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({Key? key}) : super(key: key);

  @override
  _ProfileScreenState createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabController;

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
    final userId = context.read<AuthBloc>().state.user?.uid;
    if (userId != null) {
      context.read<UserBloc>().add(LoadUserProfile(userId));
    }
  }

  void _handleEditProfile() {
    // Navigate to edit profile screen
  }

  void _handleSignOut() {
    context.read<AuthBloc>().add(SignOutRequested());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: BlocBuilder<UserBloc, UserState>(
        builder: (context, state) {
          if (state is UserLoading) {
            return const LoadingIndicator();
          }

          if (state is UserError) {
            return Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(state.message),
                  const SizedBox(height: 16),
                  CustomButton(
                    text: 'Retry',
                    onPressed: _loadUserProfile,
                  ),
                ],
              ),
            );
          }

          if (state is UserProfileLoaded) {
            return NestedScrollView(
              headerSliverBuilder: (context, innerBoxIsScrolled) {
                return [
                  SliverAppBar(
                    expandedHeight: 300,
                    pinned: true,
                    flexibleSpace: FlexibleSpaceBar(
                      background: _buildProfileHeader(state.profile),
                    ),
                    actions: [
                      IconButton(
                        icon: const Icon(Icons.edit),
                        onPressed: _handleEditProfile,
                      ),
                      IconButton(
                        icon: const Icon(Icons.settings),
                        onPressed: () {
                          // Navigate to settings
                        },
                      ),
                    ],
                  ),
                  SliverPersistentHeader(
                    delegate: _SliverAppBarDelegate(
                      TabBar(
                        controller: _tabController,
                        tabs: const [
                          Tab(text: 'About'),
                          Tab(text: 'Rooms'),
                          Tab(text: 'Gifts'),
                        ],
                      ),
                    ),
                    pinned: true,
                  ),
                ];
              },
              body: TabBarView(
                controller: _tabController,
                children: [
                  _buildAboutTab(state.profile),
                  _buildRoomsTab(),
                  _buildGiftsTab(),
                ],
              ),
            );
          }

          return const Center(
            child: Text('No profile data available'),
          );
        },
      ),
    );
  }

  Widget _buildProfileHeader(Map<String, dynamic> profile) {
    return Stack(
      children: [
        Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Theme.of(context).primaryColor,
                Theme.of(context).primaryColor.withOpacity(0.8),
              ],
            ),
          ),
        ),
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: Container(
            height: 100,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [
                  Colors.black.withOpacity(0.7),
                  Colors.transparent,
                ],
              ),
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.end,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 50,
                    backgroundImage:
                        NetworkImage(profile['avatarUrl'] ?? ''),
                    child: profile['avatarUrl'] == null
                        ? const Icon(Icons.person, size: 50)
                        : null,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          profile['username'] ?? '',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        if (profile['vipLevel'] != null) ...[  
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            decoration: BoxDecoration(
                              color: Colors.amber,
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              'VIP ${profile['vipLevel']}',
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _buildStat('Followers', profile['followers'] ?? 0),
                  _buildStat('Following', profile['following'] ?? 0),
                  _buildStat('Gifts Received', profile['totalGiftsReceived'] ?? 0),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStat(String label, int value) {
    return Column(
      children: [
        Text(
          value.toString(),
          style: const TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          label,
          style: const TextStyle(
            color: Colors.white70,
          ),
        ),
      ],
    );
  }

  Widget _buildAboutTab(Map<String, dynamic> profile) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildInfoCard(
          'Personal Information',
          [
            _buildInfoRow('Email', profile['email'] ?? ''),
            _buildInfoRow('Join Date',
                profile['createdAt']?.toString().split('T')[0] ?? ''),
            _buildInfoRow('Status', profile['isOnline'] == true
                ? 'Online'
                : 'Offline'),
          ],
        ),
        const SizedBox(height: 16),
        _buildInfoCard(
          'Statistics',
          [
            _buildInfoRow('Total Rooms Created',
                profile['totalRoomsCreated']?.toString() ?? '0'),
            _buildInfoRow('Total Gifts Sent',
                profile['totalGiftsSent']?.toString() ?? '0'),
            _buildInfoRow('Balance',
                '${profile['balance']?.toString() ?? '0'} coins'),
          ],
        ),
        const SizedBox(height: 24),
        CustomButton(
          text: 'Sign Out',
          onPressed: _handleSignOut,
          outlined: true,
        ),
      ],
    );
  }

  Widget _buildInfoCard(String title, List<Widget> children) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
            ),
            const SizedBox(height: 16),
            ...children,
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(color: Colors.grey),
          ),
          Text(value),
        ],
      ),
    );
  }

  Widget _buildRoomsTab() {
    return const Center(
      child: Text('Rooms tab content'),
    );
  }

  Widget _buildGiftsTab() {
    return const Center(
      child: Text('Gifts tab content'),
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
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Container(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: _tabBar,
    );
  }

  @override
  bool shouldRebuild(_SliverAppBarDelegate oldDelegate) {
    return false;
  }
}