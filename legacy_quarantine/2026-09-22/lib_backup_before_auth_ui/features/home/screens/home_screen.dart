import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../shared/widgets/custom_button.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../room/bloc/room_bloc.dart';
import '../../user/bloc/user_bloc.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({Key? key}) : super(key: key);

  @override
  _HomeScreenState createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;

  @override
  void initState() {
    super.initState();
    _loadInitialData();
  }

  void _loadInitialData() {
    // Load active rooms
    context.read<RoomBloc>().add(LoadRoomList());
  }

  void _handleCreateRoom() {
    // Navigate to create room screen
  }

  void _handleJoinRoom(String roomId) {
    // Join selected room
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Voice Chat Rooms'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () {
              // Show search dialog
            },
          ),
          IconButton(
            icon: const Icon(Icons.notifications_outlined),
            onPressed: () {
              // Navigate to notifications
            },
          ),
        ],
      ),
      body: IndexedStack(
        index: _selectedIndex,
        children: [
          _buildRoomList(),
          _buildPopularRooms(),
          _buildFollowingRooms(),
        ],
      ),
      bottomNavigationBar: BottomNavigationBar(
        currentIndex: _selectedIndex,
        onTap: (index) {
          setState(() {
            _selectedIndex = index;
          });
        },
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.home_outlined),
            activeIcon: Icon(Icons.home),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.trending_up_outlined),
            activeIcon: Icon(Icons.trending_up),
            label: 'Popular',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.favorite_outline),
            activeIcon: Icon(Icons.favorite),
            label: 'Following',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: _handleCreateRoom,
        child: const Icon(Icons.add),
      ),
    );
  }

  Widget _buildRoomList() {
    return BlocBuilder<RoomBloc, RoomState>(
      builder: (context, state) {
        if (state is RoomLoading) {
          return const LoadingIndicator();
        }

        if (state is RoomError) {
          return Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(state.message),
                const SizedBox(height: 16),
                CustomButton(
                  text: 'Retry',
                  onPressed: _loadInitialData,
                ),
              ],
            ),
          );
        }

        if (state is RoomListLoaded) {
          return RefreshIndicator(
            onRefresh: () async {
              _loadInitialData();
            },
            child: ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: state.rooms.length,
              itemBuilder: (context, index) {
                final room = state.rooms[index];
                return _buildRoomCard(room);
              },
            ),
          );
        }

        return const Center(
          child: Text('No rooms available'),
        );
      },
    );
  }

  Widget _buildRoomCard(Map<String, dynamic> room) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      child: InkWell(
        onTap: () => _handleJoinRoom(room['id']),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    backgroundImage: NetworkImage(room['hostAvatar'] ?? ''),
                    radius: 24,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          room['name'] ?? '',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.bold,
                              ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Hosted by ${room['hostName']}',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: Colors.grey,
                              ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  _buildStat(
                    Icons.people_outline,
                    '${room['participantCount'] ?? 0} Participants',
                  ),
                  const SizedBox(width: 16),
                  _buildStat(
                    Icons.favorite_outline,
                    '${room['followersCount'] ?? 0} Followers',
                  ),
                ],
              ),
              if (room['tags'] != null && (room['tags'] as List).isNotEmpty) ...[  
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: (room['tags'] as List).map((tag) {
                    return Chip(
                      label: Text(tag),
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    );
                  }).toList(),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildStat(IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.grey),
        const SizedBox(width: 4),
        Text(
          text,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Colors.grey,
              ),
        ),
      ],
    );
  }

  Widget _buildPopularRooms() {
    return const Center(
      child: Text('Popular Rooms'),
    );
  }

  Widget _buildFollowingRooms() {
    return const Center(
      child: Text('Following Rooms'),
    );
  }
}