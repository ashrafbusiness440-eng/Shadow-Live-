import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../services/vip_fancy_id_service.dart';

class VipFancyIdScreen extends StatefulWidget {
  const VipFancyIdScreen({super.key});

  @override
  State<VipFancyIdScreen> createState() => _VipFancyIdScreenState();
}

class _VipFancyIdScreenState extends State<VipFancyIdScreen> {
  final VipFancyIdService _service = VipFancyIdService();
  final TextEditingController _controller = TextEditingController();

  VipFancyIdState? _state;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _controller.dispose();
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final state = await _service.state();
      if (!mounted) return;
      setState(() {
        _state = state;
        _controller.text = state.fancyId;
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

  Future<void> _save() async {
    final state = _state;
    if (state == null || _saving) return;
    if (state.effectiveVipLevel < 3) {
      _message('الرقم الفاخر متاح من VIP3.');
      return;
    }

    final value = _controller.text.trim();
    final min = state.minDigits;
    final max = state.maxDigits;
    if (!RegExp(r'^\d+$').hasMatch(value) ||
        value.length < min ||
        value.length > max) {
      _message('اختر رقمًا من $min إلى $max أرقام.');
      return;
    }

    setState(() => _saving = true);
    try {
      final updated = await _service.assign(value);
      if (!mounted) return;
      setState(() {
        _state = updated;
        _controller.text = updated.fancyId;
        _saving = false;
      });
      _message('تم تفعيل الرقم الفاخر.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      final code = error.toString();
      if (code.contains('fancy_id_taken')) {
        _message('هذا الرقم مستخدم حاليًا.');
      } else if (code.contains('fancy_id_requires_vip3')) {
        _message('الرقم الفاخر متاح من VIP3.');
      } else {
        _message('تعذر حفظ الرقم الفاخر حاليًا.');
      }
    }
  }

  Future<void> _copy(String value) async {
    if (value.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: value.trim()));
    if (!mounted) return;
    _message('تم نسخ الرقم الفاخر.');
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  String _expiryText(VipFancyIdState state) {
    if (!state.active || state.expiresAtMs <= 0) return 'غير مفعّل';
    final d = DateTime.fromMillisecondsSinceEpoch(state.expiresAtMs).toLocal();
    final mm = d.month.toString().padLeft(2, '0');
    final dd = d.day.toString().padLeft(2, '0');
    return '${d.year}/$mm/$dd';
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
          title: const Text('الرقم الفاخر', style: TextStyle(fontWeight: FontWeight.w900)),
          actions: [
            IconButton(onPressed: _loading || _saving ? null : _load, icon: const Icon(Icons.refresh_rounded)),
          ],
        ),
        body: _body(),
      ),
    );
  }

  Widget _body() {
    if (_loading && _state == null) return const Center(child: CircularProgressIndicator());
    if (_error != null && _state == null) {
      return Center(child: FilledButton.icon(onPressed: _load, icon: const Icon(Icons.refresh_rounded), label: const Text('إعادة المحاولة')));
    }
    final state = _state!;
    final eligible = state.effectiveVipLevel >= 3;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 18, 16, 32),
      children: [
        Container(
          padding: const EdgeInsets.all(18),
          decoration: BoxDecoration(color: const Color(0xFF101827), borderRadius: BorderRadius.circular(20), border: Border.all(color: const Color(0x448B5CF6))),
          child: Column(children: [
            const Icon(Icons.confirmation_number_rounded, color: Color(0xFFFFD166), size: 44),
            const SizedBox(height: 10),
            Text(state.active ? state.fancyId : 'لا يوجد رقم فاخر فعّال', textDirection: TextDirection.ltr, style: const TextStyle(color: Color(0xFFFFD166), fontSize: 26, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            Text(state.active ? 'صالح حتى ${_expiryText(state)}' : 'مستواك الحالي VIP${state.effectiveVipLevel}', style: const TextStyle(color: Colors.white54)),
            if (state.active) ...[
              const SizedBox(height: 8),
              TextButton.icon(onPressed: () => _copy(state.fancyId), icon: const Icon(Icons.copy_rounded), label: const Text('نسخ الرقم')),
            ],
          ]),
        ),
        const SizedBox(height: 16),
        if (!eligible)
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: const Color(0x221F2937), borderRadius: BorderRadius.circular(16)),
            child: const Text('الرقم الفاخر يبدأ من VIP3. يمكنك مشاهدة الميزة الآن، لكن التفعيل يحتاج VIP3 أو أعلى.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, height: 1.5)),
          )
        else ...[
          TextField(
            key: const Key('vip-fancy-id-input'),
            controller: _controller,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            maxLength: state.maxDigits,
            textDirection: TextDirection.ltr,
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, letterSpacing: 2),
            decoration: InputDecoration(
              labelText: 'اختر رقمًا فاخرًا',
              helperText: 'VIP${state.effectiveVipLevel}: من ${state.minDigits} إلى ${state.maxDigits} أرقام',
              helperStyle: const TextStyle(color: Colors.white54),
              labelStyle: const TextStyle(color: Colors.white60),
              enabledBorder: const OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
              focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: Color(0xFFFFD166))),
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            key: const Key('vip-fancy-id-save'),
            onPressed: _saving ? null : _save,
            icon: _saving ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.check_circle_outline_rounded),
            label: Text(state.active ? 'تغيير الرقم الفاخر' : 'تفعيل الرقم الفاخر'),
          ),
        ],
        const SizedBox(height: 16),
        const Text('الرقم الفاخر Alias مؤقت ولا يغيّر Public ID الأساسي أو UID. عند انتهاء الأهلية يرجع العرض إلى Public ID الأساسي، ويمكن إعادة استخدام الرقم الفاخر لاحقًا من مستخدم آخر.', style: TextStyle(color: Colors.white38, fontSize: 12, height: 1.5)),
      ],
    );
  }
}