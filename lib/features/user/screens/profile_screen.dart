import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../../services/navigation_service.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          child: user == null
              ? _guest(context)
              : StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                  stream: FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
                  builder: (context, snapshot) {
                    final d = snapshot.data?.data() ?? const <String, dynamic>{};
                    final name = (d['displayName'] ?? d['name'] ?? user.displayName ?? 'مستخدم Shadow Live').toString();
                    final photo = (d['photoUrl'] ?? d['photoURL'] ?? user.photoURL ?? '').toString();
                    final cover = (d['coverUrl'] ?? '').toString();
                    final id = (d['numericId'] ?? d['userId'] ?? user.uid.substring(0, user.uid.length > 8 ? 8 : user.uid.length)).toString();
                    final bio = (d['bio'] ?? 'أهلاً بك في Shadow Live').toString();
                    final location = (d['country'] ?? d['location'] ?? 'الإمارات').toString();
                    return ListView(
                      padding: EdgeInsets.zero,
                      children: [
                        _brandHeader(context),
                        _coverAndAvatar(cover, photo),
                        const SizedBox(height: 48),
                        Text(name, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 5),
                        Text('ID: $id  •  $location', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white54)),
                        const SizedBox(height: 8),
                        Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(bio, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70))),
                        const SizedBox(height: 18),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Row(children: [
                            Expanded(child: _button(Icons.edit_rounded, 'تعديل الملف', () {})),
                            const SizedBox(width: 10),
                            Expanded(child: _button(Icons.workspace_premium_rounded, 'VIP', () {})),
                            const SizedBox(width: 10),
                            Expanded(child: _button(Icons.apartment_rounded, 'الوكالة', () {})),
                          ]),
                        ),
                        const SizedBox(height: 16),
                        _stats(d),
                        const SizedBox(height: 16),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Row(children: [
                            Expanded(child: _quick(Icons.account_balance_wallet_rounded, 'محفظتي', () => NavigationService.navigateTo(AppRoutes.wallet))),
                            const SizedBox(width: 10),
                            Expanded(child: _quick(Icons.add_card_rounded, 'شحن', () => NavigationService.navigateTo(AppRoutes.recharge))),
                            const SizedBox(width: 10),
                            Expanded(child: _quick(Icons.card_giftcard_rounded, 'الهدايا', () {})),
                          ]),
                        ),
                        const SizedBox(height: 28),
                      ],
                    );
                  },
                ),
        ),
      ),
    );
  }

  Widget _guest(BuildContext context) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Icon(Icons.person_outline_rounded, color: Color(0xFFFFC84A), size: 64),
    const SizedBox(height: 14),
    const Text('أنت داخل كضيف', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
    const SizedBox(height: 14),
    ElevatedButton(onPressed: () => NavigationService.navigateToAndRemoveUntil(AppRoutes.authChoice), child: const Text('العودة لتسجيل الدخول')),
  ]));

  Widget _brandHeader(BuildContext context) => Container(
    height: 82,
    padding: const EdgeInsets.symmetric(horizontal: 14),
    decoration: const BoxDecoration(color: Color(0xFF090A11)),
    child: Row(children: [
      Image.asset('assets/images/profile/profile_header_logo.png', width: 145, fit: BoxFit.contain),
      const Spacer(),
      IconButton(onPressed: () => NavigationService.navigateTo(AppRoutes.settings), icon: const Icon(Icons.settings_rounded, color: Color(0xFFFFC84A))),
    ]),
  );

  Widget _coverAndAvatar(String cover, String photo) => SizedBox(
    height: 210,
    child: Stack(clipBehavior: Clip.none, children: [
      Positioned.fill(child: cover.isEmpty ? Image.asset('assets/images/profile/default_profile_cover.png', fit: BoxFit.cover) : Image.network(cover, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Image.asset('assets/images/profile/default_profile_cover.png', fit: BoxFit.cover))),
      Positioned(bottom: -42, left: 0, right: 0, child: Center(child: Container(
        padding: const EdgeInsets.all(4),
        decoration: const BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [Color(0xFFFFC84A), Color(0xFF8A3DFF)])),
        child: CircleAvatar(radius: 48, backgroundColor: const Color(0xFF151526), backgroundImage: photo.isEmpty ? null : NetworkImage(photo), child: photo.isEmpty ? const Icon(Icons.person_rounded, size: 52, color: Colors.white70) : null),
      ))),
    ]),
  );

  Widget _button(IconData icon, String label, VoidCallback tap) => OutlinedButton.icon(
    onPressed: tap, icon: Icon(icon, size: 18), label: FittedBox(child: Text(label)),
    style: OutlinedButton.styleFrom(foregroundColor: const Color(0xFFFFC84A), side: BorderSide(color: const Color(0xFFFFC84A).withValues(alpha: .35)), padding: const EdgeInsets.symmetric(vertical: 13)),
  );

  Widget _stats(Map<String, dynamic> d) => Container(
    margin: const EdgeInsets.symmetric(horizontal: 16), padding: const EdgeInsets.symmetric(vertical: 16),
    decoration: BoxDecoration(color: const Color(0xFF10121D), borderRadius: BorderRadius.circular(20)),
    child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
      _stat('${d['followersCount'] ?? d['followers'] ?? 0}', 'متابعون'),
      _stat('${d['followingCount'] ?? d['following'] ?? 0}', 'أتابع'),
      _stat('${d['roomsCount'] ?? 0}', 'غرف'),
      _stat('${d['giftsCount'] ?? d['totalGiftsReceived'] ?? 0}', 'هدايا'),
    ]),
  );

  Widget _stat(String value, String label) => Column(children: [Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 17)), const SizedBox(height: 4), Text(label, style: const TextStyle(color: Colors.white54, fontSize: 11))]);

  Widget _quick(IconData icon, String label, VoidCallback tap) => Material(
    color: const Color(0xFF111321), borderRadius: BorderRadius.circular(18),
    child: InkWell(onTap: tap, borderRadius: BorderRadius.circular(18), child: Padding(padding: const EdgeInsets.symmetric(vertical: 18, horizontal: 6), child: Column(children: [Icon(icon, color: const Color(0xFFFFC84A), size: 27), const SizedBox(height: 7), Text(label, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700))]))),
  );
}
