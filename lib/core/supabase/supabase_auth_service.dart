import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase Auth adapter. Application identity is always the Supabase Auth UUID.
class SupabaseAuthService {
  SupabaseAuthService({SupabaseClient? client})
      : _client = client ?? Supabase.instance.client;

  final SupabaseClient _client;
  User? get currentUser => _client.auth.currentUser;
  Session? get currentSession => _client.auth.currentSession;
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;

  Future<AuthResponse> signInWithEmail({
    required String email,
    required String password,
  }) => _client.auth.signInWithPassword(
        email: email.trim(),
        password: password,
      );

  Future<AuthResponse> signUpWithEmail({
    required String email,
    required String password,
    Map<String, dynamic>? metadata,
  }) => _client.auth.signUp(
        email: email.trim(),
        password: password,
        data: metadata,
      );

  Future<void> sendPasswordReset(String email, {String? redirectTo}) =>
      _client.auth.resetPasswordForEmail(
        email.trim(),
        redirectTo: redirectTo,
      );

  Future<UserResponse> updatePassword(String newPassword) =>
      _client.auth.updateUser(UserAttributes(password: newPassword));

  Future<void> resendSignupEmail(String email, {String? redirectTo}) =>
      _client.auth.resend(
        type: OtpType.signup,
        email: email.trim(),
        emailRedirectTo: redirectTo,
      );

  Future<AuthResponse> signInAnonymously() =>
      _client.auth.signInAnonymously();

  Future<void> requestPhoneOtp({
    required String phoneNumber,
    OtpChannel channel = OtpChannel.sms,
  }) => _client.auth.signInWithOtp(
        phone: phoneNumber.trim(),
        channel: channel,
      );

  Future<AuthResponse> verifyPhoneOtp({
    required String phoneNumber,
    required String token,
  }) => _client.auth.verifyOTP(
        phone: phoneNumber.trim(),
        token: token.trim(),
        type: OtpType.sms,
      );

  Future<bool> signInWithOAuth(
    OAuthProvider provider, {
    String? redirectTo,
    String? scopes,
  }) => _client.auth.signInWithOAuth(
        provider,
        redirectTo: redirectTo,
        scopes: scopes,
      );

  Future<Map<String, dynamic>?> getProfile(String userId) =>
      _client.from('profiles').select().eq('id', userId).maybeSingle();

  Future<Map<String, dynamic>?> getCurrentProfile() async {
    final user = currentUser;
    if (user == null) return null;
    return getProfile(user.id);
  }

  Future<void> signOut() => _client.auth.signOut();
}
