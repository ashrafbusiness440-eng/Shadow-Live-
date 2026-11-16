import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseChatService {
  SupabaseChatService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<List<Map<String, dynamic>>> loadRoomMessages(
    String roomId, {int limit = 100}
  ) async {
    final rows = await _client.from('chat_messages').select(
      'id,room_id,sender_id,message_type,body,media_url,created_at,deleted_at',
    ).eq('room_id', roomId).isFilter('deleted_at', null)
      .order('created_at', ascending: true).limit(limit);
    return List<Map<String, dynamic>>.from(rows);
  }

  Stream<List<Map<String, dynamic>>> watchRoomMessages(String roomId) =>
      _client.from('chat_messages').stream(primaryKey: ['id'])
        .eq('room_id', roomId).order('created_at', ascending: true);

  Future<Map<String, dynamic>> sendRoomMessage({
    required String roomId,
    required String body,
    String messageType = 'text',
    String? mediaUrl,
  }) async {
    final text = body.trim();
    if (text.isEmpty && (mediaUrl == null || mediaUrl.isEmpty)) {
      throw ArgumentError('message_empty');
    }
    return await _client.from('chat_messages').insert({
      'room_id': roomId,
      'sender_id': _uid,
      'message_type': messageType,
      'body': text.isEmpty ? null : text,
      'media_url': mediaUrl,
    }).select().single();
  }

  Future<void> deleteOwnMessage(String messageId) async {
    await _client.from('chat_messages').update({
      'deleted_at': DateTime.now().toUtc().toIso8601String(),
    }).eq('id', messageId).eq('sender_id', _uid);
  }

  Future<void> addReaction(String messageId, String reaction) async {
    await _client.from('chat_message_reactions').upsert({
      'message_id': messageId,
      'user_id': _uid,
      'reaction': reaction,
    }, onConflict: 'message_id,user_id,reaction');
  }

  Future<void> removeReaction(String messageId, String reaction) async {
    await _client.from('chat_message_reactions').delete()
      .eq('message_id', messageId).eq('user_id', _uid)
      .eq('reaction', reaction);
  }
}
