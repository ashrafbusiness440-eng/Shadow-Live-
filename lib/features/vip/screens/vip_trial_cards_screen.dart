import 'package:flutter/material.dart';

import '../services/vip_fancy_id_service.dart';
import '../services/vip_service.dart';

class VipTrialCardsScreen extends StatefulWidget {
  const VipTrialCardsScreen({super.key});

  @override
  State<VipTrialCardsScreen> createState() => _VipTrialCardsScreenState();
}

class _VipTrialCardsScreenState extends State<VipTrialCardsScreen> {
  final VipService _vip = VipService();
  final VipFancyIdService _ids = VipFancyIdService();

  List<VipTrialCard> _cards = const [];
  bool _loading = true;
  String? _error;
  String _busyCardId = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _vip.close();
    _ids.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final cards = await _vip.listTrialCards();
      if (!mounted) return;
      setState(() {
        _cards = cards;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = error.toString();
      });
    }
  }

  Future<void> _redeem(VipTrialCard card) async {
    if (_busyCardId.isNotEmpty) return;
    final confirm = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('استخدام بطاقة التجربة'),
          content: Text(
            'سيتم تفعيل VIP${card.vipLevel} لمدة ${card.durationDays} أيام. هل تريد المتابعة؟',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('استخدام'),
            ),
          ],
        ),
      ),
    );
    if (confirm != true) return;

    setState(() => _busyCardId = card.cardId);
    try {
      final result = await _vip.redeemTrialCard(card.cardId);
      if (!mounted) return;
      _message(
        'تم تفعيل VIP${result.trialVipLevel} لمدة ${card.durationDays} أيام.',
      );
      await _load();
    } catch (error) {
      if (!mounted) return;
      _message(_friendlyError(error.toString()));
    } finally {
      if (mounted) setState(() => _busyCardId = '');
    }
  }

  Future<void> _gift(VipTrialCard card) async {
    if (_busyCardId.isNotEmpty) return;
    final controller = TextEditingController();
    final enteredId = await showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          title: const Text('إهداء بطاقة تجربة'),
          content: TextField(
            key: const Key('vip-trial-card-recipient-id'),
            controller: controller,
            keyboardType: TextInputType.number,
            textDirection: TextDirection.ltr,
            decoration: const InputDecoration(
              labelText: 'Public ID أو Fancy ID للصديق',
              hintText: 'مثال: 12345678',
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
                if (value.isNotEmpty) Navigator.pop(dialogContext, value);
              },
              child: const Text('إهداء'),
            ),
          ],
        ),
      ),
    );
    controller.dispose();
    if (enteredId == null || enteredId.trim().isEmpty) return;

    setState(() => _busyCardId = card.cardId);
    try {
      final resolved = await _ids.resolve(enteredId);
      await _vip.giftTrialCard(
        cardId: card.cardId,
        recipientUid: resolved.uid,
      );
      if (!mounted) return;
      _message('تم إهداء البطاقة للصديق.');
      await _load();
    } catch (error) {
      if (!mounted) return;
      _message(_friendlyError(error.toString()));
    } finally {
      if (mounted) setState(() => _busyCardId = '');
    }
  }

  String _friendlyError(String raw) {
    if (raw.contains('mutual_follow_required')) {
      return 'الإهداء متاح فقط بين الأصدقاء بمتابعة متبادلة.';
    }
    if (raw.contains('trial_card_unavailable')) {
      return 'هذه البطاقة لم تعد متاحة.';
    }
    if (raw.contains('user_id_not_found')) {
      return 'لم يتم العثور على المستخدم بهذا ID.';
    }
    return 'تعذر تنفيذ العملية حاليًا.';
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
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
          title: const Text(
            'بطاقات تجربة VIP',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          actions: [
            IconButton(
              onPressed: _loading ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: FilledButton.icon(
          onPressed: _load,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('إعادة المحاولة'),
        ),
      );
    }
    if (_cards.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(28),
          child: Text(
            'لا توجد بطاقات تجربة متاحة حاليًا.\nVIP10 يحصل على 3 بطاقات VIP5 × 7 أيام عند إكمال المحافظة على المستوى.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white60, height: 1.6),
          ),
        ),
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
      itemCount: _cards.length,
      separatorBuilder: (_, __) => const SizedBox(height: 12),
      itemBuilder: (context, index) {
        final card = _cards[index];
        final busy = _busyCardId == card.cardId;
        return Container(
          key: Key('vip-trial-card-${card.cardId}'),
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [Color(0xFF3B2109), Color(0xFF121726)],
            ),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: const Color(0x88FFD166)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.card_membership_rounded,
                    color: Color(0xFFFFD166),
                    size: 34,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'تجربة VIP${card.vipLevel}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          '${card.durationDays} أيام • بطاقة قابلة للإهداء',
                          style: const TextStyle(color: Colors.white54),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(
                    child: FilledButton.icon(
                      key: Key('vip-trial-card-use-${card.cardId}'),
                      onPressed: busy ? null : () => _redeem(card),
                      icon: const Icon(Icons.play_circle_outline_rounded),
                      label: const Text('استخدام'),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: OutlinedButton.icon(
                      key: Key('vip-trial-card-gift-${card.cardId}'),
                      onPressed: busy ? null : () => _gift(card),
                      icon: const Icon(Icons.card_giftcard_rounded),
                      label: const Text('إهداء'),
                    ),
                  ),
                ],
              ),
              if (busy) ...[
                const SizedBox(height: 10),
                const LinearProgressIndicator(minHeight: 2),
              ],
            ],
          ),
        );
      },
    );
  }
}
