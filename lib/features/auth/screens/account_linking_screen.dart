import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../shared/services/firebase_service.dart';

class AccountLinkingScreen extends StatefulWidget {
  const AccountLinkingScreen({super.key});

  @override
  State<AccountLinkingScreen> createState() => _AccountLinkingScreenState();
}

class _AccountLinkingScreenState extends State<AccountLinkingScreen> {
  final FirebaseService _firebase = FirebaseService();
  bool _saving = false;
  String? _error;

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

  @override
  Widget build(BuildContext context) {
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
                  _linkRow(icon: Icons.phone_rounded, title: 'ربط رقم الهاتف', providerId: 'phone', onTap: () => _comingSoon('رقم الهاتف')),
                  _linkRow(icon: Icons.g_mobiledata_rounded, title: 'ربط Google', providerId: 'google.com', onTap: () => _comingSoon('Google')),
                  _linkRow(icon: Icons.apple_rounded, title: 'ربط Apple', providerId: 'apple.com', onTap: () => _comingSoon('Apple')),
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
