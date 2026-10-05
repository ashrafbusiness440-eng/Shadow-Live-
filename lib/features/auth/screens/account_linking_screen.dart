import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../shared/services/firebase_service.dart';
import '../services/auth_login_config.dart';

class AccountLinkingScreen extends StatefulWidget {
  const AccountLinkingScreen({super.key});

  @override
  State<AccountLinkingScreen> createState() => _AccountLinkingScreenState();
}

class _AccountLinkingScreenState extends State<AccountLinkingScreen> {
  final FirebaseService _firebase = FirebaseService();
  bool _saving = false;
  bool _checkingLinkingPolicy = true;
  bool _linkingEnabled = false;
  AuthLoginConfig _loginConfig = AuthLoginConfig.defaults;
  String? _error;

  @override
  void initState() {
    super.initState();
    _resolveLinkingPolicy();
  }

  Future<void> _resolveLinkingPolicy() async {
    final config = await AuthLoginConfigService.load(refresh: true);
    if (!mounted) return;
    final hasLinkableProvider =
        config.phone || config.google || config.apple || config.facebook;
    if (config.optionalAccountLinking && hasLinkableProvider) {
      setState(() {
        _loginConfig = config;
        _linkingEnabled = true;
        _checkingLinkingPolicy = false;
      });
      return;
    }

    setState(() {
      _loginConfig = config;
      _linkingEnabled = false;
    });
    await _continueLater();
    if (mounted) setState(() => _checkingLinkingPolicy = false);
  }

  bool _isLinked(String providerId) {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return false;
    if (providerId == 'phone') {
      return user.phoneNumber != null && user.phoneNumber!.isNotEmpty;
    }
    return user.providerData.any((provider) => provider.providerId == providerId);
  }

  void _comingSoon(String provider) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('ربط $provider سيتم تفعيله لاحقاً')),
    );
  }

  Future<void> _continueLater() async {
    if (_saving) return;
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      setState(() => _error = 'انتهت جلسة تسجيل الدخول، سجّل الدخول من جديد');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _firebase.updateUserProfile(user.uid, {
        'setupStep': 'ready',
        'setupComplete': false,
      }).timeout(const Duration(seconds: 12));
      if (!mounted) return;
      Navigator.of(context).pushReplacementNamed('/account-ready');
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'تعذر حفظ التقدم. تحقق من الاتصال وحاول مجدداً.');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _linkRow({
    required IconData icon,
    required String title,
    required String providerId,
    required VoidCallback onTap,
  }) {
    final linked = _isLinked(providerId);
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      decoration: BoxDecoration(
        color: const Color(0xFF111827),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: Colors.white12),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8),
        leading: Container(
          width: 46,
          height: 46,
          decoration: BoxDecoration(
            color: Colors.white.withValues(alpha: 0.08),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: Colors.white, size: 27),
        ),
        title: Text(title, style: const TextStyle(color: Colors.white, fontSize: 17, fontWeight: FontWeight.w700)),
        trailing: linked
            ? const Row(mainAxisSize: MainAxisSize.min, children: [
                Text('مرتبط', style: TextStyle(color: Color(0xFF5CFF9D), fontWeight: FontWeight.w700)),
                SizedBox(width: 7),
                Icon(Icons.check_circle_rounded, color: Color(0xFF5CFF9D), size: 28),
              ])
            : const Icon(Icons.add_circle_outline_rounded, color: Color(0xFFFFD54A), size: 27),
        onTap: linked || _saving ? null : onTap,
      ),
    );
  }

  Widget _disabledLinkingGate() {
    return Scaffold(
      backgroundColor: const Color(0xFF020711),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: _error == null
              ? const CircularProgressIndicator()
              : Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.error_outline_rounded,
                        color: Colors.orangeAccent, size: 44),
                    const SizedBox(height: 12),
                    Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white70),
                    ),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _saving ? null : _resolveLinkingPolicy,
                      child: const Text('إعادة المحاولة'),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_checkingLinkingPolicy || !_linkingEnabled) {
      return _disabledLinkingGate();
    }
    return Scaffold(
      backgroundColor: const Color(0xFF020711),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.3),
            radius: 1.2,
            colors: [Color(0xFF251044), Color(0xFF07111F), Color(0xFF020711)],
          ),
        ),
        child: SafeArea(
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 24),
              child: ListView(
                physics: const BouncingScrollPhysics(),
                padding: EdgeInsets.zero,
                children: [
                  const SizedBox(height: 60),
                  const Icon(Icons.link_rounded, size: 76, color: Color(0xFFFFD54A)),
                  const SizedBox(height: 28),
                  const Text('ربط الحسابات (اختياري)', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 27, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 12),
                  const Text('اربط حساباتك لسهولة الدخول لاحقاً', textAlign: TextAlign.center, style: TextStyle(color: Colors.white60, fontSize: 16)),
                  const SizedBox(height: 45),
                  if (_loginConfig.phone)
                    _linkRow(icon: Icons.phone_rounded, title: 'ربط رقم الهاتف', providerId: 'phone', onTap: () => _comingSoon('رقم الهاتف')),
                  if (_loginConfig.google)
                    _linkRow(icon: Icons.g_mobiledata_rounded, title: 'ربط Google', providerId: 'google.com', onTap: () => _comingSoon('Google')),
                  if (_loginConfig.apple)
                    _linkRow(icon: Icons.apple_rounded, title: 'ربط Apple', providerId: 'apple.com', onTap: () => _comingSoon('Apple')),
                  if (_loginConfig.facebook)
                    _linkRow(icon: Icons.facebook_rounded, title: 'ربط Facebook', providerId: 'facebook.com', onTap: () => _comingSoon('Facebook')),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.w700)),
                  ],
                  const SizedBox(height: 30),
                  SizedBox(
                    width: double.infinity,
                    height: 58,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(17),
                        gradient: const LinearGradient(colors: [Color(0xFF8A00FF), Color(0xFFFF00D4)]),
                      ),
                      child: TextButton(
                        onPressed: _saving ? null : _continueLater,
                        child: _saving
                            ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('لاحقاً', style: TextStyle(color: Colors.white, fontSize: 19, fontWeight: FontWeight.w900)),
                      ),
                    ),
                  ),
                  const SizedBox(height: 28),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
