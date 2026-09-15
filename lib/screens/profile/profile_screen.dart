import 'package:flutter/material.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../services/navigation_service.dart';
import '../../widgets/bottom_nav_bar.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  static const bg = Color(0xFF050713);
  static const card = Color(0xFF0C1020);
  static const purple = Color(0xFF9A35FF);
  static const gold = Color(0xFFFFC85A);

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: bg,
        bottomNavigationBar: const BottomNavBar(currentIndex: 2),
        body: user == null ? _body(context, const <String, dynamic>{}, null) : StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          stream: FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
          builder: (context, snap) => _body(context, snap.data?.data() ?? const <String, dynamic>{}, user),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, Map<String, dynamic> data, User? user) {
    final name = (data['displayName'] ?? data['name'] ?? user?.displayName ?? 'مستخدم Shadow Live').toString();
    final photo = (data['photoUrl'] ?? data['photoURL'] ?? user?.photoURL ?? '').toString();
    final cover = (data['coverUrl'] ?? '').toString();
    final id = (data['numericId'] ?? data['userId'] ?? user?.uid.substring(0, user.uid.length > 8 ? 8 : user.uid.length) ?? '--------').toString();
    final country = (data['country'] ?? data['location'] ?? 'الإمارات العربية المتحدة').toString();
    final bio = (data['bio'] ?? 'كن كما أنت .. فالعالم يحتاج لصوتك الحقيقي').toString();
    final level = (data['level'] ?? 1).toString();
    return SafeArea(child: SingleChildScrollView(child: Column(children: [
      _brandHeader(context),
      _cover(cover),
      Transform.translate(offset: const Offset(0, -52), child: _identity(context, name, photo, id, country, bio, level)),
      Transform.translate(offset: const Offset(0, -34), child: Column(children: [
        _stats(data), const SizedBox(height: 15), _actions(context), const SizedBox(height: 18), _tabs(), const SizedBox(height: 14), _post(), const SizedBox(height: 24),
      ])),
    ])));
  }

  Widget _brandHeader(BuildContext context) => Container(
    height: 92, padding: const EdgeInsets.symmetric(horizontal: 16), color: bg,
    child: Row(children: [
      Expanded(child: Align(alignment: Alignment.centerRight, child: Image.asset('assets/images/profile/profile_header_logo.png', height: 70, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Text('👑  SHADOW LIVE', style: TextStyle(color: gold, fontSize: 20, fontWeight: FontWeight.w900))))),
      _round(Icons.notifications_none_rounded, () {}), const SizedBox(width: 8), _round(Icons.settings_rounded, () => NavigationService.navigateTo(AppRoutes.settings)),
    ]),
  );

  Widget _cover(String url) => SizedBox(height: 205, width: double.infinity, child: url.isNotEmpty
    ? CachedNetworkImage(imageUrl: url, fit: BoxFit.cover, errorWidget: (_, __, ___) => _defaultCover())
    : _defaultCover());

  Widget _defaultCover() => Image.asset('assets/images/profile/default_profile_cover.png', fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(decoration: const BoxDecoration(gradient: LinearGradient(colors: [Color(0xFF26114D), bg]))));

  Widget _identity(BuildContext context, String name, String photo, String id, String country, String bio, String level) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 18), child: Column(children: [
      Stack(clipBehavior: Clip.none, children: [
        Container(width: 116, height: 116, padding: const EdgeInsets.all(3), decoration: const BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [gold, purple])), child: ClipOval(child: photo.isNotEmpty ? CachedNetworkImage(imageUrl: photo, fit: BoxFit.cover, errorWidget: (_, __, ___) => _avatarFallback()) : _avatarFallback())),
        Positioned(bottom: 5, left: 4, child: Container(width: 20, height: 20, decoration: BoxDecoration(color: const Color(0xFF20D66B), shape: BoxShape.circle, border: Border.all(color: bg, width: 3)))),
      ]),
      const SizedBox(height: 8),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [Text(name, style: const TextStyle(color: Colors.white, fontSize: 25, fontWeight: FontWeight.w900)), const SizedBox(width: 6), const Icon(Icons.verified_rounded, color: Color(0xFF665CFF), size: 22)]),
      const SizedBox(height: 4), Text('ID: $id   •   Lv. $level', textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white60, fontSize: 13)),
      const SizedBox(height: 7), Text('📍 $country', style: const TextStyle(color: Colors.white60, fontSize: 12)), const SizedBox(height: 7), Text(bio, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFC9C1DB), fontSize: 13)),
      const SizedBox(height: 14), Row(children: [
        Expanded(child: _smallButton('تعديل الملف', Icons.edit_rounded, purple, Colors.white, () {})), const SizedBox(width: 9),
        Expanded(child: _smallButton('الوكالة', Icons.groups_rounded, const Color(0xFF261A0B), gold, () {})), const SizedBox(width: 9),
        Expanded(child: _smallButton('VIP', Icons.workspace_premium_rounded, const Color(0xFF261A0B), gold, () {})),
      ]),
    ]),
  );

  Widget _avatarFallback() => Container(color: const Color(0xFF17132A), child: const Icon(Icons.person_rounded, size: 64, color: Colors.white38));

  Widget _stats(Map<String, dynamic> d) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Container(padding: const EdgeInsets.symmetric(vertical: 16), decoration: _box(), child: Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [
    _Stat('${d['followersCount'] ?? 0}', 'المتابعون'), _Stat('${d['followingCount'] ?? 0}', 'أتابع'), _Stat('${d['roomsCount'] ?? 0}', 'الغرف'), _Stat('${d['giftsCount'] ?? 0}', 'الهدايا'), _Stat('${d['coins'] ?? 0}', 'الرصيد'),
  ])));

  Widget _actions(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [
    Expanded(child: _Action(Icons.account_balance_wallet_rounded, 'المحفظة', purple, () {})), const SizedBox(width: 8),
    Expanded(child: _Action(Icons.monetization_on_rounded, 'شحن الرصيد', gold, () => NavigationService.navigateTo(AppRoutes.recharge))), const SizedBox(width: 8),
    Expanded(child: _Action(Icons.card_giftcard_rounded, 'هداياي', purple, () {})), const SizedBox(width: 8),
    Expanded(child: _Action(Icons.emoji_events_rounded, 'الإنجازات', purple, () {})), const SizedBox(width: 8),
    Expanded(child: _Action(Icons.visibility_rounded, 'زوار الملف', purple, () {})),
  ]));

  Widget _tabs() => Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Container(height: 52, decoration: _box(), child: const Row(mainAxisAlignment: MainAxisAlignment.spaceEvenly, children: [_Tab('المنشورات', true), _Tab('الصور', false), _Tab('الأصدقاء', false), _Tab('الغرف', false), _Tab('الهدايا', false)])));

  Widget _post() => Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Container(padding: const EdgeInsets.all(14), decoration: _box(), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
    const Row(children: [CircleAvatar(radius: 19, backgroundColor: Color(0xFF25163A), child: Icon(Icons.person, color: Colors.white60)), SizedBox(width: 9), Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('Shadow Live', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w800)), Text('منذ 3 ساعات', style: TextStyle(color: Colors.white38, fontSize: 10))]), Spacer(), Icon(Icons.more_vert, color: Colors.white38)]),
    const SizedBox(height: 12), const Text('الأصوات الجميلة تصنع أصدقاء أجمل .. 💜', style: TextStyle(color: Colors.white, fontSize: 14)), const SizedBox(height: 12),
    Container(height: 165, decoration: BoxDecoration(color: const Color(0xFF17132A), borderRadius: BorderRadius.circular(15)), child: const Icon(Icons.mic_rounded, color: purple, size: 68)),
    const SizedBox(height: 11), const Row(children: [Icon(Icons.favorite_rounded, color: Color(0xFFFF3E71), size: 19), SizedBox(width: 5), Text('342', style: TextStyle(color: Colors.white54)), SizedBox(width: 20), Icon(Icons.chat_bubble_outline_rounded, color: Colors.white54, size: 19), SizedBox(width: 5), Text('28', style: TextStyle(color: Colors.white54)), Spacer(), Icon(Icons.share_outlined, color: Colors.white54, size: 19), SizedBox(width: 18), Icon(Icons.bookmark_border_rounded, color: Colors.white54, size: 19)]),
  ])));

  BoxDecoration _box() => BoxDecoration(color: card, borderRadius: BorderRadius.circular(17), border: Border.all(color: const Color(0xFF28213F)));
  Widget _round(IconData icon, VoidCallback tap) => InkWell(onTap: tap, child: Container(width: 43, height: 43, decoration: BoxDecoration(color: const Color(0xFF121526), shape: BoxShape.circle, border: Border.all(color: Colors.white10)), child: Icon(icon, color: Colors.white)));
  Widget _smallButton(String text, IconData icon, Color fill, Color fg, VoidCallback tap) => SizedBox(height: 43, child: FilledButton.icon(onPressed: tap, icon: Icon(icon, color: fg, size: 17), label: FittedBox(child: Text(text, style: TextStyle(color: fg, fontWeight: FontWeight.w800))), style: FilledButton.styleFrom(backgroundColor: fill, padding: const EdgeInsets.symmetric(horizontal: 6), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(13), side: BorderSide(color: fg.withValues(alpha: .35))))));
}

class _Stat extends StatelessWidget { final String value, label; const _Stat(this.value, this.label); @override Widget build(BuildContext context) => Column(children: [Text(value, style: const TextStyle(color: Colors.white, fontSize: 15, fontWeight: FontWeight.w900)), const SizedBox(height: 4), Text(label, style: const TextStyle(color: Colors.white54, fontSize: 9))]); }
class _Action extends StatelessWidget { final IconData icon; final String text; final Color color; final VoidCallback tap; const _Action(this.icon, this.text, this.color, this.tap); @override Widget build(BuildContext context) => InkWell(onTap: tap, borderRadius: BorderRadius.circular(15), child: Container(height: 82, padding: const EdgeInsets.all(5), decoration: BoxDecoration(color: ProfileScreen.card, borderRadius: BorderRadius.circular(15), border: Border.all(color: const Color(0xFF28213F))), child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Icon(icon, color: color, size: 25), const SizedBox(height: 7), FittedBox(child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700)))]))); }
class _Tab extends StatelessWidget { final String text; final bool active; const _Tab(this.text, this.active); @override Widget build(BuildContext context) => Column(mainAxisAlignment: MainAxisAlignment.center, children: [Text(text, style: TextStyle(color: active ? const Color(0xFFE258FF) : Colors.white54, fontSize: 11, fontWeight: active ? FontWeight.w800 : FontWeight.w500)), const SizedBox(height: 6), Container(width: 28, height: 3, decoration: BoxDecoration(color: active ? const Color(0xFFC13AFF) : Colors.transparent, borderRadius: BorderRadius.circular(4)))]); }
