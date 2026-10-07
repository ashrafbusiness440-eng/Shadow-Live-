import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import 'control_api_endpoints.dart';
import '../features/profile/widgets/profile_avatar_with_frame.dart';
import 'control_firebase.dart';

abstract final class UserLevelMigrationPolicy {
  static const forbiddenLegacyFields = <String>{
    'level',
    'userLevel',
    'memberLevel',
    'popularity',
    'popularityLevel',
    'wealth',
    'wealthLevel',
  };

  static bool isLegacyField(String field) =>
      forbiddenLegacyFields.contains(field);
}

class UserLevelControlPage extends StatefulWidget {
  const UserLevelControlPage({super.key});

  @override
  State<UserLevelControlPage> createState() => _UserLevelControlPageState();
}

class _UserLevelControlPageState extends State<UserLevelControlPage> {
  final TextEditingController _query = TextEditingController();
  bool _busy = false;
  bool _searched = false;
  bool _isOwner = false;
  String? _error;
  Set<String> _capabilities = const <String>{};
  List<_LevelUser> _users = const <_LevelUser>[];

  @override
  void dispose() {
    _query.dispose();
    super.dispose();
  }

  Future<Map<String, dynamic>> _post(Map<String, dynamic> payload) async {
    final user = controlAuth.currentUser;
    if (user == null) throw const _LevelError('unauthorized');
    final token = await user.getIdToken().timeout(const Duration(seconds: 12));
    if (token == null || token.isEmpty) {
      throw const _LevelError('unauthorized');
    }
    final response = await http.post(
      shadowApiEndpoint('manage-user-level'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: jsonEncode(payload),
    ).timeout(const Duration(seconds: 25));
    final body = response.body.isEmpty
        ? <String, dynamic>{}
        : jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode != 200 || body['ok'] != true) {
      throw _LevelError((body['code'] ?? 'request_failed').toString());
    }
    return body;
  }

  String _message(String code) => switch (code) {
    'forbidden' => 'لا تملك صلاحية إدارة المستوى.',
    'owner_protected' => 'حساب الـOwner محمي من تعديل الإداريين الآخرين.',
    'recent_auth_required' => 'يلزم تسجيل دخول حديث قبل هذا التعديل.',
    'not_found' => 'الحساب المستهدف غير موجود.',
    'invalid_level' => 'المستوى المطلوب خارج النطاق المعتمد.',
    'invalid_points' => 'قيمة النقاط غير صالحة.',
    'invalid_request' => 'تحقق من البيانات وسبب التعديل.',
    'unauthorized' => 'الجلسة الإدارية غير صالحة.',
    _ => 'تعذر تنفيذ العملية: ' + code,
  };

  bool _canManage(String metric) {
    if (_isOwner || _capabilities.contains('manageUserLevels')) return true;
    return switch (metric) {
      'wealth' => _capabilities.contains('manageWealthLevel'),
      'attraction' => _capabilities.contains('manageAttractionLevel'),
      'games' => _capabilities.contains('manageGameLevel'),
      _ => false,
    };
  }

  String _formatNumber(int value) {
    final source = value.toString();
    final output = StringBuffer();
    for (var i = 0; i < source.length; i += 1) {
      if (i > 0 && (source.length - i) % 3 == 0) output.write(',');
      output.write(source[i]);
    }
    return output.toString();
  }

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
              .map((item) => _LevelUser.fromJson(
                    Map<String, dynamic>.from(item),
                  ))
              .toList(growable: false)
          : const <_LevelUser>[];
      final rawCaps = body['capabilities'];
      if (!mounted) return;
      setState(() {
        _users = users;
        _isOwner = body['isOwner'] == true;
        _capabilities = rawCaps is List
            ? rawCaps.map((item) => item.toString()).toSet()
            : <String>{};
      });
    } on _LevelError catch (error) {
      if (!mounted) return;
      setState(() {
        _users = const <_LevelUser>[];
        _error = _message(error.code);
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _users = const <_LevelUser>[];
        _error = 'تعذر تحميل بيانات المستوى.';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _update(
    _LevelUser user,
    _LevelMetric metric, {
    required String mode,
    int? points,
    int? level,
    required String reason,
  }) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await _post(<String, dynamic>{
        'action': 'update',
        'targetUid': user.uid,
        'metric': metric.key,
        'mode': mode,
        if (points != null) 'points': points,
        if (level != null) 'level': level,
        'reason': reason,
        'idempotencyKey':
            'level_' + DateTime.now().microsecondsSinceEpoch.toString(),
      });
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تم تحديث المستوى وتسجيل العملية في Audit Log.'),
        ),
      );
      await _search();
    } on _LevelError catch (error) {
      if (mounted) setState(() => _error = _message(error.code));
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر تنفيذ تعديل المستوى.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _editPoints(_LevelUser user, _LevelMetric metric) async {
    final points = TextEditingController(text: metric.points.toString());
    final reason = TextEditingController(text: 'تصحيح نقاط المستوى إداريًا');
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('تعيين نقاط ' + metric.label),
        content: SizedBox(
          width: 420,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(user.displayName + ' • ' +
                  (user.publicId.isEmpty ? user.uid : user.publicId)),
              const SizedBox(height: 12),
              TextField(
                controller: points,
                autofocus: true,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'النقاط الجديدة',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reason,
                maxLength: 160,
                decoration: const InputDecoration(
                  labelText: 'سبب التعديل',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: const Text('حفظ'),
          ),
        ],
      ),
    );
    final parsed = int.tryParse(points.text.replaceAll(',', '').trim());
    final why = reason.text.trim();
    points.dispose();
    reason.dispose();
    if (accepted != true || !mounted) return;
    if (parsed == null || parsed < 0 || why.length < 3) {
      setState(() => _error = 'أدخل نقاطًا صحيحة وسببًا واضحًا.');
      return;
    }
    await _update(
      user,
      metric,
      mode: 'setPoints',
      points: parsed,
      reason: why,
    );
  }

  Future<void> _editLevel(_LevelUser user, _LevelMetric metric) async {
    var selected = metric.level.clamp(1, metric.maxLevel).toInt();
    final reason = TextEditingController(text: 'تصحيح المستوى إداريًا');
    final accepted = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: Text('تعيين مستوى ' + metric.label),
          content: SizedBox(
            width: 420,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                DropdownButtonFormField<int>(
                  initialValue: selected,
                  decoration: const InputDecoration(
                    labelText: 'المستوى',
                    border: OutlineInputBorder(),
                  ),
                  items: List<DropdownMenuItem<int>>.generate(
                    metric.maxLevel,
                    (index) => DropdownMenuItem<int>(
                      value: index + 1,
                      child: Text('LV' + (index + 1).toString()),
                    ),
                  ),
                  onChanged: (value) {
                    if (value != null) {
                      setDialogState(() => selected = value);
                    }
                  },
                ),
                const SizedBox(height: 10),
                const Text(
                  'Set Level يضبط النقاط Server-side إلى Minimum Threshold من Level Policy المركزية.',
                  style: TextStyle(
                    color: Color(0xFFAAA3B8),
                    fontSize: 12,
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: reason,
                  maxLength: 160,
                  decoration: const InputDecoration(
                    labelText: 'سبب التعديل',
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
          ),
          actions: <Widget>[
            TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(dialogContext, true),
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
    final why = reason.text.trim();
    reason.dispose();
    if (accepted != true || !mounted) return;
    if (why.length < 3) {
      setState(() => _error = 'اكتب سببًا واضحًا للتعديل.');
      return;
    }
    await _update(
      user,
      metric,
      mode: 'setLevel',
      level: selected,
      reason: why,
    );
  }

  Widget _metricCard(_LevelUser user, _LevelMetric metric) {
    final progress = (metric.progressBps / 10000).clamp(0.0, 1.0).toDouble();
    final allowed = _canManage(metric.key);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Icon(metric.icon, color: metric.color),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    metric.label,
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 16,
                    ),
                  ),
                ),
                Chip(label: Text('LV' + metric.level.toString())),
              ],
            ),
            Text(
              _formatNumber(metric.points) + ' نقطة',
              style: const TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w900,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              metric.nextThreshold == null
                  ? 'أعلى مستوى معتمد'
                  : 'المتبقي: ' + _formatNumber(metric.remaining),
              style: const TextStyle(color: Color(0xFFAAA3B8)),
            ),
            const SizedBox(height: 8),
            LinearProgressIndicator(value: progress),
            if (metric.key == 'games' && metric.pendingDecayDays > 0) ...[
              const SizedBox(height: 8),
              Text(
                'خمول مستحق: ' +
                    metric.pendingDecayDays.toString() +
                    ' يوم — التعديل الإداري لا يعيد عدّ الخمول.',
                style: const TextStyle(
                  color: Colors.orangeAccent,
                  fontSize: 12,
                ),
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: <Widget>[
                FilledButton.tonalIcon(
                  onPressed: allowed && !_busy
                      ? () => _editPoints(user, metric)
                      : null,
                  icon: const Icon(Icons.numbers_rounded),
                  label: const Text('Set Points'),
                ),
                OutlinedButton.icon(
                  onPressed: allowed && !_busy
                      ? () => _editLevel(user, metric)
                      : null,
                  icon: const Icon(Icons.stairs_rounded),
                  label: const Text('Set Level'),
                ),
              ],
            ),
            if (!allowed) ...[
              const SizedBox(height: 8),
              const Text(
                'لا توجد صلاحية لهذا القسم.',
                style: TextStyle(color: Color(0xFF8F879E)),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _userCard(_LevelUser user) => Card(
        margin: const EdgeInsets.only(bottom: 14),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Row(
                children: <Widget>[
                  ProfileAvatarWithFrame(
                    diameter: 48,
                    userId: user.uid,
                    placeholderIcon: Icons.person_outline,
                    fallbackProfile: <String, dynamic>{
                      'profileImageUrl': user.profileImageUrl,
                      'profileAvatarAsset': user.profileAvatarAsset,
                    },
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Text(
                          user.displayName,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        Text(
                          'Public ID: ' +
                              (user.publicId.isEmpty ? '—' : user.publicId),
                          style: const TextStyle(color: Color(0xFFAAA3B8)),
                        ),
                        SelectableText(
                          'UID: ' + user.uid,
                          style: const TextStyle(
                            color: Color(0xFF8F879E),
                            fontSize: 11,
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (user.role == 'owner')
                    const Chip(label: Text('Owner')),
                ],
              ),
              const SizedBox(height: 10),
              _metricCard(user, user.wealth),
              _metricCard(user, user.attraction),
              _metricCard(user, user.games),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            const Row(
              children: <Widget>[
                Icon(
                  Icons.military_tech_outlined,
                  size: 30,
                  color: Color(0xFFD7B85A),
                ),
                SizedBox(width: 10),
                Text(
                  'المستوى',
                  style: TextStyle(
                    fontSize: 25,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              'Wealth / Attraction / Games — Server-authoritative. Room Level وVIP مستقلان.',
              style: TextStyle(color: Color(0xFFAAA3B8)),
            ),
            const SizedBox(height: 16),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: TextField(
                  controller: _query,
                  textInputAction: TextInputAction.search,
                  onSubmitted: (_) {
                    if (!_busy) _search();
                  },
                  decoration: InputDecoration(
                    labelText: 'الاسم / Public ID / UID',
                    helperText: 'Bounded حتى 20 نتيجة — بدون scans أو polling.',
                    border: const OutlineInputBorder(),
                    prefixIcon: const Icon(Icons.person_search_outlined),
                    suffixIcon: IconButton(
                      onPressed: _busy ? null : _search,
                      icon: const Icon(Icons.search),
                    ),
                  ),
                ),
              ),
            ),
            if (_busy) ...[
              const SizedBox(height: 10),
              const LinearProgressIndicator(),
            ],
            if (_error != null) ...[
              const SizedBox(height: 10),
              Card(
                color: const Color(0xFF2A1015),
                child: ListTile(
                  leading: const Icon(
                    Icons.error_outline,
                    color: Colors.redAccent,
                  ),
                  title: Text(
                    _error!,
                    style: const TextStyle(color: Colors.redAccent),
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
          ],
        ),
      );
}

class _LevelError implements Exception {
  const _LevelError(this.code);
  final String code;
}

class _LevelUser {
  const _LevelUser({
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
    required this.wealth,
    required this.attraction,
    required this.games,
  });

  factory _LevelUser.fromJson(Map<String, dynamic> json) {
    final levels = json['levels'] is Map
        ? Map<String, dynamic>.from(json['levels'] as Map)
        : <String, dynamic>{};
    return _LevelUser(
      uid: (json['uid'] ?? '').toString(),
      displayName: (json['displayName'] ?? 'مستخدم Shadow Live').toString(),
      publicId: (json['publicId'] ?? '').toString(),
      profileImageUrl: (json['profileImageUrl'] ?? '').toString(),
      profileAvatarAsset:
          (json['profileAvatarAsset'] ?? '').toString(),
      activeProfileFrameAssetKey:
          (json['activeProfileFrameAssetKey'] ?? '').toString(),
      activeProfileFrameImageUrl:
          (json['activeProfileFrameImageUrl'] ?? '').toString(),
      activeProfileFrameExpiresAtMs:
          (json['activeProfileFrameExpiresAtMs'] as num?)?.toInt() ?? 0,
      activeProfileFramePermanent:
          json['activeProfileFramePermanent'] == true,
      role: (json['role'] ?? 'user').toString(),
      wealth: _LevelMetric.fromJson(
        key: 'wealth',
        label: 'الثروة',
        icon: Icons.diamond_outlined,
        color: const Color(0xFFFFD54A),
        raw: levels['wealth'],
      ),
      attraction: _LevelMetric.fromJson(
        key: 'attraction',
        label: 'الجاذبية',
        icon: Icons.favorite_outline_rounded,
        color: const Color(0xFFFF6E9C),
        raw: levels['attraction'],
      ),
      games: _LevelMetric.fromJson(
        key: 'games',
        label: 'الألعاب',
        icon: Icons.sports_esports_outlined,
        color: const Color(0xFF80CBC4),
        raw: levels['games'],
      ),
    );
  }

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
  final _LevelMetric wealth;
  final _LevelMetric attraction;
  final _LevelMetric games;
}

class _LevelMetric {
  const _LevelMetric({
    required this.key,
    required this.label,
    required this.icon,
    required this.color,
    required this.points,
    required this.level,
    required this.maxLevel,
    required this.remaining,
    required this.progressBps,
    required this.nextThreshold,
    required this.pendingDecayDays,
  });

  factory _LevelMetric.fromJson({
    required String key,
    required String label,
    required IconData icon,
    required Color color,
    required dynamic raw,
  }) {
    final json = raw is Map
        ? Map<String, dynamic>.from(raw)
        : <String, dynamic>{};
    int readInt(String field) => (json[field] as num?)?.toInt() ?? 0;
    return _LevelMetric(
      key: key,
      label: label,
      icon: icon,
      color: color,
      points: readInt('points'),
      level: readInt('level'),
      maxLevel: readInt('maxLevel'),
      remaining: readInt('remaining'),
      progressBps: readInt('progressBps'),
      nextThreshold: json['nextThreshold'] == null
          ? null
          : (json['nextThreshold'] as num?)?.toInt(),
      pendingDecayDays: readInt('pendingDecayDays'),
    );
  }

  final String key;
  final String label;
  final IconData icon;
  final Color color;
  final int points;
  final int level;
  final int maxLevel;
  final int remaining;
  final int progressBps;
  final int? nextThreshold;
  final int pendingDecayDays;
}
