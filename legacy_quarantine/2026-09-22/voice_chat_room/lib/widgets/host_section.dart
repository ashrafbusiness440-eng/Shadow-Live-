import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

class HostSection extends StatelessWidget {
  const HostSection({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Stack(
          alignment: Alignment.bottomCenter,
          children: [
            Container(
              width: 96,
              height: 96,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.yellow[400]!,
                  width: 4,
                ),
              ),
              child: ClipOval(
                child: CachedNetworkImage(
                  imageUrl: 'https://example.com/host.jpg',
                  fit: BoxFit.cover,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              decoration: BoxDecoration(
                color: Colors.black.withOpacity(0.7),
                borderRadius: BorderRadius.circular(20),
              ),
              child: const Text(
                'Host',
                style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        const Text(
          'Salama Hykes',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.whatshot,
              color: Colors.red[500],
              size: 16,
            ),
            const SizedBox(width: 4),
            const Text(
              '600',
              style: TextStyle(
                color: Colors.grey,
                fontSize: 12,
              ),
            ),
          ],
        ),
      ],
    );
  }
}