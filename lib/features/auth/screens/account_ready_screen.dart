import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class AccountReadyScreen extends StatelessWidget {
  const AccountReadyScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF020711),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0, -0.2),
            radius: 1.2,
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
                        colors: [
                          Color(0xFF8A00FF),
                          Color(0xFFFF00D4),
                        ],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: Color(0x668A00FF),
                          blurRadius: 50,
                          spreadRadius: 8,
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
                        Icons.verified_user_rounded,
                        size: 82,
                        color: Colors.white,
                      ),
                    ),
                  ),
                  const SizedBox(height: 40),
                  const Text(
                    'أنت الآن جاهز!',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 30,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 18),
                  const Text(
                    'استمتع بتجربة Shadow Live الكاملة وتعرّف على أصدقاء جدد',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white60,
                      fontSize: 17,
                      height: 1.6,
                    ),
                  ),
                  const Spacer(flex: 4),
                  Container(
                    width: double.infinity,
                    height: 58,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(17),
                      gradient: const LinearGradient(
                        colors: [
                          Color(0xFF8A00FF),
                          Color(0xFFFF00D4),
                        ],
                      ),
                    ),
                    child: TextButton(
                      onPressed: () async {
                        final user = FirebaseAuth.instance.currentUser;
                        if (user == null) return;

                        await FirebaseFirestore.instance
                            .collection('users')
                            .doc(user.uid)
                            .set({
                          'setupStep': 'complete',
                          'setupComplete': true,
                          'onboardingComplete': true,
                          'updatedAt': FieldValue.serverTimestamp(),
                        }, SetOptions(merge: true));

                        if (!context.mounted) return;

                        Navigator.of(context)
                            .pushNamedAndRemoveUntil('/main', (route) => false);
                      },
                      child: const Text(
                        'ابدأ الاستكشاف',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 19,
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
