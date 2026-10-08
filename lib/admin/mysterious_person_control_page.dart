import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import 'control_firebase.dart';

class MysteriousPersonControlPage extends StatefulWidget {
  const MysteriousPersonControlPage({super.key});

  @override
  State<MysteriousPersonControlPage> createState() =>
      _MysteriousPersonControlPageState();
}

class _MysteriousPersonControlPageState
    extends State<MysteriousPersonControlPage> {
  final _query = TextEditingController();
  final _price7 = TextEditingController();
  final _price15 = TextEditingController();
  final _price30 = TextEditingController();
  final _priceReason = TextEditingController();
  final _revealId = TextEditingController();
  final _revealReason = TextEditingController();

  bool _loading = true;
  bool _busy = false;
  bool _canManage = false;
  bool _canReveal = false;
  bool _canUpdatePrices = false;
  bool _canGrantPermanent = false;
  String? _error;
  Map<String, dynamic>? _revealed;
  List<_MysteriousControlUser> _results = const [];

  @override
  void initState() {
    super.initState();
    _loadState();
  }

  @override
  void dispose() {
    _query.dispose();
    _price7.dispose();
    _price15.dispose();
    _price30.dispose();
    _priceReason.dispose();
    _revealId.dispose();
    _revealReason.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final user = controlAuth.currentUser;
    if (user == null) throw const _ControlError('unauthorized');
    await user.reload();
    final refreshed = controlAuth.currentUser;
    if (refreshed == null) throw const _ControlError('unauthorized');
    final token =
        await refreshed.getIdToken(true).timeout(const Duration(seconds: 12));
    if (token == null || token.isEmpty) {
      throw const _ControlError('unauthorized');
    }

    final response = await http
        .post(
          shadowApiEndpoint('manage-mysterious-person'),
          headers: <String, String>{
            'content-type': 'application/json',
            'authorization': 'Bearer $token',
          },
          body: jsonEncode(payload),
        )
        .timeout(const Duration(seconds: 25));

    Map<String, dynamic> body = const {};
    try {
      final decoded = jsonDecode(response.body);
      if (decoded is Map) body = Map<String, dynamic>.from(decoded);
    } catch (_) {}

    if (response.statusCode != 200 || body['ok'] != true) {
      throw _ControlError(
        (body['code'] ?? 'mysterious_control_failed').toString(),
      );
    }
    return body;
  }

  String _key(String action) =>
      'mystctl_${action}_${DateTime.now().microsecondsSinceEpoch}';

  String _message(String code) => switch (code) {
        'forbidden' => 'ما عندك الصلاحية المطلوبة لهذه العملية.',
        'recent_auth_required' =>
          'يلزم تسجيل دخول إداري حديث. سجّل خروج وادخل من جديد.',
        'permanent_owner_only' => 'المنح للأبد متاح للـOwner فقط.',
        'owner_protected' => 'حساب الـOwner محمي من تعديل إداري آخر.',
        'not_found' => 'الحساب أو ID الغامض غير موجود.',
        'invalid_price' => 'السعر المدخل غير صالح.',
        'invalid_request' => 'تحقق من البيانات المدخلة.',
        'unauthorized' => 'انتهت جلسة Shadow Control.',
        _ => 'تعذر إكمال العملية: $code',
      };

  Future<void> _loadState() async {
    if (mounted) {
      setState(() {
        _loading = true;
        _error = null;
      });
    }
    try {
      final body = await _post({'action': 'controlState'});
      final access = body['access'] is Map
          ? Map<String, dynamic>.from(body['access'] as Map)
          : <String, dynamic>{};
      final prices = body['prices'] is Map
          ? Map<String, dynamic>.from(body['prices'] as Map)
          : <String, dynamic>{};
      if (!mounted) return;
      setState(() {
        _canManage = access['canManage'] == true;
        _canReveal = access['canReveal'] == true;
        _canUpdatePrices = access['canUpdatePrices'] == true;
        _canGrantPermanent = access['canGrantPermanent'] == true;
        _price7.text = '${prices['7'] ?? prices[7] ?? 990000}';
        _price15.text = '${prices['15'] ?? prices[15] ?? 1990000}';
        _price30.text = '${prices['30'] ?? prices[30] ?? 2990000}';
        _loading = false;
      });
    } on _ControlError catch (error) {
      if (!mounted) return;
      setState(() {
        _error = _message(error.code);
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error = 'تعذر تحميل إعدادات الشخص الغامض.';
        _loading = false;
      });
    }
  }

  Future<void> _search() async {
    if (!_canManage || _busy) return;
    final query = _query.text.trim();
    if (query.isEmpty) {
      setState(() => _error = 'اكتب الاسم أو Public ID أو UID.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final body = await _post({
        'action': 'controlSearch',
        'query': query,
      });
      final raw = body['results'];
      final results = raw is List
          ? raw
              .whereType<Map>()
              .map(
                (item) => _MysteriousControlUser.fromJson(
                  Map<String, dynamic>.from(item),
                ),
              )
              .toList(growable: false)
          : const <_MysteriousControlUser>[];
      if (mounted) setState(() => _results = results);
    } on _ControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _updatePrices() async {
    if (!_canUpdatePrices || _busy) return;
    final p7 = int.tryParse(_price7.text.trim());
    final p15 = int.tryParse(_price15.text.trim());
    final p30 = int.tryParse(_price30.text.trim());
    if ([p7, p15, p30].any((value) => value == null || value! <= 0)) {
      setState(() => _error = 'أدخل أسعار Coins صحيحة أكبر من صفر.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _post({
        'action': 'controlUpdatePrices',
        'price7Days': p7,
        'price15Days': p15,
        'price30Days': p30,
        'reason': _priceReason.text.trim(),
        'idempotencyKey': _key('prices'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم تحديث الأسعار وتسجيل العملية.')),
      );
      await _loadState();
    } on _ControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _grant(
    _MysteriousControlUser user, {
    int? days,
    bool permanent = false,
  }) async {
    if (!_canManage || _busy) return;
    final label = permanent ? 'للأبد' : '$days يوم';
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('منح الشخص الغامض — $label'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(user.displayName),
            const SizedBox(height: 10),
            TextField(
              controller: reason,
              maxLength: 160,
              decoration: const InputDecoration(
                labelText: 'السبب — اختياري',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('منح'),
          ),
        ],
      ),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      await _post({
        'action': 'controlGrant',
        'targetUid': user.uid,
        if (days != null) 'days': days,
        if (permanent) 'permanent': true,
        'reason': why,
        'idempotencyKey': _key(permanent ? 'forever' : 'grant_$days'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تم منح $label وتسجيل العملية.')),
      );
      await _search();
    } on _ControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(_MysteriousControlUser user) async {
    if (!_canManage || _busy) return;
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('سحب امتياز الشخص الغامض'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(user.displayName),
            const SizedBox(height: 10),
            TextField(
              controller: reason,
              maxLength: 160,
              decoration: const InputDecoration(
                labelText: 'السبب — اختياري',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('سحب'),
          ),
        ],
      ),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (confirmed != true || !mounted) return;

    setState(() => _busy = true);
    try {
      await _post({
        'action': 'controlRevoke',
        'targetUid': user.uid,
        'reason': why,
        'idempotencyKey': _key('revoke'),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم سحب الامتياز وتسجيل العملية.')),
      );
      await _search();
    } on _ControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reveal() async {
    if (!_canReveal || _busy) return;
    final id = _revealId.text.trim();
    final reason = _revealReason.text.trim();
    if (!RegExp(r'^[1-9][0-9]{8}$').hasMatch(id)) {
      setState(() => _error = 'ID الغامض يجب أن يكون 9 أرقام.');
      return;
    }
    if (reason.length < 3) {
      setState(() => _error = 'اكتب سبب الكشف قبل التنفيذ.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _revealed = null;
    });
    try {
      final body = await _post({
        'action': 'controlReveal',
        'mysteriousId': id,
        'reason': reason,
      });
      if (!mounted) return;
      setState(() {
        _revealed = body['identity'] is Map
            ? Map<String, dynamic>.from(body['identity'] as Map)
            : <String, dynamic>{};
      });
    } on _ControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _number(int value) {
    final text = value.toString();
    final out = <String>[];
    for (var end = text.length; end > 0; end -= 3) {
      final start = end - 3 < 0 ? 0 : end - 3;
      out.add(text.substring(start, end));
    }
    return out.reversed.join(',');
  }

  String _remaining(_MysteriousState state) {
    if (state.permanent) return 'للأبد';
    if (!state.active || state.remainingMs <= 0) return 'منتهي';
    final hours = (state.remainingMs / Duration.millisecondsPerHour).ceil();
    if (hours < 24) return '$hours ساعة';
    return '${(hours / 24).ceil()} يوم';
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return Scaffold(
      appBar: AppBar(
        title: const Text('الشخص الغامض'),
        actions: [
          IconButton(
            onPressed: _busy ? null : _loadState,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'تحديث',
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (_error != null)
            Card(
              color: const Color(0xFF2A1015),
              child: ListTile(
                leading: const Icon(Icons.error_outline, color: Colors.redAccent),
                title: Text(
                  _error!,
                  style: const TextStyle(color: Colors.redAccent),
                ),
              ),
            ),
          if (_canUpdatePrices) ...[
            _title('الأسعار', Icons.sell_outlined),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Expanded(child: _priceField(_price7, '7 أيام')),
                        const SizedBox(width: 8),
                        Expanded(child: _priceField(_price15, '15 يوم')),
                        const SizedBox(width: 8),
                        Expanded(child: _priceField(_price30, '30 يوم')),
                      ],
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _priceReason,
                      maxLength: 160,
                      decoration: const InputDecoration(
                        labelText: 'سبب التعديل — اختياري',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _updatePrices,
                        icon: const Icon(Icons.save_outlined),
                        label: const Text('حفظ الأسعار'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
          ],
          if (_canManage) ...[
            _title('إدارة الامتياز', Icons.manage_accounts_outlined),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _query,
                        onSubmitted: (_) => _search(),
                        decoration: const InputDecoration(
                          labelText: 'الاسم أو Public ID أو UID',
                          border: OutlineInputBorder(),
                          prefixIcon: Icon(Icons.search),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _busy ? null : _search,
                      child: const Text('بحث'),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 10),
            ..._results.map(_userCard),
            const SizedBox(height: 16),
          ],
          if (_canReveal) ...[
            _title('كشف الهوية الحقيقية', Icons.visibility_outlined),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    TextField(
                      controller: _revealId,
                      keyboardType: TextInputType.number,
                      decoration: const InputDecoration(
                        labelText: 'ID الشخص الغامض — 9 أرقام',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: _revealReason,
                      maxLength: 160,
                      decoration: const InputDecoration(
                        labelText: 'سبب الكشف *',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        onPressed: _busy ? null : _reveal,
                        icon: const Icon(Icons.visibility_rounded),
                        label: const Text('كشف الهوية'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_revealed != null)
              Card(
                child: ListTile(
                  leading: const CircleAvatar(
                    child: Icon(Icons.verified_user_outlined),
                  ),
                  title: Text(
                    (_revealed!['displayName'] ?? 'مستخدم').toString(),
                    style: const TextStyle(fontWeight: FontWeight.w900),
                  ),
                  subtitle: Text(
                    'Public ID: ${_revealed!['publicId'] ?? '—'}\nUID: ${_revealed!['uid'] ?? '—'}',
                  ),
                  isThreeLine: true,
                ),
              ),
          ],
          const SizedBox(height: 12),
          const Card(
            child: ListTile(
              leading: Icon(Icons.shield_outlined, color: Color(0xFFD7B85A)),
              title: Text('قواعد الصلاحيات'),
              subtitle: Text(
                'الأسعار و«للأبد» Owner-only. المنح/السحب وكشف الهوية صلاحيتان منفصلتان. كل عملية حساسة تُسجل في Audit Log.',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _priceField(TextEditingController controller, String label) => TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        decoration: InputDecoration(
          labelText: label,
          suffixText: 'Coins',
          border: const OutlineInputBorder(),
        ),
      );

  Widget _title(String text, IconData icon) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(
          children: [
            Icon(icon, color: const Color(0xFFD7B85A)),
            const SizedBox(width: 8),
            Text(
              text,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
            ),
          ],
        ),
      );

  Widget _userCard(_MysteriousControlUser user) {
    final state = user.mysterious;
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: CircleAvatar(
                backgroundImage: user.profileImageUrl.isEmpty
                    ? null
                    : NetworkImage(user.profileImageUrl),
                child: user.profileImageUrl.isEmpty
                    ? const Icon(Icons.person_outline)
                    : null,
              ),
              title: Text(
                user.displayName,
                style: const TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: Text(
                'Public ID: ${user.publicId.isEmpty ? '—' : user.publicId}\n'
                'الحالة: ${state.active ? (state.enabled ? 'مفعّل' : 'متوقف') : 'غير مشترك'}'
                ' • المدة: ${_remaining(state)}'
                ' • تغييرات ID: ${_number(state.idChangesRemaining)}'
                '${state.mysteriousId.isEmpty ? '' : '\nID الغامض: ${state.mysteriousId}'}',
              ),
              isThreeLine: true,
            ),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                OutlinedButton(
                  onPressed: _busy ? null : () => _grant(user, days: 7),
                  child: const Text('+7 أيام'),
                ),
                OutlinedButton(
                  onPressed: _busy ? null : () => _grant(user, days: 15),
                  child: const Text('+15 يوم'),
                ),
                OutlinedButton(
                  onPressed: _busy ? null : () => _grant(user, days: 30),
                  child: const Text('+30 يوم'),
                ),
                if (_canGrantPermanent)
                  FilledButton.tonal(
                    onPressed:
                        _busy ? null : () => _grant(user, permanent: true),
                    child: const Text('للأبد'),
                  ),
                FilledButton.tonalIcon(
                  onPressed: _busy ? null : () => _revoke(user),
                  icon: const Icon(Icons.block_outlined),
                  label: const Text('سحب'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MysteriousControlUser {
  const _MysteriousControlUser({
    required this.uid,
    required this.displayName,
    required this.publicId,
    required this.profileImageUrl,
    required this.mysterious,
  });

  final String uid;
  final String displayName;
  final String publicId;
  final String profileImageUrl;
  final _MysteriousState mysterious;

  factory _MysteriousControlUser.fromJson(Map<String, dynamic> json) {
    final mysterious = json['mysterious'] is Map
        ? Map<String, dynamic>.from(json['mysterious'] as Map)
        : <String, dynamic>{};
    return _MysteriousControlUser(
      uid: (json['uid'] ?? '').toString(),
      displayName: (json['displayName'] ?? 'مستخدم Shadow Live').toString(),
      publicId: (json['publicId'] ?? '').toString(),
      profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
      mysterious: _MysteriousState.fromJson(mysterious),
    );
  }
}

class _MysteriousState {
  const _MysteriousState({
    required this.active,
    required this.enabled,
    required this.permanent,
    required this.remainingMs,
    required this.idChangesRemaining,
    required this.mysteriousId,
  });

  final bool active;
  final bool enabled;
  final bool permanent;
  final int remainingMs;
  final int idChangesRemaining;
  final String mysteriousId;

  factory _MysteriousState.fromJson(Map<String, dynamic> json) =>
      _MysteriousState(
        active: json['active'] == true,
        enabled: json['enabled'] == true,
        permanent: json['permanent'] == true,
        remainingMs: (json['remainingMs'] as num?)?.toInt() ?? 0,
        idChangesRemaining:
            (json['idChangesRemaining'] as num?)?.toInt() ?? 0,
        mysteriousId: (json['mysteriousId'] ?? '').toString(),
      );
}

class _ControlError implements Exception {
  const _ControlError(this.code);
  final String code;
}
