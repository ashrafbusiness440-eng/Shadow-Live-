import 'package:supabase_flutter/supabase_flutter.dart';

/// Profiles are keyed by the Supabase Auth UUID. Never pass Firebase UIDs here.
class SupabaseProfileService {
  SupabaseProfileService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Map<String, dynamic> _toAppProfile(Map<String, dynamic> row) => {
        ...row,
        'uid': row['id'],
        'publicId': row['public_id'],
        'displayName': row['display_name'],
        'profileImageUrl': row['avatar_url'],
        'isOnline': row['is_online'],
        'setupStep': row['setup_step'],
        'setupComplete': row['setup_complete'],
        'accountStatus': row['account_status'],
        'vipLevel': row['level'] ?? 1,
      };

  Future<Map<String, dynamic>?> getCurrentProfile() async {
    final row = await _client.from('profiles').select().eq('id', _uid).maybeSingle();
    return row == null ? null : _toAppProfile(row);
  }

  Future<Map<String, dynamic>?> getProfile(String userId) async {
    final row = await _client.from('profiles').select().eq('id', userId).maybeSingle();
    return row == null ? null : _toAppProfile(row);
  }

  Future<Map<String, dynamic>> createOrUpdateCurrentProfile({
    required String displayName,
    String? username,
    String? avatarUrl,
    String? bio,
    String? country,
    String? location,
    List<dynamic>? interests,
    String? setupStep,
    bool? setupComplete,
  }) async {
    final current = _client.auth.currentUser ??
        (throw StateError('not_signed_in'));
    final payload = <String, dynamic>{
      'id': current.id,
      'display_name': displayName.trim(),
      if (username != null) 'username': username.trim(),
      if (avatarUrl != null) 'avatar_url': avatarUrl,
      if (bio != null) 'bio': bio,
      if (country != null) 'country': country,
      if (location != null) 'location': location,
      if (interests != null) 'interests': interests,
      if (setupStep != null) 'setup_step': setupStep,
      if (setupComplete != null) 'setup_complete': setupComplete,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    };
    final row = await _client.from('profiles').upsert(payload, onConflict: 'id').select().single();
    return _toAppProfile(row);
  }

  Future<void> setOnline(bool online) async {
    await _client.from('profiles').update({
      'is_online': online,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', _uid);
  }

  Stream<Map<String, dynamic>?> watchCurrentProfile() {
    return _client.from('profiles').stream(primaryKey: ['id']).eq('id', _uid)
        .map((rows) => rows.isEmpty ? null : _toAppProfile(rows.first));
  }
}
