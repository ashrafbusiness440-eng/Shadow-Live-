import 'dart:async';

import 'package:flutter/material.dart';

import '../services/mysterious_person_service.dart';
import '../../voice/services/voice_room_session_controller.dart';

class MysteriousPersonScreen extends StatefulWidget {
  const MysteriousPersonScreen({super.key, this.embedded = false});

  final bool embedded;

  @override
  State<MysteriousPersonScreen> createState() => _MysteriousPersonScreenState();
}

class _MysteriousPersonScreenState extends State<MysteriousPersonScreen> {
  final MysteriousPersonService _service = MysteriousPersonService();
  MysteriousPersonState? _state;
  bool _loading = true;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _service.close();
    super.dispose();
  }

  Future<void> _load() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final state = await _service.loadState();
      if (!mounted) return;
      unawaited(
        VoiceRoomSessionController.instance.applyMysteriousVoice(
          enabled: state.enabled,
          voiceId: state.selectedVoiceId,
        ),
      );
      setState(() {
        _state = state;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'تعذر تحميل الشخص الغامض حالياً.';
      });
    }
  }

  String _number(int value) {
    final digits = value.abs().toString();
    final parts = <String>[];
    for (var end = digits.length; end > 0; end -= 3) {
      final start = end - 3 < 0 ? 0 : end - 3;
      parts.add(digits.substring(start, end));
    }
    final grouped = parts.reversed.join(',');
    return value < 0 ? '-$grouped' : grouped;
  }

  String _remaining(MysteriousPersonState state) {
    if (state.permanent) return 'للأبد';
    if (!state.active || state.remainingMs <= 0) return 'منتهي';
    final hours = (state.remainingMs / Duration.millisecondsPerHour).ceil();
    if (hours < 24) return '$hours ساعة';
    final days = (hours / 24).ceil();
    return '$days يوم';
  }

  Future<void> _purchase(MysteriousOffer offer) async {
    if (_saving) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101827),
          title: const Text(
            'تأكيد الشراء',
            style: TextStyle(color: Colors.white),
          ),
          content: Text(
            'شراء امتياز الشخص الغامض لمدة ${offer.days} يوم مقابل ${_number(offer.coinPrice)} كوين؟',
            style: const TextStyle(color: Colors.white70, height: 1.5),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('شراء'),
            ),
          ],
        ),
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _saving = true);
    try {
      final state = await _service.purchase(offer.days);
      if (!mounted) return;
      setState(() {
        _state = state;
        _saving = false;
      });
      _message('تمت إضافة المدة ورصيد تغييرات ID.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message(_friendlyError(error));
    }
  }

  Future<void> _toggle() async {
    final current = _state;
    if (current == null || _saving) return;
    if (!current.active) {
      _message('اشترِ مدة صالحة أولاً لتشغيل الشخص الغامض.');
      return;
    }
    setState(() => _saving = true);
    try {
      final state = await _service.setEnabled(!current.enabled);
      await VoiceRoomSessionController.instance.applyMysteriousVoice(
        enabled: state.enabled,
        voiceId: state.selectedVoiceId,
      );
      if (!mounted) return;
      setState(() {
        _state = state;
        _saving = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message(_friendlyError(error));
    }
  }

  Future<void> _setVoice(MysteriousVoiceOption option) async {
    final current = _state;
    if (current == null || _saving || !current.active) return;
    setState(() => _saving = true);
    try {
      final state = await _service.setVoice(option.id);
      await VoiceRoomSessionController.instance.applyMysteriousVoice(
        enabled: state.enabled,
        voiceId: state.selectedVoiceId,
      );
      if (!mounted) return;
      setState(() {
        _state = state;
        _saving = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message(_friendlyError(error));
    }
  }

  Future<void> _changeId() async {
    final current = _state;
    if (current == null || _saving) return;
    if (current.idChangesRemaining < 1) {
      _message('ما عندك تغييرات ID متبقية.');
      return;
    }
    setState(() => _saving = true);
    try {
      final state = await _service.changeId();
      if (state.enabled) {
        await VoiceRoomSessionController.instance
            .refreshMysteriousRoomIdentity();
      }
      if (!mounted) return;
      setState(() {
        _state = state;
        _saving = false;
      });
      _message('تم تغيير ID الغامض.');
    } catch (error) {
      if (!mounted) return;
      setState(() => _saving = false);
      _message(_friendlyError(error));
    }
  }

  String _friendlyError(Object error) {
    final code = error.toString();
    if (code.contains('insufficient_coins')) return 'رصيد الكوينز غير كافٍ.';
    if (code.contains('mysterious_id_changes_exhausted')) {
      return 'انتهى رصيد تغييرات ID.';
    }
    if (code.contains('mysterious_subscription_required')) {
      return 'لا توجد مدة صالحة للشخص الغامض.';
    }
    if (code.contains('mysterious_voice_unavailable')) {
      return 'هذا الصوت غير متاح حالياً.';
    }
    return 'تعذر إكمال العملية حالياً.';
  }

  void _message(String value) {
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(value)));
  }

  @override
  Widget build(BuildContext context) {
    final body = _body();
    if (widget.embedded) {
      return Directionality(textDirection: TextDirection.rtl, child: body);
    }
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF050814),
        appBar: AppBar(
          backgroundColor: const Color(0xFF0B1220),
          foregroundColor: Colors.white,
          title: const Text(
            'الشخص الغامض',
            style: TextStyle(fontWeight: FontWeight.w900),
          ),
          actions: [
            IconButton(
              tooltip: 'تحديث',
              onPressed: _loading || _saving ? null : _load,
              icon: const Icon(Icons.refresh_rounded),
            ),
          ],
        ),
        body: body,
      ),
    );
  }

  Widget _body() {
    if (_loading && _state == null) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _state == null) {
      return Center(
        child: FilledButton.icon(
          onPressed: _load,
          icon: const Icon(Icons.refresh_rounded),
          label: const Text('إعادة المحاولة'),
        ),
      );
    }

    final state = _state!;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(14, 16, 14, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: const Color(0xFF101827),
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: const Color(0x558B5CF6)),
            ),
            child: Column(
              children: [
                const Icon(
                  Icons.theater_comedy_rounded,
                  color: Color(0xFFFFD166),
                  size: 52,
                ),
                const SizedBox(height: 10),
                Text(
                  state.active
                      ? (state.enabled ? 'الوضع مفعّل' : 'الوضع متوقف')
                      : 'غير مشترك',
                  style: TextStyle(
                    color: state.enabled
                        ? const Color(0xFF79F2C0)
                        : Colors.white,
                    fontSize: 20,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                _row('المدة المتبقية', _remaining(state)),
                _row(
                  'ID الغامض',
                  state.mysteriousId.isEmpty ? '—' : state.mysteriousId,
                ),
                _row(
                  'تغييرات ID المتبقية',
                  _number(state.idChangesRemaining),
                ),
              ],
            ),
          ),
          if (state.active) ...[
            const SizedBox(height: 14),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    key: const Key('mysterious-change-id'),
                    onPressed: _saving || state.idChangesRemaining < 1
                        ? null
                        : _changeId,
                    icon: const Icon(Icons.pin_rounded),
                    label: const Text('تغيير ID'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: FilledButton.icon(
                    key: const Key('mysterious-toggle'),
                    onPressed: _saving ? null : _toggle,
                    icon: Icon(
                      state.enabled
                          ? Icons.visibility_off_rounded
                          : Icons.visibility_rounded,
                    ),
                    label: Text(state.enabled ? 'إيقاف الوضع' : 'تشغيل الوضع'),
                  ),
                ),
              ],
            ),
          ],
          if (state.active && state.voiceOptions.isNotEmpty) ...[
            const SizedBox(height: 18),
            const Text(
              'تغيير الصوت',
              key: Key('mysterious-voice-options'),
              style: TextStyle(
                color: Color(0xFFFFD166),
                fontSize: 17,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: state.voiceOptions
                  .map(
                    (option) => ChoiceChip(
                      label: Text(option.labelAr),
                      selected: state.selectedVoiceId == option.id,
                      onSelected: _saving
                          ? null
                          : (_) => unawaited(_setVoice(option)),
                    ),
                  )
                  .toList(growable: false),
            ),
            const SizedBox(height: 8),
            Text(
              state.enabled
                  ? 'الصوت المحدد يعمل الآن داخل غرف الصوت.'
                  : 'يمكنك اختيار الصوت الآن، ويعمل فقط عند تشغيل وضع الشخص الغامض.',
              style: const TextStyle(color: Colors.white54, fontSize: 12),
            ),
          ],
          const SizedBox(height: 18),
          const Text(
            'شراء أو تمديد',
            style: TextStyle(
              color: Color(0xFFFFD166),
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 10),
          ...state.offers.map(
            (offer) => Card(
              color: const Color(0xFF0C1728),
              child: ListTile(
                title: Text(
                  '${offer.days} يوم',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                subtitle: Text(
                  offer.idChanges == 0
                      ? 'ID واحد طوال المدة'
                      : '+ ${offer.idChanges} تغيير ID',
                  style: const TextStyle(color: Colors.white54),
                ),
                trailing: FilledButton(
                  onPressed: _saving ? null : () => _purchase(offer),
                  child: Text('${_number(offer.coinPrice)} كوين'),
                ),
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'إيقاف الوضع لا يلغي الاشتراك ولا يوقف المدة. ويمكنك تشغيله من هنا أو من «إعداد التخفي».',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white54, height: 1.5),
          ),
          if (_saving) ...[
            const SizedBox(height: 14),
            const LinearProgressIndicator(minHeight: 2),
          ],
        ],
      ),
    );
  }

  Widget _row(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Text(label, style: const TextStyle(color: Colors.white54)),
            const Spacer(),
            Flexible(
              child: Text(
                value,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.left,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      );
}
