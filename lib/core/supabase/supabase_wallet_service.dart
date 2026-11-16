import 'package:supabase_flutter/supabase_flutter.dart';

/// Wallet reads are client-accessible; balance mutations must go through
/// authenticated server-side functions and must never be client-side updates.
class SupabaseWalletService {
  SupabaseWalletService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  String get _uid => _client.auth.currentUser?.id ??
      (throw StateError('not_signed_in'));

  Future<Map<String, dynamic>?> getWallet() => _client
      .from('wallets')
      .select('user_id,coins,diamonds,updated_at')
      .eq('user_id', _uid)
      .maybeSingle();

  Stream<List<Map<String, dynamic>>> watchWallet() => _client
      .from('wallets')
      .stream(primaryKey: ['user_id'])
      .eq('user_id', _uid);

  Future<List<Map<String, dynamic>>> getTransactions({int limit = 50}) async {
    final rows = await _client
        .from('wallet_transactions')
        .select('id,transaction_type,amount,currency,reference_type,reference_id,metadata,created_at')
        .eq('user_id', _uid)
        .order('created_at', ascending: false)
        .limit(limit);
    return List<Map<String, dynamic>>.from(rows);
  }
}
