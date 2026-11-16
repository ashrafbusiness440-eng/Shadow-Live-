import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase access layer for Shadow Live.
///
/// Firebase remains active during the staged migration. Do not pass Firebase
/// UIDs to tables that reference auth.users; those operations must use the
/// authenticated Supabase user ID.
class SupabaseService {
  SupabaseService._();

  static SupabaseClient get client => Supabase.instance.client;

  static User? get currentUser => client.auth.currentUser;

  static Future<Map<String, dynamic>?> getCurrentProfile() async {
    final user = currentUser;
    if (user == null) return null;

    return client
        .from('profiles')
        .select()
        .eq('id', user.id)
        .maybeSingle();
  }

  static Future<List<Map<String, dynamic>>> fetchActiveRooms() async {
    final rows = await client
        .from('rooms')
        .select(
          'id, owner_id, title, description, cover_url, room_type, status, created_at',
        )
        .eq('status', 'active')
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(rows);
  }

  static Stream<List<Map<String, dynamic>>> watchActiveRooms() {
    return client
        .from('rooms')
        .stream(primaryKey: ['id'])
        .eq('status', 'active')
        .order('created_at', ascending: false);
  }
}
