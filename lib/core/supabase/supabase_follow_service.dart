import 'package:supabase_flutter/supabase_flutter.dart';

class SupabaseFollowService {
  SupabaseFollowService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<bool> isFollowing(String targetUserId) async {
    final row = await _client.from('follows').select('follower_id')
        .eq('follower_id', _uid).eq('following_id', targetUserId).maybeSingle();
    return row != null;
  }

  Future<void> follow(String targetUserId) async {
    if (targetUserId == _uid) throw ArgumentError('cannot_follow_self');
    await _client.from('follows').upsert({
      'follower_id': _uid,
      'following_id': targetUserId,
    }, onConflict: 'follower_id,following_id');
  }

  Future<void> unfollow(String targetUserId) async {
    await _client.from('follows').delete()
        .eq('follower_id', _uid).eq('following_id', targetUserId);
  }

  Future<Map<String, int>> counts(String userId) async {
    final followers = await _client.from('follows').select('follower_id')
        .eq('following_id', userId);
    final following = await _client.from('follows').select('following_id')
        .eq('follower_id', userId);
    return {
      'followers': followers.length,
      'following': following.length,
    };
  }
}
