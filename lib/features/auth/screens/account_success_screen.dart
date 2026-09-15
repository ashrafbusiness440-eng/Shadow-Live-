import 'package:flutter/material.dart';

class AccountSuccessScreen extends StatelessWidget {
  const AccountSuccessScreen({super.key});

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
                        colors: [
                          Color(0xFF8A00FF),
                          Color(0xFFFF00D4),
                        ],
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
                      boxShadow: const [
                        BoxShadow(
                          color: Color(0x558A00FF),
                          blurRadius: 22,
                        ),
                      ],
                    ),
                    child: TextButton(
                      onPressed: () {
                        Navigator.of(context)
                            .pushReplacementNamed('/account-linking');
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
