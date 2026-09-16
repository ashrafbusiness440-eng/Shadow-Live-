import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

class AccountSuccessScreen extends StatefulWidget {
  const AccountSuccessScreen({super.key});

  @override
  State<AccountSuccessScreen> createState() => _AccountSuccessScreenState();
}

class _AccountSuccessScreenState extends State<AccountSuccessScreen> {
  String? _publicId;
  String? _idError;
  bool _creatingId = true;

  @override
  void initState() {
    super.initState();
    _ensurePublicId();
  }

  Future<void> _ensurePublicId() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      if (mounted) {
        setState(() {
          _creatingId = false;
          _idError = 'تعذر إنشاء ID: المستخدم غير مسجل الدخول';
        });
      }
      return;
    }

    final firestore = FirebaseFirestore.instance;
    final userRef = firestore.collection('users').doc(user.uid);
    final random = Random.secure();

    try {
      for (var attempt = 0; attempt < 12; attempt++) {
        final candidate = (100000000 + random.nextInt(900000000)).toString();
        final idRef = firestore.collection('publicIds').doc(candidate);

        final result = await firestore.runTransaction<String?>((transaction) async {
          final userSnapshot = await transaction.get(userRef);
          final existingId = userSnapshot.data()?['publicId'] as String?;

          if (existingId != null && existingId.isNotEmpty) {
            return existingId;
          }

          final idSnapshot = await transaction.get(idRef);
          if (idSnapshot.exists) return null;

          transaction.set(idRef, {
            'uid': user.uid,
            'createdAt': FieldValue.serverTimestamp(),
          });
          transaction.set(
            userRef,
            {
              'publicId': candidate,
              'updatedAt': FieldValue.serverTimestamp(),
            },
            SetOptions(merge: true),
          );
          return candidate;
        });

        if (result != null) {
          if (mounted) {
            setState(() {
              _publicId = result;
              _creatingId = false;
              _idError = null;
            });
          }
          return;
        }
      }

      throw Exception('PUBLIC_ID_GENERATION_FAILED');
    } catch (_) {
      if (mounted) {
        setState(() {
          _creatingId = false;
          _idError = 'تعذر إنشاء ID الآن، حاول مرة أخرى';
        });
      }
    }
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
            center: Alignment(0, -0.15),
            radius: 1.15,
            colors: [
              Color(0xFF251044),
              Color(0xFF07111F),
              Color(0xFF020711),
            ],
          ),
        ),
        child: SafeArea(
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 26),
              child: Column(
                children: [
                  const Spacer(flex: 3),
                  Container(
                    width: 150,
                    height: 150,
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [Color(0xFF8A00FF), Color(0xFFFF00D4)],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Color(0x778A00FF),
                          blurRadius: 45,
                          spreadRadius: 8,
                        ),
                        BoxShadow(
                          color: Color(0x44FF00D4),
                          blurRadius: 70,
                          spreadRadius: 12,
                        ),
                      ],
                    ),
                    child: Container(
                      margin: const EdgeInsets.all(5),
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: const Color(0xFF11182A),
                        border: Border.all(
                          color: const Color(0xFFFFD54A),
                          width: 2,
                        ),
                      ),
                      child: const Icon(
                        Icons.check_rounded,
                        size: 88,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: 42),
                  const Text(
                    'تم إنشاء حسابك بنجاح! 🎉',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 28,
                      height: 1.3,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'مرحباً بك في Shadow Live',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Color(0xFFFFD54A),
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'لنبدأ رحلتك الآن',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white60,
                      fontSize: 17,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 18),
                  if (_creatingId)
                    const Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                        SizedBox(width: 10),
                        Text(
                          'جاري إنشاء ID الحساب...',
                          style: TextStyle(color: Colors.white60),
                        ),
                      ],
                    )
                  else if (_publicId != null)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 18,
                        vertical: 11,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF0C1728),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(color: const Color(0xFF6F3AA8)),
                      ),
                      child: Text(
                        'ID: $_publicId',
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          letterSpacing: 1.2,
                        ),
                      ),
                    )
                  else
                    TextButton.icon(
                      onPressed: _ensurePublicId,
                      icon: const Icon(Icons.refresh_rounded),
                      label: Text(_idError ?? 'إعادة محاولة إنشاء ID'),
                    ),
                  const Spacer(flex: 4),
                  Container(
                    width: double.infinity,
                    height: 58,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(17),
                      gradient: const LinearGradient(
                        colors: [Color(0xFF8A00FF), Color(0xFFFF00D4)],
                      ),
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x558A00FF),
                          blurRadius: 22,
                        ),
                      ],
                    ),
                    child: TextButton(
                      onPressed: _creatingId || _publicId == null
                          ? null
                          : () {
                              Navigator.of(context).pushReplacementNamed(
                                '/account-linking',
                              );
                            },
                      child: const Text(
                        'التالي',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                        ),
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
