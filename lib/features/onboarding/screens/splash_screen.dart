import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../services/navigation_service.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _startSplash();
  }

  Future<void> _startSplash() async {
    // The splash screen always stays visible for five seconds.
    await Future<void>.delayed(const Duration(seconds: 5));
    if (!mounted) return;

    final destination = await _destinationAfterSplash();
    if (!mounted) return;

    Navigator.of(context).pushNamedAndRemoveUntil(
      destination,
      (route) => false,
    );
  }

  Future<String> _destinationAfterSplash() async {
    final user = FirebaseAuth.instance.currentUser;

    // No saved Firebase session: keep showing onboarding on every launch.
    if (user == null) {
      return AppRoutes.onboarding;
    }

    try {
      final snapshot = await FirebaseFirestore.instance
          .collection('users')
          .doc(user.uid)
          .get();
      final data = snapshot.data();

      // Only a fully completed account may bypass onboarding.
      if (data != null && data['setupComplete'] == true) {
        return AppRoutes.main;
      }
    } catch (_) {
      // If account state cannot be confirmed, never send the user to main.
    }

    // A signed-in but unfinished account must continue through the normal
    // onboarding/auth flow rather than being treated as a completed account.
    return AppRoutes.onboarding;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      body: Stack(
        fit: StackFit.expand,
        children: [
          Image.asset(
            'assets/images/splash_bg.png',
            fit: BoxFit.fill,
            gaplessPlayback: true,
          ),
          Positioned(
            left: 70,
            right: 70,
            bottom: 28,
            child: TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.0, end: 1.0),
              duration: const Duration(seconds: 5),
              builder: (context, value, child) {
                return Container(
                  height: 5,
                  decoration: BoxDecoration(
                    color: Colors.white24,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  alignment: Alignment.centerLeft,
                  child: FractionallySizedBox(
                    widthFactor: value,
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(20),
                        gradient: const LinearGradient(
                          colors: [
                            Color(0xFFFFD84D),
                            Color(0xFFFF3BD4),
                            Color(0xFF7B2CFF),
                          ],
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0xAAFF3BD4),
                            blurRadius: 8,
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
