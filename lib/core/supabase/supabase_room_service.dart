import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseRoomService {
  SupabaseRoomService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<List<Map<String, dynamic>>> listActiveRooms({int limit = 50}) async {
    final rows = await _client.from('rooms').select(
      'id,owner_id,title,description,cover_url,room_type,status,created_at,agora_channel',
    ).eq('status', 'active').order('created_at', ascending: false).limit(limit);
    return List<Map<String, dynamic>>.from(rows);
  }

  Stream<List<Map<String, dynamic>>> watchActiveRooms() => _client
      .from('rooms')
      .stream(primaryKey: ['id'])
      .eq('status', 'active')
      .order('created_at', ascending: false);

  Future<Map<String, dynamic>> createRoom({
    required String title,
    String? description,
    String? coverUrl,
    String roomType = 'public',
    String? agoraChannel,
  }) async {
    final row = await _client.from('rooms').insert({
      'owner_id': _uid,
      'title': title.trim(),
      'description': description,
      'cover_url': coverUrl,
      'room_type': roomType,
      'agora_channel': agoraChannel,
    }).select().single();
    return row;
  }

  Future<void> joinRoom(String roomId) async {
    await _client.from('room_members').upsert({
      'room_id': roomId,
      'user_id': _uid,
      'role': 'member',
    }, onConflict: 'room_id,user_id');
  }

  Future<void> leaveRoom(String roomId) async {
    await _client.from('room_members').delete()
        .eq('room_id', roomId).eq('user_id', _uid);
  }

  Future<void> closeRoom(String roomId) async {
    await _client.from('rooms').update({
      'status': 'closed',
      'updated_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', roomId).eq('owner_id', _uid);
  }
}
