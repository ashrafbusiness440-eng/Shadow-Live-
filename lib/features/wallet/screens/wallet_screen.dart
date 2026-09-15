import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

class WalletScreen extends StatelessWidget {
  const WalletScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        appBar: AppBar(
          backgroundColor: const Color(0xFF090A11),
          title: const Text('محفظتي', style: TextStyle(fontWeight: FontWeight.w900)),
          centerTitle: true,
        ),
        body: user == null
            ? const Center(child: Text('سجّل الدخول لعرض المحفظة'))
            : StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                stream: FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
                builder: (context, snapshot) {
                  final data = snapshot.data?.data() ?? const <String, dynamic>{};
                  final coins = data['coins'] ?? data['balance'] ?? 0;
                  final diamonds = data['diamonds'] ?? 0;
                  return ListView(
                    padding: const EdgeInsets.all(18),
                    children: [
                      Container(
                        padding: const EdgeInsets.all(22),
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(24),
                          gradient: const LinearGradient(colors: [Color(0xFF24103E), Color(0xFF0C1022)]),
                          border: Border.all(color: const Color(0xFFFFC84A).withValues(alpha: .35)),
                        ),
                        child: Column(children: [
                          const Icon(Icons.account_balance_wallet_rounded, color: Color(0xFFFFC84A), size: 44),
                          const SizedBox(height: 12),
                          const Text('رصيدك', style: TextStyle(color: Colors.white70, fontSize: 15)),
                          const SizedBox(height: 8),
                          Text('$coins عملة', style: const TextStyle(color: Colors.white, fontSize: 28, fontWeight: FontWeight.w900)),
                          const SizedBox(height: 6),
                          Text('$diamonds ألماسة', style: const TextStyle(color: Color(0xFFB58CFF), fontWeight: FontWeight.w700)),
                        ]),
                      ),
                      const SizedBox(height: 18),
                      _ActionCard(icon: Icons.add_card_rounded, title: 'شحن الرصيد', subtitle: 'شراء العملات والماس', onTap: () => Navigator.of(context).pushNamed('/recharge')),
                      const SizedBox(height: 12),
                      const _ActionCard(icon: Icons.receipt_long_rounded, title: 'سجل العمليات', subtitle: 'عمليات الشحن والهدايا والتحويلات'),
                    ],
                  );
                },
              ),
      ),
    );
  }
}

class _ActionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;
  const _ActionCard({required this.icon, required this.title, required this.subtitle, this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: const Color(0xFF111321),
        borderRadius: BorderRadius.circular(18),
        child: ListTile(
          onTap: onTap,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          leading: Icon(icon, color: const Color(0xFFFFC84A)),
          title: Text(title, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          subtitle: Text(subtitle, style: const TextStyle(color: Colors.white54)),
          trailing: const Icon(Icons.chevron_left_rounded, color: Colors.white38),
        ),
      );
}
