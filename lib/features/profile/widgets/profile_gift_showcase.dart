import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../../core/assets/shadow_asset_registry.dart';

/// The existing public gift showcase, shared by public and own profiles.
///
/// This is intentionally NOT the wallet ledger or a complete gift history:
/// only items the gift backend published in public_gift_showcases are shown.
/// One bounded Firestore listener per visible showcase; no per-gift lookups.
class ProfileGiftShowcase extends StatefulWidget {
  const ProfileGiftShowcase({
    super.key,
    required this.userId,
  });

  final String userId;

  @override
  State<ProfileGiftShowcase> createState() => _ProfileGiftShowcaseState();
}

class _ProfileGiftShowcaseState extends State<ProfileGiftShowcase> {
  late Stream<QuerySnapshot<Map<String, dynamic>>> _itemsStream;

  @override
  void initState() {
    super.initState();
    _bind();
  }

  @override
  void didUpdateWidget(covariant ProfileGiftShowcase oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.userId != widget.userId) _bind();
  }

  void _bind() {
    // Same collection, order and 60-item cap used by the former public tab.
    _itemsStream = FirebaseFirestore.instance
        .collection('public_gift_showcases')
        .doc(widget.userId)
        .collection('items')
        .orderBy('updatedAt', descending: true)
        .limit(60)
        .snapshots();
  }

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      // Clear the old stream snapshot if a different account is displayed.
      // A reused profile route must never briefly show the prior user's gifts.
      key: ValueKey<String>(widget.userId),
      stream: _itemsStream,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const _ShowcaseMessage(
            icon: Icons.wifi_off_rounded,
            title: 'تعذر عرض الهدايا الآن',
            description: 'تحقق من اتصال الإنترنت وأعد فتح تبويب الهدايا.',
          );
        }
        if (!snapshot.hasData) {
          return const Center(
            child: CircularProgressIndicator(color: Color(0xFFFFD54A)),
          );
        }
        final docs = snapshot.data!.docs;
        if (docs.isEmpty) {
          return const _ShowcaseMessage(
            icon: Icons.card_giftcard_rounded,
            title: 'لا توجد هدايا معروضة بعد',
            description: 'هنا تظهر الهدايا العامة فقط، وليس سجل محفظتك الخاص.',
          );
        }
        return LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth < 350
                ? 2
                : constraints.maxWidth >= 700
                    ? 4
                    : 3;
            return GridView.builder(
              key: const Key('profile-public-gift-grid'),
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: columns,
                crossAxisSpacing: 10,
                mainAxisSpacing: 10,
                childAspectRatio: .78,
              ),
              itemCount: docs.length,
              itemBuilder: (context, index) {
                return _GiftTile(data: docs[index].data());
              },
            );
          },
        );
      },
    );
  }
}

class _ShowcaseMessage extends StatelessWidget {
  const _ShowcaseMessage({
    required this.icon,
    required this.title,
    required this.description,
  });

  final IconData icon;
  final String title;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(18),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 420),
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 28),
          decoration: BoxDecoration(
            color: const Color(0xFF101522),
            borderRadius: BorderRadius.circular(22),
            border: Border.all(color: const Color(0x44FFD54A)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, color: const Color(0xFFFFD54A), size: 42),
              const SizedBox(height: 12),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                description,
                textAlign: TextAlign.center,
                style: const TextStyle(color: Colors.white60, height: 1.5),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _GiftTile extends StatelessWidget {
  const _GiftTile({required this.data});
  final Map<String, dynamic> data;

  @override
  Widget build(BuildContext context) {
    final name = (data['name'] ?? data['giftName'] ?? 'هدية').toString();
    final rawCount = data['count'];
    final count = rawCount is num ? rawCount.toInt() : 1;
    final imageUrl = (data['imageUrl'] ?? '').toString().trim();
    final assetKey = (data['assetKey'] ?? '').toString().trim();

    Widget fallback() => const Icon(
          Icons.card_giftcard_rounded,
          color: Color(0xFFFFD54A),
          size: 42,
        );

    Widget image;
    if (imageUrl.isNotEmpty) {
      image = Image.network(
        imageUrl,
        fit: BoxFit.contain,
        errorBuilder: (_, __, ___) => fallback(),
      );
    } else if (assetKey.isNotEmpty) {
      image = FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(assetKey),
        builder: (context, snapshot) {
          final url = snapshot.data;
          return url == null
              ? fallback()
              : Image.network(
                  url.toString(),
                  fit: BoxFit.contain,
                  errorBuilder: (_, __, ___) => fallback(),
                );
        },
      );
    } else {
      image = fallback();
    }

    return Container(
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: const Color(0xFF101522),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          Expanded(child: Center(child: image)),
          const SizedBox(height: 6),
          Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            '×${count < 0 ? 0 : count}',
            style: const TextStyle(
              color: Color(0xFFFFD54A),
              fontWeight: FontWeight.w900,
            ),
          ),
        ],
      ),
    );
  }
}
