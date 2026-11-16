import 'package:supabase_flutter/supabase_flutter.dart';

/// Catalog and history access. Gift settlement is intentionally not exposed
/// as a direct client write; it must be an atomic server-side transaction.
class SupabaseGiftService {
  SupabaseGiftService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<List<Map<String, dynamic>>> getActiveCatalog() async {
    final rows = await _client.from('gifts').select(
      'id,name,image_url,price,currency,is_active',
    ).eq('is_active', true).order('price');
    return List<Map<String, dynamic>>.from(rows);
  }

  Future<List<Map<String, dynamic>>> getMyGiftHistory({int limit = 50}) async {
    final rows = await _client.from('gift_transactions').select(
      'id,gift_id,sender_id,receiver_id,room_id,quantity,total_price,created_at,gifts(name,image_url,currency)',
    ).or('sender_id.eq.$_uid,receiver_id.eq.$_uid')
      .order('created_at', ascending: false).limit(limit);
    return List<Map<String, dynamic>>.from(rows);
  }
}
