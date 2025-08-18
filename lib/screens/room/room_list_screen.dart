import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../services/navigation_service.dart';
import '../../widgets/bottom_nav_bar.dart';

class RoomListScreen extends StatelessWidget {
  const RoomListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        title: const Text('Discover Rooms'),
        actions: [
          IconButton(
            icon: const Icon(Icons.search),
            onPressed: () => NavigationService.navigateTo(AppRoutes.createRoom),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () {},
        backgroundColor: Colors.yellow[700],
        child: const Icon(Icons.add, color: Colors.black),
      ),
      bottomNavigationBar: const BottomNavBar(currentIndex: 0),
      body: Column(
        children: [
          // Categories
          SizedBox(
            height: 50,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _buildCategoryChip('All', true),
                _buildCategoryChip('Music', false),
                _buildCategoryChip('Chat', false),
                _buildCategoryChip('Gaming', false),
                _buildCategoryChip('Education', false),
              ],
            ),
          ),
          const SizedBox(height: 16),
          // Room List
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              itemCount: 10, // Replace with actual room count
              itemBuilder: (context, index) => _buildRoomCard(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryChip(String label, bool isSelected) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (selected) {},
        backgroundColor: Colors.grey[800],
        selectedColor: Colors.yellow[700],
        labelStyle: TextStyle(
          color: isSelected ? Colors.black : Colors.white,
        ),
      ),
    );
  }

  Widget _buildRoomCard() {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      color: Colors.grey[900],
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(
                  radius: 24,
                  backgroundImage: CachedNetworkImageProvider(
                    'https://example.com/host.jpg',
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Music & Chill 🎵',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Hosted by Sarah',
                        style: TextStyle(color: Colors.grey[400]),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.red[400],
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: const Text(
                        'LIVE',
                        style: TextStyle(fontSize: 12),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '2.5K listening',
                      style: TextStyle(color: Colors.grey[400], fontSize: 12),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(
              'Join us for some relaxing music and great conversation! 🎵✨',
              style: TextStyle(color: Colors.grey[300]),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.grey[800],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.music_note, size: 16),
                      SizedBox(width: 4),
                      Text('Music'),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.grey[800],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.people, size: 16),
                      SizedBox(width: 4),
                      Text('Social'),
                    ],
                  ),
                ),
                const Spacer(),
                ElevatedButton(
                  onPressed: () => NavigationService.navigateTo(AppRoutes.voiceChatRoom),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.yellow[700],
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text(
                    'Join Room',
                    style: TextStyle(color: Colors.black),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}