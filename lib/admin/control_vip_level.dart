import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import '../features/profile/widgets/profile_avatar_with_frame.dart';
import 'control_firebase.dart';

class VipLevelControlPage extends StatefulWidget {
  const VipLevelControlPage({super.key});

  @override
  State<VipLevelControlPage> createState() => _VipLevelControlPageState();
}

class _VipLevelControlPageState extends State<VipLevelControlPage> {
  final _query = TextEditingController();
  bool _busy = false;
  bool _searched = false;
  bool _isOwner = false;
  String? _error;
  List<int> _allowedLevels = const <int>[];
  List<_VipControlUser> _users = const <_VipControlUser>[];

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final user = controlAuth.currentUser;
    if (user == null) throw const _VipControlError('unauthorized');
    final token = await user.getIdToken().timeout(const Duration(seconds: 12));
    if (token == null || token.isEmpty) {
      throw const _VipControlError('unauthorized');
    }
    final response = await http.post(
      shadowApiEndpoint('manage-vip-level'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        'Authorization': 'Bearer $token',
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 25));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200 || body['ok'] != true) {
      throw _VipControlError((body['code'] ?? 'request_failed').toString());
    }
    return body;
  }

  String _message(String code) => switch (code) {
        'forbidden' => 'لا تملك صلاحية manageVipLevels.',
        'owner_protected' => 'لا يستطيع إداري آخر تعديل VIP حساب الـOwner.',
        'recent_auth_required' => 'يلزم تسجيل دخول إداري حديث قبل تعديل VIP.',
        'vip_level_not_allowed' =>
          'مستوى VIP المطلوب خارج allowedVipGrantLevels الخاصة بهذا الإداري.',
        'admin_vip_grant_exists' =>
          'توجد منحة VIP إدارية فعالة؛ استخدم تغيير بدل منح.',
        'admin_vip_grant_missing' =>
          'لا توجد منحة VIP إدارية فعالة لتغييرها.',
        'invalid_vip_level' => 'مستوى VIP غير صالح.',
        'invalid_grant_duration' => 'مدة المنحة غير صالحة.',
        'not_found' => 'الحساب المستهدف غير موجود.',
        'invalid_request' => 'تحقق من بيانات العملية.',
        'unauthorized' => 'الجلسة الإدارية غير صالحة.',
        _ => 'تعذر تنفيذ العملية: $code',
      };

  Future<void> _search() async {
    final query = _query.text.trim();
    if (query.isEmpty) {
      setState(() => _error = 'اكتب الاسم أو Public ID أو UID.');
      return;
    }
    setState(() {
      _busy = true;
      _searched = true;
      _error = null;
    });
    try {
      final body = await _post(<String, dynamic>{
        'action': 'search',
        'query': query,
      });
      final rawResults = body['results'];
      final users = rawResults is List
          ? rawResults
              .whereType<Map>()
              .map((item) => _VipControlUser.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <_VipControlUser>[];
      final rawAllowed = body['allowedVipGrantLevels'];
      final allowed = rawAllowed is List
          ? (rawAllowed
                .map((item) => int.tryParse('$item'))
                .whereType<int>()
                .where((level) => level >= 1 && level <= 10)
                .toSet()
                .toList()
              ..sort())
          : <int>[];
      if (!mounted) return;
      setState(() {
        _users = users;
        _isOwner = body['isOwner'] == true;
        _allowedLevels = List<int>.unmodifiable(allowed);
      });
    } on _VipControlError catch (error) {
      if (!mounted) return;
      setState(() {
        _users = const <_VipControlUser>[];
        _error = _message(error.code);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _users = const <_VipControlUser>[];
        _error = 'تعذر تحميل بيانات VIP.';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _execute(
    _VipControlUser target, {
    required String mode,
    int? level,
    int? durationMinutes,
    String reason = '',
  }) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _post(<String, dynamic>{
        'action': 'update',
        'targetUid': target.uid,
        'mode': mode,
        if (level != null) 'vipLevel': level,
        if (durationMinutes != null) 'durationMinutes': durationMinutes,
        'reason': reason.trim(),
        'idempotencyKey':
            'vipctl_${DateTime.now().microsecondsSinceEpoch}',
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            mode == 'remove'
                ? 'تم سحب منحة VIP الإدارية وتسجيل العملية.'
                : mode == 'change'
                    ? 'تم تغيير منحة VIP وتسجيل العملية.'
                    : 'تم منح VIP وتسجيل العملية.',
          ),
        ),
      );
      await _search();
    } on _VipControlError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر تنفيذ تعديل VIP.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _openGrantEditor(_VipControlUser target) async {
    final hasGrant = target.adminGrantVipLevel > 0 &&
        target.adminGrantExpiresAtMs > DateTime.now().millisecondsSinceEpoch;
    final allowed = _isOwner
        ? List<int>.generate(10, (index) => index + 1)
        : _allowedLevels;
    if (allowed.isEmpty) {
      setState(() => _error =
          'manageVipLevels مفعّلة لكن allowedVipGrantLevels فارغة؛ لا يمكن منح أي مستوى.');
      return;
    }

    var selectedLevel = allowed.contains(target.adminGrantVipLevel)
        ? target.adminGrantVipLevel
        : allowed.first;
    var durationValue = 7;
    var durationUnit = 'days';
    final reason = TextEditingController();
    var saving = false;
    String? dialogError;

    final action = await showDialog<String>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) {
          int? durationMinutes() {
            if (durationValue <= 0) return null;
            final multiplier = durationUnit == 'hours' ? 60 : 24 * 60;
            final minutes = durationValue * multiplier;
            return minutes > 0 ? minutes : null;
          }

          return AlertDialog(
            title: Text(hasGrant ? 'تغيير منحة VIP' : 'منح VIP'),
            content: SizedBox(
              width: 440,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Text(
                      '${target.displayName} • ${target.publicId.isEmpty ? target.uid : target.publicId}',
                    ),
                    const SizedBox(height: 12),
                    DropdownButtonFormField<int>(
                      initialValue: selectedLevel,
                      decoration: const InputDecoration(
                        labelText: 'VIP Level',
                        border: OutlineInputBorder(),
                      ),
                      items: allowed
                          .map(
                            (level) => DropdownMenuItem<int>(
                              value: level,
                              child: Text('VIP$level'),
                            ),
                          )
                          .toList(growable: false),
                      onChanged: saving
                          ? null
                          : (value) {
                              if (value != null) {
                                setDialogState(() => selectedLevel = value);
                              }
                            },
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: <Widget>[
                        Expanded(
                          child: TextFormField(
                            initialValue: durationValue.toString(),
                            enabled: !saving,
                            keyboardType: TextInputType.number,
                            decoration: const InputDecoration(
                              labelText: 'مدة المنحة',
                              border: OutlineInputBorder(),
                            ),
                            onChanged: (value) {
                              durationValue = int.tryParse(value.trim()) ?? 0;
                            },
                          ),
                        ),
                        const SizedBox(width: 8),
                        SizedBox(
                          width: 130,
                          child: DropdownButtonFormField<String>(
                            initialValue: durationUnit,
                            decoration: const InputDecoration(
                              labelText: 'الوحدة',
                              border: OutlineInputBorder(),
                            ),
                            items: const <DropdownMenuItem<String>>[
                              DropdownMenuItem(
                                value: 'hours',
                                child: Text('ساعة'),
                              ),
                              DropdownMenuItem(
                                value: 'days',
                                child: Text('يوم'),
                              ),
                            ],
                            onChanged: saving
                                ? null
                                : (value) {
                                    if (value != null) {
                                      setDialogState(() => durationUnit = value);
                                    }
                                  },
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: reason,
                      maxLength: 160,
                      enabled: !saving,
                      decoration: const InputDecoration(
                        labelText: 'السبب — اختياري',
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 8),
                    const Text(
                      'المنحة الإدارية طبقة مستقلة. earned VIP وGrowth والصلاحية الطبيعية يستمرون بالخلفية ولا يتم تصفيرهم.',
                      style: TextStyle(
                        color: Color(0xFFAAA3B8),
                        fontSize: 12,
                      ),
                    ),
                    if (dialogError != null) ...[
                      const SizedBox(height: 8),
                      Text(
                        dialogError!,
                        style: const TextStyle(color: Colors.orangeAccent),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            actions: <Widget>[
              if (hasGrant)
                TextButton.icon(
                  onPressed: saving
                      ? null
                      : () => Navigator.pop(dialogContext, 'remove'),
                  icon: const Icon(Icons.delete_outline),
                  label: const Text('سحب المنحة'),
                ),
              TextButton(
                onPressed:
                    saving ? null : () => Navigator.pop(dialogContext, null),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: saving
                    ? null
                    : () {
                        final minutes = durationMinutes();
                        if (minutes == null) {
                          setDialogState(
                            () => dialogError = 'أدخل مدة صحيحة أكبر من صفر.',
                          );
                          return;
                        }
                        Navigator.pop(
                          dialogContext,
                          '${hasGrant ? 'change' : 'grant'}:$minutes',
                        );
                      },
                child: Text(hasGrant ? 'حفظ التغيير' : 'منح'),
              ),
            ],
          );
        },
      ),
    );

    final why = reason.text.trim();
    reason.dispose();
    if (!mounted || action == null) return;
    if (action == 'remove') {
      await _execute(target, mode: 'remove', reason: why);
      return;
    }
    final parts = action.split(':');
    if (parts.length != 2) return;
    final minutes = int.tryParse(parts[1]);
    if (minutes == null || minutes <= 0) return;
    await _execute(
      target,
      mode: parts[0],
      level: selectedLevel,
      durationMinutes: minutes,
      reason: why,
    );
  }

  String _dateText(int epochMs) {
    if (epochMs <= 0) return '—';
    final date = DateTime.fromMillisecondsSinceEpoch(epochMs).toLocal();
    String two(int value) => value.toString().padLeft(2, '0');
    return '${date.year}-${two(date.month)}-${two(date.day)} '
        '${two(date.hour)}:${two(date.minute)}';
  }

  Widget _userCard(_VipControlUser user) {
    final source = switch (user.effectiveVipSource) {
      'admin_grant' => 'Admin Grant',
      'trial_card' => 'Trial Card',
      'progression' => 'طبيعي',
      _ => 'بدون VIP',
    };
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              children: <Widget>[
                ProfileAvatarWithFrame(
                  diameter: 48,
                  placeholderIcon: Icons.person_outline,
                  profile: profileAvatarFrameData(
                    imageUrl: user.profileImageUrl,
                    avatarAsset: user.profileAvatarAsset,
                    frameAssetKey: user.activeProfileFrameAssetKey,
                    frameImageUrl: user.activeProfileFrameImageUrl,
                    frameExpiresAtMs:
                        user.activeProfileFrameExpiresAtMs,
                    framePermanent:
                        user.activeProfileFramePermanent,
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        user.displayName,
                        style: const TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        'Public ID: ${user.publicId.isEmpty ? '—' : user.publicId}',
                        style: const TextStyle(color: Color(0xFFAAA3B8)),
                      ),
                    ],
                  ),
                ),
                Chip(label: Text('VIP${user.effectiveVipLevel}')),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: <Widget>[
                Chip(label: Text('المصدر: $source')),
                Chip(label: Text('Earned VIP${user.earnedVipLevel}')),
                if (user.adminGrantVipLevel > 0)
                  Chip(label: Text('Grant VIP${user.adminGrantVipLevel}')),
                if (user.trialVipLevel > 0)
                  Chip(label: Text('Trial VIP${user.trialVipLevel}')),
              ],
            ),
            const SizedBox(height: 8),
            Text('Growth: ${user.growthPoints}'),
            Text('Maintenance: ${user.maintenancePoints}'),
            if (user.adminGrantVipLevel > 0)
              Text(
                'انتهاء المنحة: ${_dateText(user.adminGrantExpiresAtMs)}',
              ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: _busy ? null : () => _openGrantEditor(user),
              icon: Icon(
                user.adminGrantVipLevel > 0
                    ? Icons.edit_outlined
                    : Icons.workspace_premium_outlined,
              ),
              label: Text(
                user.adminGrantVipLevel > 0
                    ? 'تغيير / سحب المنحة'
                    : 'منح VIP',
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          appBar: AppBar(title: const Text('إدارة VIP')),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: <Widget>[
              const Text(
                'Shadow Control — VIP',
                style: TextStyle(fontSize: 25, fontWeight: FontWeight.w900),
              ),
              const SizedBox(height: 6),
              const Text(
                'بحث bounded حتى 20 نتيجة. كل Grant / Change / Remove يمر Server-side ويُسجل في Audit Log.',
                style: TextStyle(color: Color(0xFFAAA3B8)),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _query,
                textInputAction: TextInputAction.search,
                onSubmitted: (_) => _busy ? null : _search(),
                decoration: InputDecoration(
                  labelText: 'الاسم / Public ID / UID',
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.person_search_outlined),
                  suffixIcon: IconButton(
                    onPressed: _busy ? null : _search,
                    icon: const Icon(Icons.search),
                  ),
                ),
              ),
              const SizedBox(height: 10),
              if (_searched)
                Card(
                  child: ListTile(
                    leading: Icon(
                      _isOwner
                          ? Icons.verified_user_outlined
                          : Icons.admin_panel_settings_outlined,
                      color: const Color(0xFFD7B85A),
                    ),
                    title: Text(
                      _isOwner
                          ? 'Owner: VIP1→VIP10 متاحة دائمًا'
                          : 'المستويات المسموحة: ${_allowedLevels.isEmpty ? 'لا يوجد' : _allowedLevels.map((e) => 'VIP$e').join('، ')}',
                    ),
                    subtitle: const Text(
                      'Role وحده لا يمنح صلاحية VIP، والـServer يعيد التحقق من كل عملية.',
                    ),
                  ),
                ),
              if (_busy) ...[
                const SizedBox(height: 8),
                const LinearProgressIndicator(minHeight: 2),
              ],
              if (_error != null) ...[
                const SizedBox(height: 8),
                Card(
                  color: const Color(0xFF2A1015),
                  child: ListTile(
                    leading: const Icon(
                      Icons.error_outline,
                      color: Colors.orangeAccent,
                    ),
                    title: Text(
                      _error!,
                      style: const TextStyle(color: Colors.orangeAccent),
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 12),
              if (_searched && !_busy && _users.isEmpty && _error == null)
                const Card(
                  child: ListTile(
                    leading: Icon(Icons.search_off_outlined),
                    title: Text('لا توجد نتائج مطابقة.'),
                  ),
                ),
              ..._users.map(_userCard),
              const SizedBox(height: 8),
              const Card(
                child: ListTile(
                  leading: Icon(
                    Icons.security_outlined,
                    color: Color(0xFFD7B85A),
                  ),
                  title: Text('Admin Grant ≠ Natural VIP'),
                  subtitle: Text(
                    'المنحة لا توقف progression ولا تحذف Growth أو Maintenance. عند انتهائها يعود المستخدم إلى أعلى VIP طبيعي مستحق فعليًا.',
                  ),
                ),
              ),
            ],
          ),
        ),
      );
}

class _VipControlUser {
  const _VipControlUser({
    required this.uid,
    required this.displayName,
    required this.publicId,
    required this.profileImageUrl,
    required this.profileAvatarAsset,
    required this.activeProfileFrameAssetKey,
    required this.activeProfileFrameImageUrl,
    required this.activeProfileFrameExpiresAtMs,
    required this.activeProfileFramePermanent,
    required this.role,
    required this.earnedVipLevel,
    required this.effectiveVipLevel,
    required this.effectiveVipSource,
    required this.adminGrantVipLevel,
    required this.trialVipLevel,
    required this.growthPoints,
    required this.maintenancePoints,
    required this.adminGrantExpiresAtMs,
  });

  final String uid;
  final String displayName;
  final String publicId;
  final String profileImageUrl;
  final String profileAvatarAsset;
  final String activeProfileFrameAssetKey;
  final String activeProfileFrameImageUrl;
  final int activeProfileFrameExpiresAtMs;
  final bool activeProfileFramePermanent;
  final String role;
  final int earnedVipLevel;
  final int effectiveVipLevel;
  final String effectiveVipSource;
  final int adminGrantVipLevel;
  final int trialVipLevel;
  final int growthPoints;
  final int maintenancePoints;
  final int adminGrantExpiresAtMs;

  factory _VipControlUser.fromJson(Map<String, dynamic> json) {
    final vip = json['vip'] is Map
        ? Map<String, dynamic>.from(json['vip'] as Map)
        : <String, dynamic>{};
    int value(String key) => int.tryParse('${vip[key] ?? 0}') ?? 0;
    return _VipControlUser(
      uid: '${json['uid'] ?? ''}'.trim(),
      displayName: '${json['displayName'] ?? 'مستخدم Shadow Live'}'.trim(),
      publicId: '${json['publicId'] ?? ''}'.trim(),
      profileImageUrl: '${json['profileImageUrl'] ?? ''}'.trim(),
      profileAvatarAsset:
          '${json['profileAvatarAsset'] ?? ''}'.trim(),
      activeProfileFrameAssetKey:
          '${json['activeProfileFrameAssetKey'] ?? ''}'.trim(),
      activeProfileFrameImageUrl:
          '${json['activeProfileFrameImageUrl'] ?? ''}'.trim(),
      activeProfileFrameExpiresAtMs:
          int.tryParse('${json['activeProfileFrameExpiresAtMs'] ?? 0}') ?? 0,
      activeProfileFramePermanent:
          json['activeProfileFramePermanent'] == true,
      role: '${json['role'] ?? 'user'}'.trim(),
      earnedVipLevel: value('earnedVipLevel'),
      effectiveVipLevel: value('effectiveVipLevel'),
      effectiveVipSource: '${vip['effectiveVipSource'] ?? 'none'}'.trim(),
      adminGrantVipLevel: value('adminGrantVipLevel'),
      trialVipLevel: value('trialVipLevel'),
      growthPoints: value('growthPoints'),
      maintenancePoints: value('maintenancePoints'),
      adminGrantExpiresAtMs: value('adminGrantExpiresAtMs'),
    );
  }
}

class _VipControlError implements Exception {
  const _VipControlError(this.code);
  final String code;
}
