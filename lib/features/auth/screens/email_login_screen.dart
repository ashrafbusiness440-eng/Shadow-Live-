import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

class EmailLoginScreen extends StatefulWidget {
  const EmailLoginScreen({super.key});

  @override
  State<EmailLoginScreen> createState() => _EmailLoginScreenState();
}

class _EmailLoginScreenState extends State<EmailLoginScreen> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _loading = false;
  bool _obscurePassword = true;
  bool _createAccount = false;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;

    if (email.isEmpty || !email.contains('@')) {
      _message('أدخل بريداً إلكترونياً صحيحاً');
      return;
    }

    if (password.length < 6) {
      _message('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    if (_createAccount) {
      final confirmPassword = _confirmPasswordController.text;

      if (confirmPassword.isEmpty) {
        _message('أعد كتابة كلمة المرور');
        return;
      }

      if (password != confirmPassword) {
        _message('كلمتا المرور غير متطابقتين');
        return;
      }
    }

    setState(() => _loading = true);

    try {
      if (_createAccount) {
        final credential =
            await FirebaseAuth.instance.createUserWithEmailAndPassword(
          email: email,
          password: password,
        );

        await FirebaseFirestore.instance
            .collection('users')
            .doc(credential.user!.uid)
            .set({
          'email': email,
          'setupStep': 'profile',
          'setupComplete': false,
          'createdAt': FieldValue.serverTimestamp(),
        }, SetOptions(merge: true));

        if (!mounted) return;
        Navigator.of(context).pushNamed(
          '/profile-setup',
        );
      } else {
        final credential =
            await FirebaseAuth.instance.signInWithEmailAndPassword(
          email: email,
          password: password,
        );

        final userDoc = await FirebaseFirestore.instance
            .collection('users')
            .doc(credential.user!.uid)
            .get();

        final data = userDoc.data();
        final setupComplete = data?['setupComplete'] == true;
        final setupStep = data?['setupStep'] as String?;

        if (!mounted) return;

        if (setupComplete || setupStep == 'complete') {
          Navigator.of(context).pushNamedAndRemoveUntil(
            '/main',
            (route) => false,
          );
        } else {
          final destination = switch (setupStep) {
            'success' => '/account-success',
            'linking' => '/account-linking',
            'ready' => '/account-ready',
            'profile' || null => '/profile-setup',
            _ => '/profile-setup',
          };

          Navigator.of(context).pushNamedAndRemoveUntil(
            destination,
            (route) => false,
          );
        }
      }
    } on FirebaseAuthException catch (e) {
      String message = 'حدث خطأ، حاول مرة أخرى';

      switch (e.code) {
        case 'email-already-in-use':
          message = 'هذا البريد مستخدم مسبقاً';
          break;
        case 'invalid-email':
          message = 'البريد الإلكتروني غير صحيح';
          break;
        case 'weak-password':
          message = 'كلمة المرور ضعيفة';
          break;
        case 'user-not-found':
        case 'invalid-credential':
          message = 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
          break;
        case 'wrong-password':
          message = 'كلمة المرور غير صحيحة';
          break;
      }

      _message(message);
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  void _message(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
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
            center: Alignment(0.65, -0.45),
            radius: 1.15,
            colors: [
              Color(0xFF251044),
              Color(0xFF07111F),
              Color(0xFF020711),
            ],
          ),
        ),
        child: SafeArea(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(24, 18, 24, 32),
            child: Directionality(
              textDirection: TextDirection.rtl,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withValues(alpha: 0.08),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.22),
                        ),
                      ),
                      child: IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: const Icon(
                          Icons.arrow_forward_ios_rounded,
                          color: Colors.white,
                          size: 21,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 35),
                  const Icon(
                    Icons.alternate_email_rounded,
                    color: Color(0xFFFFD54A),
                    size: 54,
                  ),
                  const SizedBox(height: 16),
                  Text(
                    _createAccount
                        ? 'إنشاء حساب بالبريد الإلكتروني'
                        : 'تسجيل الدخول بالبريد الإلكتروني',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 27,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(
                    _createAccount
                        ? 'أنشئ حساب Shadow Live باستخدام بريدك الإلكتروني'
                        : 'أدخل بريدك الإلكتروني وكلمة المرور للمتابعة',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white60,
                      fontSize: 15,
                      height: 1.6,
                    ),
                  ),
                  const SizedBox(height: 42),
                  TextField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                    ),
                    decoration: _decoration(
                      'البريد الإلكتروني',
                      Icons.email_outlined,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _passwordController,
                    obscureText: _obscurePassword,
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 17,
                    ),
                    decoration: _decoration(
                      'كلمة المرور',
                      Icons.lock_outline_rounded,
                    ).copyWith(
                      suffixIcon: IconButton(
                        onPressed: () {
                          setState(
                            () => _obscurePassword = !_obscurePassword,
                          );
                        },
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_off_outlined
                              : Icons.visibility_outlined,
                          color: Colors.white54,
                        ),
                      ),
                    ),
                  ),
                  if (_createAccount) ...[
                    const SizedBox(height: 16),
                    TextField(
                      controller: _confirmPasswordController,
                      obscureText: _obscurePassword,
                      textDirection: TextDirection.rtl,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 17,
                      ),
                      decoration: _decoration(
                        'تأكيد كلمة المرور',
                        Icons.lock_reset_rounded,
                      ),
                    ),
                  ],
                  const SizedBox(height: 30),
                  SizedBox(
                    height: 58,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        gradient: const LinearGradient(
                          colors: [
                            Color(0xFF8A00FF),
                            Color(0xFFFF00D4),
                          ],
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x558A00FF),
                            blurRadius: 20,
                            spreadRadius: 1,
                          ),
                        ],
                      ),
                      child: TextButton(
                        onPressed: _loading ? null : _submit,
                        child: _loading
                            ? const SizedBox(
                                width: 25,
                                height: 25,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2.5,
                                  color: Colors.white,
                                ),
                              )
                            : Text(
                                _createAccount
                                    ? 'إنشاء الحساب'
                                    : 'تسجيل الدخول',
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 19,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  TextButton(
                    onPressed: () {
                      setState(() => _createAccount = !_createAccount);
                    },
                    child: Text(
                      _createAccount
                          ? 'لديك حساب بالفعل؟ تسجيل الدخول'
                          : 'ليس لديك حساب؟ إنشاء حساب جديد',
                      style: const TextStyle(
                        color: Color(0xFFFFD54A),
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _decoration(String hint, IconData icon) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: Colors.white38),
      prefixIcon: Icon(icon, color: const Color(0xFFFFD54A)),
      filled: true,
      fillColor: const Color(0xFF0C1728),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 18,
        vertical: 19,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(color: Color(0xFF263A57)),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFF9D28FF),
          width: 1.5,
        ),
      ),
    );
  }
}
