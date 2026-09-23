import 'package:flutter/material.dart';

class NotificationsSection extends StatelessWidget {
  const NotificationsSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Positioned(
      bottom: 96,
      left: 16,
      right: 16,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildNotification(
            text: 'The broadcaster invites you to join a PK',
            textColor: Colors.purple[400]!,
            backgroundColor: Colors.purple[900]!.withOpacity(0.5),
            showChevron: true,
          ),
          const SizedBox(height: 8),
          _buildNotification(
            text: 'Ankush joined the LIVE',
            username: 'Ankush',
            usernameColor: Colors.green[400]!,
            backgroundColor: Colors.black.withOpacity(0.5),
          ),
          const SizedBox(height: 8),
          _buildNotification(
            text: 'The broadcaster invites you to join a PK',
            textColor: Colors.purple[400]!,
            backgroundColor: Colors.purple[900]!.withOpacity(0.5),
            showChevron: true,
          ),
          const SizedBox(height: 8),
          _buildNotification(
            text: 'Sumit joined the LIVE',
            username: 'Sumit',
            usernameColor: Colors.green[400]!,
            backgroundColor: Colors.black.withOpacity(0.5),
          ),
        ],
      ),
    );
  }

  Widget _buildNotification({
    required String text,
    String? username,
    Color? usernameColor,
    Color backgroundColor = Colors.black,
    Color textColor = Colors.white,
    bool showChevron = false,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (username != null) ...[            
            Text(
              username,
              style: TextStyle(
                color: usernameColor,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(width: 4),
          ],
          Text(
            username != null ? text : text,
            style: TextStyle(
              color: username != null ? Colors.grey[300] : textColor,
              fontSize: 12,
              fontWeight: username != null ? FontWeight.normal : FontWeight.bold,
            ),
          ),
          if (showChevron) ...[            
            const SizedBox(width: 4),
            const Icon(
              Icons.chevron_right,
              size: 16,
            ),
          ],
        ],
      ),
    );
  }
}