import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseVipService {
  SupabaseVipService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<List<Map<String, dynamic>>> getActivePackages() async {
    final rows = await _client.from('vip_packages').select(
      'id,name,duration_days,price,currency,benefits,is_active',
    ).eq('is_active', true).order('price');
    return List<Map<String, dynamic>>.from(rows);
  }

  Future<Map<String, dynamic>?> getMyVip() async {
    return _client.from('user_vips').select(
      'user_id,package_id,starts_at,expires_at,vip_packages(name,duration_days,benefits)',
    ).eq('user_id', _uid).maybeSingle();
  }
}
