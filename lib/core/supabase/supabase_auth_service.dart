import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase authentication adapter for the staged Firebase migration.
///
/// This adapter is intentionally introduced before switching the app-wide
/// auth state. Firebase-backed screens and services remain active until their
/// callers have been migrated and verified, so do not remove Firebase yet.
class SupabaseAuthService {
  SupabaseClient get _client => Supabase.instance.client;

  User? get currentUser => _client.auth.currentUser;

  Session? get currentSession => _client.auth.currentSession;

  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  Future<AuthResponse> signInWithEmail({
    required String email,
    required String password,
  }) {
    return _client.auth.signInWithPassword(
      email: email.trim(),
      password: password,
    );
  }

  Future<AuthResponse> signUpWithEmail({
    required String email,
    required String password,
    Map<String, dynamic>? metadata,
  }) {
    return _client.auth.signUp(
      email: email.trim(),
      password: password,
      data: metadata,
    );
  }

  Future<void> requestPhoneOtp({
    required String phoneNumber,
    OtpChannel channel = OtpChannel.sms,
  }) {
    return _client.auth.signInWithOtp(
      phone: phoneNumber.trim(),
      channel: channel,
    );
  }

  Future<AuthResponse> verifyPhoneOtp({
    required String phoneNumber,
    required String token,
  }) {
    return _client.auth.verifyOTP(
      phone: phoneNumber.trim(),
      token: token.trim(),
      type: OtpType.sms,
    );
  }

  Future<bool> signInWithOAuth(
    OAuthProvider provider, {
    String? redirectTo,
    String? scopes,
  }) {
    return _client.auth.signInWithOAuth(
      provider,
      redirectTo: redirectTo,
      scopes: scopes,
    );
  }

  Future<Map<String, dynamic>?> getProfile(String userId) async {
    final row = await _client
        .from('profiles')
        .select()
        .eq('id', userId)
        .maybeSingle();

    return row;
  }

  Future<void> signOut() => _client.auth.signOut();
}
