import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/room_bloc.dart';
import '../../gift/bloc/gift_bloc.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/custom_button.dart';

class RoomScreen extends StatefulWidget {
  final String roomId;
  final bool isHost;

  const RoomScreen({
    Key? key,
    required this.roomId,
    this.isHost = false,
  }) : super(key: key);

  @override
  _RoomScreenState createState() => _RoomScreenState();
}

class _RoomScreenState extends State<RoomScreen> {
  bool _isMicMuted = true;
  bool _isGiftPanelOpen = false;

  @override
  void initState() {
    super.initState();
    _joinRoom();
  }

  void _joinRoom() {
    final userId = context.read<AuthBloc>().state.user?.uid;
    if (userId != null) {
      context.read<RoomBloc>().add(
            JoinRoomRequested(
              widget.roomId,
              userId,
              asHost: widget.isHost,
            ),
          );
    }
  }

  void _handleLeaveRoom() {
    context.read<RoomBloc>().add(LeaveRoomRequested());
    Navigator.of(context).pop();
  }

  void _toggleMic() {
    setState(() {
      _isMicMuted = !_isMicMuted;
    });
    context.read<RoomBloc>().add(ToggleMicRequested(!_isMicMuted));
  }

  void _toggleGiftPanel() {
    setState(() {
      _isGiftPanelOpen = !_isGiftPanelOpen;
    });
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      onWillPop: () async {
        _handleLeaveRoom();
        return false;
      },
      child: Scaffold(
        body: BlocBuilder<RoomBloc, RoomState>(
          builder: (context, state) {
            if (state is RoomLoading) {
              return const LoadingIndicator(message: 'Joining room...');
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
                      onPressed: _joinRoom,
                    ),
                  ],
                ),
              );
            }

            if (state is RoomJoined) {
              return Stack(
                children: [
                  Column(
                    children: [
                      _buildTopBar(state),
                      Expanded(
                        child: _buildParticipantsGrid(state),
                      ),
                      _buildBottomControls(),
                    ],
                  ),
                  if (_isGiftPanelOpen) _buildGiftPanel(),
                ],
              );
            }

            return const Center(
              child: Text('Connecting to room...'),
            );
          },
        ),
      ),
    );
  }

  Widget _buildTopBar(RoomJoined state) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 48, 16, 16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            Colors.black.withOpacity(0.7),
            Colors.transparent,
          ],
        ),
      ),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back),
            color: Colors.white,
            onPressed: _handleLeaveRoom,
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  state.roomData['name'] ?? 'Voice Chat Room',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  '${state.participants.length} participants',
                  style: const TextStyle(
                    color: Colors.white70,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.more_vert),
            color: Colors.white,
            onPressed: () {
              // Show room menu
            },
          ),
        ],
      ),
    );
  }

  Widget _buildParticipantsGrid(RoomJoined state) {
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 16,
        mainAxisSpacing: 16,
        childAspectRatio: 0.75,
      ),
      itemCount: state.participants.length,
      itemBuilder: (context, index) {
        final participant = state.participants[index];
        return _buildParticipantCard(participant);
      },
    );
  }

  Widget _buildParticipantCard(int uid) {
    return Card(
      child: Column(
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                Container(
                  decoration: BoxDecoration(
                    color: Colors.grey[300],
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.person,
                    size: 48,
                    color: Colors.grey,
                  ),
                ),
                Positioned(
                  bottom: 8,
                  right: 8,
                  child: Container(
                    padding: const EdgeInsets.all(4),
                    decoration: BoxDecoration(
                      color: _isMicMuted ? Colors.red : Colors.green,
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      _isMicMuted ? Icons.mic_off : Icons.mic,
                      size: 16,
                      color: Colors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Column(
              children: [
                Text(
                  'User $uid',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const Text(
                  'Participant',
                  style: TextStyle(
                    color: Colors.grey,
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomControls() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).scaffoldBackgroundColor,
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 4,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceEvenly,
          children: [
            _buildControlButton(
              icon: _isMicMuted ? Icons.mic_off : Icons.mic,
              label: _isMicMuted ? 'Unmute' : 'Mute',
              onPressed: _toggleMic,
            ),
            _buildControlButton(
              icon: Icons.card_giftcard,
              label: 'Gifts',
              onPressed: _toggleGiftPanel,
            ),
            _buildControlButton(
              icon: Icons.chat_bubble_outline,
              label: 'Chat',
              onPressed: () {
                // Open chat panel
              },
            ),
            _buildControlButton(
              icon: Icons.exit_to_app,
              label: 'Leave',
              onPressed: _handleLeaveRoom,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildControlButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
  }) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        IconButton(
          icon: Icon(icon),
          onPressed: onPressed,
          color: Theme.of(context).primaryColor,
        ),
        Text(
          label,
          style: const TextStyle(fontSize: 12),
        ),
      ],
    );
  }

  Widget _buildGiftPanel() {
    return BlocBuilder<GiftBloc, GiftState>(
      builder: (context, state) {
        return DraggableScrollableSheet(
          initialChildSize: 0.5,
          minChildSize: 0.2,
          maxChildSize: 0.8,
          builder: (context, scrollController) {
            return Container(
              decoration: BoxDecoration(
                color: Theme.of(context).scaffoldBackgroundColor,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(20),
                ),
              ),
              child: Column(
                children: [
                  Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      color: Colors.grey[300],
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Expanded(
                    child: state is GiftListLoaded
                        ? GridView.builder(
                            controller: scrollController,
                            padding: const EdgeInsets.all(16),
                            gridDelegate:
                                const SliverGridDelegateWithFixedCrossAxisCount(
                              crossAxisCount: 4,
                              crossAxisSpacing: 16,
                              mainAxisSpacing: 16,
                            ),
                            itemCount: state.gifts.length,
                            itemBuilder: (context, index) {
                              final gift = state.gifts[index];
                              return _buildGiftItem(gift);
                            },
                          )
                        : const Center(
                            child: CircularProgressIndicator(),
                          ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildGiftItem(Map<String, dynamic> gift) {
    return InkWell(
      onTap: () {
        // Handle gift selection
      },
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Image.network(
            gift['imageUrl'] ?? '',
            width: 48,
            height: 48,
            errorBuilder: (context, error, stackTrace) {
              return const Icon(
                Icons.card_giftcard,
                size: 48,
                color: Colors.grey,
              );
            },
          ),
          const SizedBox(height: 4),
          Text(
            gift['name'] ?? '',
            style: const TextStyle(fontSize: 12),
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Text(
            '${gift['price'] ?? 0} coins',
            style: const TextStyle(
              fontSize: 10,
              color: Colors.grey,
            ),
          ),
        ],
      ),
    );
  }
}