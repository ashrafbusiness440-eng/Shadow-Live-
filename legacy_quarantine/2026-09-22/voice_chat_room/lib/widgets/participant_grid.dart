import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

class ParticipantGrid extends StatelessWidget {
  const ParticipantGrid({super.key});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 16,
        mainAxisSpacing: 24,
      ),
      itemCount: 12,
      itemBuilder: (context, index) {
        return ParticipantAvatar(
          name: 'Jaquiline',
          imageUrl: 'https://example.com/avatar$index.jpg',
          stars: index * 100,
          showBadge: index == 3,
          isHighlighted: index == 6,
        );
      },
    );
  }
}

class ParticipantAvatar extends StatelessWidget {
  final String name;
  final String imageUrl;
  final int stars;
  final bool showBadge;
  final bool isHighlighted;

  const ParticipantAvatar({
    super.key,
    required this.name,
    required this.imageUrl,
    required this.stars,
    this.showBadge = false,
    this.isHighlighted = false,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Stack(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: isHighlighted
                    ? Border.all(
                        color: Colors.yellow[400]!,
                        width: 2,
                      )
                    : null,
              ),
              child: ClipOval(
                child: CachedNetworkImage(
                  imageUrl: imageUrl,
                  fit: BoxFit.cover,
                  placeholder: (context, url) => const CircularProgressIndicator(),
                  errorWidget: (context, url, error) => const Icon(Icons.error),
                ),
              ),
            ),
            if (showBadge)
              Positioned(
                top: -4,
                right: -4,
                child: Container(
                  padding: const EdgeInsets.all(4),
                  decoration: const BoxDecoration(
                    color: Colors.red,
                    shape: BoxShape.circle,
                  ),
                  child: const Text(
                    '1',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 8),
        Text(
          name,
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w500,
          ),
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.star,
              color: Colors.yellow[400],
              size: 16,
            ),
            const SizedBox(width: 4),
            Text(
              stars.toString(),
              style: const TextStyle(
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