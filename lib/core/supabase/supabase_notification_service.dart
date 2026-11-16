import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseNotificationService {
  SupabaseNotificationService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<List<Map<String, dynamic>>> loadNotifications({int limit = 50}) async {
    final rows = await _client.from('notifications').select(
      'id,user_id,type,title,body,data,read_at,created_at',
    ).eq('user_id', _uid).order('created_at', ascending: false).limit(limit);
    return List<Map<String, dynamic>>.from(rows);
  }

  Stream<List<Map<String, dynamic>>> watchNotifications() => _client
      .from('notifications')
      .stream(primaryKey: ['id'])
      .eq('user_id', _uid)
      .order('created_at', ascending: false);

  Future<void> markRead(String notificationId) async {
    await _client.from('notifications').update({
      'read_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', notificationId).eq('user_id', _uid);
  }

  Future<void> markAllRead() async {
    await _client.from('notifications').update({
      'read_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('user_id', _uid).isFilter('read_at', null);
  }
}
