import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/vip_service.dart';

class VipTrialCardsScreen extends StatefulWidget {
  const VipTrialCardsScreen({super.key});
  @override
  State<VipTrialCardsScreen> createState() => _VipTrialCardsScreenState();
}

class _VipTrialCardsScreenState extends State<VipTrialCardsScreen> {
  final VipService _vip = VipService();
  late Future<List<VipTrialCardItem>> _future;
  bool _gifting = false;

  @override
  void initState() {
    super.initState();
    _future = _vip.loadTrialCards();
  }

  @override
  void dispose() {
    _vip.close();
    super.dispose();
  }

  Future<void> _reload() async {
    setState(() => _future = _vip.loadTrialCards());
    await _future;
  }

  Future<void> _gift(VipTrialCardItem card) async {
    if (_gifting || !card.available) return;
    final controller = TextEditingController();
    final recipientId = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('إهداء بطاقة تجربة VIP5'),
          content: TextField(
            key: const Key('vip-trial-recipient-id'),
            controller: controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            maxLength: 8,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'Fancy ID أو Public ID',
              helperText: 'يجب أن يكون المستخدم صديقًا بمتابعة متبادلة.',
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                final value = controller.text.trim();
                if (value.length >= 3) Navigator.pop(dialogContext, value);
              },
              child: const Text('إهداء'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (recipientId == null || !mounted) return;

    setState(() => _gifting = true);
    try {
      final gift = await _vip.giftTrialCard(
        cardId: card.cardId,
        recipientId: recipientId,
      );
      if (!mounted) return;
      final expiry = DateTime.fromMillisecondsSinceEpoch(
        gift.trialVipExpiresAtMs,
      ).toLocal();
      final mm = expiry.month.toString().padLeft(2, '0');
      final dd = expiry.day.toString().padLeft(2, '0');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'تم إهداء VIP${gift.trialVipLevel} لمدة ${gift.durationDays} أيام. '
            'ينتهي ${expiry.year}/$mm/$dd.',
          ),
        ),
      );
      await _reload();
    } on StateError catch (error) {
      if (!mounted) return;
      final code = error.message.toString();
      final message = switch (code) {
        'friend_required' => 'الإهداء متاح للأصدقاء بمتابعة متبادلة فقط.',
        'trial_card_unavailable' => 'هذه البطاقة مستخدمة أو غير متاحة.',
        'user_id_not_found' => 'لم يتم العثور على هذا الـID.',
        'recipient_id_stale' => 'تغيّر هذا الـID. أعد إدخاله من جديد.',
        _ => 'تعذر إهداء البطاقة حاليًا.',
      };
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } finally {
      if (mounted) setState(() => _gifting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF050814),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0B1220),
          foregroundColor: Colors.white,
          title: const Text('بطاقات تجربة VIP', style: TextStyle(fontWeight: FontWeight.w900)),
        ),
        body: RefreshIndicator(
          onRefresh: _reload,
          child: FutureBuilder<List<VipTrialCardItem>>(
            future: _future,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Center(child: CircularProgressIndicator());
              }
              if (snapshot.hasError) {
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  children: const [
                    SizedBox(height: 180),
                    Center(child: Text('تعذر تحميل البطاقات.', style: TextStyle(color: Colors.white54))),
                  ],
                );
              }
              final items = snapshot.data ?? const <VipTrialCardItem>[];
              if (items.isEmpty) {
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(24),
                  children: const [
                    SizedBox(height: 110),
                    Icon(Icons.card_giftcard_rounded, size: 58, color: Color(0xFFFFD166)),
                    SizedBox(height: 14),
                    Text('لا توجد بطاقات تجربة حاليًا.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
                    SizedBox(height: 8),
                    Text('عند إكمال المحافظة على VIP10 تحصل على 3 بطاقات VIP5، مدة كل بطاقة 7 أيام.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white54, height: 1.5)),
                  ],
                );
              }
              return ListView.separated(
                padding: const EdgeInsets.fromLTRB(14, 16, 14, 32),
                itemCount: items.length,
                separatorBuilder: (_, __) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final card = items[index];
                  return Container(
                    key: Key('vip-trial-card-${card.cardId}'),
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: const Color(0xFF101827),
                      borderRadius: BorderRadius.circular(18),
                      border: Border.all(color: card.available ? const Color(0x55FFD166) : Colors.white12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.workspace_premium_rounded, color: Color(0xFFFFD166), size: 38),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('تجربة VIP${card.trialVipLevel}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900)),
                              const SizedBox(height: 4),
                              Text('${card.durationDays} أيام • ${card.available ? 'متاحة للإهداء' : 'مستخدمة'}', style: const TextStyle(color: Colors.white54)),
                            ],
                          ),
                        ),
                        if (card.available)
                          FilledButton(onPressed: _gifting ? null : () => _gift(card), child: const Text('إهداء'))
                        else
                          const Icon(Icons.check_circle_rounded, color: Colors.white30),
                      ],
                    ),
                  );
                },
              );
            },
          ),
        ),
      ),
    );
  }
}