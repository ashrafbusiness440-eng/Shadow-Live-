import 'dart:convert';
import 'dart:math';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:crypto/crypto.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

class DiamondPasswordResetScreen extends StatefulWidget {
  const DiamondPasswordResetScreen({super.key});
  @override
  State<DiamondPasswordResetScreen> createState() => _DiamondPasswordResetScreenState();
}

class _DiamondPasswordResetScreenState extends State<DiamondPasswordResetScreen> {
  final _phone = TextEditingController();
  final _otp = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  String? _verificationId;
  ConfirmationResult? _webConfirmation;
  bool _otpVerified = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _phone.text = FirebaseAuth.instance.currentUser?.phoneNumber ?? '';
  }

  @override
  void dispose() {
    _phone.dispose(); _otp.dispose(); _password.dispose(); _confirm.dispose();
    super.dispose();
  }

  void _message(String text) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));

  Future<void> _sendOtp() async {
    final user = FirebaseAuth.instance.currentUser;
    final linkedPhone = user?.phoneNumber;
    final entered = _phone.text.trim();
    if (user == null || linkedPhone == null || linkedPhone.isEmpty) { _message('هذا الحساب غير مربوط برقم هاتف.'); return; }
    if (entered != linkedPhone) { _message('يجب إدخال رقم الهاتف المرتبط بالحساب نفسه.'); return; }
    setState(() => _busy = true);
    try {
      if (kIsWeb) {
        _webConfirmation = await FirebaseAuth.instance.signInWithPhoneNumber(entered);
        if (mounted) _message('تم إرسال رمز التحقق.');
      } else {
        await FirebaseAuth.instance.verifyPhoneNumber(
          phoneNumber: entered,
          verificationCompleted: (credential) async { await user.reauthenticateWithCredential(credential); if (mounted) setState(() => _otpVerified = true); },
          verificationFailed: (e) { if (mounted) _message(e.message ?? 'تعذر إرسال رمز التحقق.'); },
          codeSent: (id, _) { if (mounted) { setState(() => _verificationId = id); _message('تم إرسال رمز التحقق.'); } },
          codeAutoRetrievalTimeout: (id) => _verificationId = id,
        );
      }
    } on FirebaseAuthException catch (e) { _message(e.message ?? 'تعذر إرسال رمز التحقق.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _verifyOtp() async {
    final code = _otp.text.trim();
    if (code.length < 6) { _message('أدخل رمز التحقق كاملاً.'); return; }
    setState(() => _busy = true);
    try {
      if (kIsWeb) {
        final result = _webConfirmation;
        if (result == null) { _message('أرسل رمز التحقق أولاً.'); return; }
        await result.confirm(code);
      } else {
        final id = _verificationId;
        if (id == null) { _message('أرسل رمز التحقق أولاً.'); return; }
        final credential = PhoneAuthProvider.credential(verificationId: id, smsCode: code);
        await FirebaseAuth.instance.currentUser!.reauthenticateWithCredential(credential);
      }
      if (mounted) setState(() => _otpVerified = true);
    } on FirebaseAuthException catch (e) { _message(e.message ?? 'رمز التحقق غير صحيح.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _savePassword() async {
    if (!_otpVerified) { _message('تحقق من رقم الهاتف أولاً.'); return; }
    final p = _password.text;
    if (p.length < 6) { _message('كلمة السر يجب أن تكون 6 خانات على الأقل.'); return; }
    if (p != _confirm.text) { _message('كلمتا السر غير متطابقتين.'); return; }
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return;
    setState(() => _busy = true);
    try {
      final random = Random.secure();
      final salt = List<int>.generate(24, (_) => random.nextInt(256));
      final saltText = base64UrlEncode(salt);
      final hash = sha256.convert(utf8.encode('$saltText:$p')).toString();
      await FirebaseFirestore.instance.collection('users').doc(user.uid).set({
        'diamondPasswordHash': hash,
        'diamondPasswordSalt': saltText,
        'diamondPasswordSet': true,
        'diamondPasswordUpdatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));
      if (mounted) { _message('تم تغيير كلمة سر الألماس.'); Navigator.pop(context, true); }
    } on FirebaseException catch (e) { _message(e.code == 'permission-denied' ? 'صلاحيات Firestore تمنع الحفظ حالياً.' : 'تعذر حفظ كلمة السر.'); }
    finally { if (mounted) setState(() => _busy = false); }
  }

  @override
  Widget build(BuildContext context) => Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: const Color(0xFF050814),
      appBar: AppBar(backgroundColor: const Color(0xFF0B1322), title: const Text('تغيير كلمة سر الألماس')),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        const Icon(Icons.diamond_rounded, size: 64, color: Color(0xFF66E1FF)),
        const SizedBox(height: 14),
        const Text('للأمان، يجب التحقق من رقم الهاتف المرتبط بالحساب قبل تغيير كلمة سر معاملات الألماس.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, height: 1.5)),
        const SizedBox(height: 24),
        _field(_phone, 'رقم الهاتف المرتبط بالحساب', Icons.phone_rounded, enabled: !_otpVerified),
        const SizedBox(height: 12),
        FilledButton(onPressed: _busy || _otpVerified ? null : _sendOtp, child: const Text('إرسال OTP')),
        const SizedBox(height: 14),
        if (!_otpVerified) ...[
          _field(_otp, 'رمز التحقق OTP', Icons.password_rounded, keyboard: TextInputType.number),
          const SizedBox(height: 12),
          OutlinedButton(onPressed: _busy ? null : _verifyOtp, child: const Text('تحقق من الرمز')),
        ],
        if (_otpVerified) ...[
          const Text('✓ تم التحقق من رقم الهاتف', style: TextStyle(color: Colors.greenAccent, fontWeight: FontWeight.bold)),
          const SizedBox(height: 18),
          _field(_password, 'كلمة السر الجديدة', Icons.lock_rounded, obscure: true),
          const SizedBox(height: 12),
          _field(_confirm, 'تأكيد كلمة السر الجديدة', Icons.lock_outline_rounded, obscure: true),
          const SizedBox(height: 20),
          FilledButton(onPressed: _busy ? null : _savePassword, style: FilledButton.styleFrom(backgroundColor: const Color(0xFF8B5CF6), minimumSize: const Size.fromHeight(52)), child: Text(_busy ? 'جارِ الحفظ...' : 'حفظ كلمة السر الجديدة')),
        ],
      ]),
    ),
  );

  Widget _field(TextEditingController c, String hint, IconData icon, {bool enabled = true, bool obscure = false, TextInputType? keyboard}) => TextField(
    controller: c, enabled: enabled, obscureText: obscure, keyboardType: keyboard, style: const TextStyle(color: Colors.white),
    decoration: InputDecoration(prefixIcon: Icon(icon, color: const Color(0xFF8B5CF6)), hintText: hint, hintStyle: const TextStyle(color: Colors.white38), filled: true, fillColor: const Color(0xFF101827), border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none)),
  );
}
