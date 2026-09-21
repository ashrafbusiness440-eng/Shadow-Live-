import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

Future<void> showProfileGiftSheet(
  BuildContext context, {
  required String receiverUid,
  required String receiverName,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: const Color(0xFF0D101A),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
    ),
    builder: (_) => _ProfileGiftSheet(
      receiverUid: receiverUid,
      receiverName: receiverName,
    ),
  );
}

class _ProfileGiftSheet extends StatelessWidget {
  const _ProfileGiftSheet({
    required this.receiverUid,
    required this.receiverName,
  });

  final String receiverUid;
  final String receiverName;

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        child: SizedBox(
          height: MediaQuery.of(context).size.height * .72,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 10),
                child: Row(
                  children: [
                    const Icon(Icons.card_giftcard_rounded, color: Color(0xFFFFD54A)),
                    const SizedBox(width: 9),
                    Expanded(
                      child: Text(
                        'إرسال هدية إلى $receiverName',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close_rounded, color: Colors.white54),
                    ),
                  ],
                ),
              ),
              const Padding(
                padding: EdgeInsets.symmetric(horizontal: 18),
                child: Text(
                  'واجهة اختيار الهدايا جاهزة. الخصم الفعلي من العملات سيتم عبر Backend موثّق في مرحلة نظام الهدايا والعملات، وليس من تطبيق العميل.',
                  style: TextStyle(color: Colors.white54, height: 1.45),
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: FutureBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  future: FirebaseFirestore.instance
                      .collection('gifts')
                      .where('isActive', isEqualTo: true)
                      .limit(60)
                      .get(),
                  builder: (context, snapshot) {
                    if (snapshot.connectionState == ConnectionState.waiting) {
                      return const Center(
                        child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
                      );
                    }
                    final docs = [...?snapshot.data?.docs]
                      ..sort((a, b) {
                        final ap = (a.data()['price'] as num?)?.toInt() ?? 0;
                        final bp = (b.data()['price'] as num?)?.toInt() ?? 0;
                        return ap.compareTo(bp);
                      });
                    if (docs.isEmpty) {
                      return const Center(
                        child: Padding(
                          padding: EdgeInsets.all(24),
                          child: Text(
                            'لا توجد هدايا مفعّلة في المتجر حالياً.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.white54),
                          ),
                        ),
                      );
                    }
                    return GridView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 6, 16, 22),
                      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: 3,
                        childAspectRatio: .72,
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                      ),
                      itemCount: docs.length,
                      itemBuilder: (_, index) {
                        final doc = docs[index];
                        final data = doc.data();
                        final name = '\${data['name'] ?? data['title'] ?? 'هدية'}';
                        final price = (data['price'] as num?)?.toInt() ?? 0;
                        final imageUrl = '\${data['imageUrl'] ?? ''}';
                        return InkWell(
                          borderRadius: BorderRadius.circular(18),
                          onTap: () {
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  'تم اختيار $name. الإرسال المالي سيُفعّل عبر Backend الآمن في Phase 7.',
                                ),
                              ),
                            );
                          },
                          child: Container(
                            padding: const EdgeInsets.all(10),
                            decoration: BoxDecoration(
                              color: const Color(0xFF151925),
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(color: Colors.white10),
                            ),
                            child: Column(
                              children: [
                                Expanded(
                                  child: Center(
                                    child: imageUrl.isEmpty
                                        ? const Icon(
                                            Icons.card_giftcard_rounded,
                                            size: 42,
                                            color: Color(0xFFFFD54A),
                                          )
                                        : Image.network(
                                            imageUrl,
                                            fit: BoxFit.contain,
                                            errorBuilder: (_, __, ___) => const Icon(
                                              Icons.card_giftcard_rounded,
                                              size: 42,
                                              color: Color(0xFFFFD54A),
                                            ),
                                          ),
                                  ),
                                ),
                                Text(
                                  name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  '$price عملة',
                                  style: const TextStyle(
                                    color: Color(0xFFFFD54A),
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class PublicReceivedGiftsTab extends StatelessWidget {
  const PublicReceivedGiftsTab({super.key, required this.userId});

  final String userId;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
      stream: FirebaseFirestore.instance
          .collection('public_gifts')
          .doc(userId)
          .collection('items')
          .orderBy('sentAt', descending: true)
          .limit(100)
          .snapshots(),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const _GiftEmptyState(
            icon: Icons.error_outline_rounded,
            text: 'تعذر تحميل الهدايا الآن',
          );
        }
        if (!snapshot.hasData) {
          return const Center(
            child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
          );
        }
        final docs = snapshot.data!.docs;
        if (docs.isEmpty) {
          return const _GiftEmptyState(
            icon: Icons.card_giftcard_rounded,
            text: 'لا توجد هدايا ظاهرة في الملف بعد',
          );
        }
        return GridView.builder(
          padding: const EdgeInsets.all(16),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 3,
            childAspectRatio: .8,
            crossAxisSpacing: 10,
            mainAxisSpacing: 10,
          ),
          itemCount: docs.length,
          itemBuilder: (_, index) {
            final data = docs[index].data();
            final name = '\${data['giftName'] ?? 'هدية'}';
            final imageUrl = '\${data['imageUrl'] ?? ''}';
            final quantity = (data['quantity'] as num?)?.toInt() ?? 1;
            return Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: const Color(0xFF101522),
                borderRadius: BorderRadius.circular(18),
                border: Border.all(color: Colors.white10),
              ),
              child: Column(
                children: [
                  Expanded(
                    child: imageUrl.isEmpty
                        ? const Icon(
                            Icons.card_giftcard_rounded,
                            size: 38,
                            color: Color(0xFFFFD54A),
                          )
                        : Image.network(
                            imageUrl,
                            fit: BoxFit.contain,
                            errorBuilder: (_, __, ___) => const Icon(
                              Icons.card_giftcard_rounded,
                              size: 38,
                              color: Color(0xFFFFD54A),
                            ),
                          ),
                  ),
                  Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  if (quantity > 1)
                    Text(
                      '×$quantity',
                      style: const TextStyle(
                        color: Color(0xFFFFD54A),
                        fontSize: 12,
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
}

class _GiftEmptyState extends StatelessWidget {
  const _GiftEmptyState({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 50, color: Colors.white24),
          const SizedBox(height: 12),
          Text(
            text,
            style: const TextStyle(color: Colors.white54),
          ),
        ],
      ),
    );
  }
}
