import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../../services/navigation_service.dart';
import '../../../services/numeric_id_service.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});
  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String? _numericId;
  bool _allocatingId = false;

  Future<void> _ensureNumericId(String uid) async {
    if (_allocatingId || _numericId != null) return;
    _allocatingId = true;
    try {
      final id = await NumericIdService.ensureForUser(uid);
      if (mounted) setState(() => _numericId = id);
    } finally {
      _allocatingId = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          child: user == null
              ? _guest()
              : StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                  stream: FirebaseFirestore.instance.collection('users').doc(user.uid).snapshots(),
                  builder: (context, snapshot) {
                    final d = snapshot.data?.data() ?? const <String, dynamic>{};
                    final storedId = d['numericId']?.toString();
                    if (storedId != null && RegExp(r'^\d+$').hasMatch(storedId)) {
                      _numericId = storedId;
                    } else if (snapshot.hasData) {
                      WidgetsBinding.instance.addPostFrameCallback((_) => _ensureNumericId(user.uid));
                    }
                    final name = (d['displayName'] ?? d['name'] ?? user.displayName ?? 'مستخدم Shadow Live').toString();
                    final photoUrl = (d['profileImageUrl'] ?? d['photoUrl'] ?? d['photoURL'] ?? user.photoURL ?? '').toString();
                    final avatarAsset = (d['profileAvatarAsset'] ?? '').toString();
                    final cover = (d['coverUrl'] ?? '').toString();
                    final bio = (d['bio'] ?? 'أهلاً بك في Shadow Live').toString();
                    final location = (d['location'] ?? d['country'] ?? '🇦🇪 الإمارات العربية المتحدة').toString();
                    final gender = (d['gender'] ?? '').toString();
                    return ListView(padding: EdgeInsets.zero, children: [
                      _brandHeader(),
                      _coverAndAvatar(cover, photoUrl, avatarAsset),
                      const SizedBox(height: 48),
                      Text(name, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
                      const SizedBox(height: 7),
                      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                        Text('ID: ${_numericId ?? '...'}', style: const TextStyle(color: Colors.white54)),
                        const SizedBox(width: 8),
                        Text(location, style: const TextStyle(color: Colors.white54)),
                        if (gender == 'ذكر' || gender == 'أنثى') ...[const SizedBox(width: 7), _genderBadge(gender)],
                      ]),
                      const SizedBox(height: 8),
                      Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(bio, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white70))),
                      const SizedBox(height: 18),
                      Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [
                        Expanded(child: _button(Icons.edit_rounded, 'تعديل الملف', () {})), const SizedBox(width: 10),
                        Expanded(child: _button(Icons.workspace_premium_rounded, 'VIP', () {})), const SizedBox(width: 10),
                        Expanded(child: _button(Icons.apartment_rounded, 'الوكالة', () {})),
                      ])),
                      const SizedBox(height: 16), _stats(d), const SizedBox(height: 16),
                      Padding(padding: const EdgeInsets.symmetric(horizontal: 16), child: Row(children: [
                        Expanded(child: _quick(Icons.account_balance_wallet_rounded, 'محفظتي', () => NavigationService.navigateTo(AppRoutes.wallet))), const SizedBox(width: 10),
                        Expanded(child: _quick(Icons.add_card_rounded, 'شحن', () => NavigationService.navigateTo(AppRoutes.recharge))), const SizedBox(width: 10),
                        Expanded(child: _quick(Icons.card_giftcard_rounded, 'الهدايا', () {})),
                      ])), const SizedBox(height: 28),
                    ]);
                  },
                ),
        ),
      ),
    );
  }

  Widget _guest() => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [const Icon(Icons.person_outline_rounded,color:Color(0xFFFFC84A),size:64),const SizedBox(height:14),const Text('أنت داخل كضيف',style:TextStyle(color:Colors.white,fontSize:20,fontWeight:FontWeight.w800)),const SizedBox(height:14),ElevatedButton(onPressed:()=>NavigationService.navigateToAndRemoveUntil(AppRoutes.authChoice),child:const Text('العودة لتسجيل الدخول'))]));
  Widget _brandHeader()=>Container(height:82,padding:const EdgeInsets.symmetric(horizontal:14),color:const Color(0xFF090A11),child:Row(children:[Image.asset('assets/images/profile/profile_header_logo.png',width:145,fit:BoxFit.contain),const Spacer(),IconButton(onPressed:()=>NavigationService.navigateTo(AppRoutes.settings),icon:const Icon(Icons.settings_rounded,color:Color(0xFFFFC84A)))]));

  Widget _coverAndAvatar(String cover,String photo,String asset)=>SizedBox(height:210,child:Stack(clipBehavior:Clip.none,children:[
    Positioned.fill(child:cover.isEmpty?Image.asset('assets/images/profile/default_profile_cover.png',fit:BoxFit.cover):Image.network(cover,fit:BoxFit.cover,errorBuilder:(_,__,___)=>Image.asset('assets/images/profile/default_profile_cover.png',fit:BoxFit.cover))),
    Positioned(bottom:-42,left:0,right:0,child:Center(child:Container(padding:const EdgeInsets.all(4),decoration:const BoxDecoration(shape:BoxShape.circle,gradient:LinearGradient(colors:[Color(0xFFFFC84A),Color(0xFF8A3DFF)])),child:CircleAvatar(radius:48,backgroundColor:const Color(0xFF151526),backgroundImage:photo.isNotEmpty?NetworkImage(photo):(asset.isNotEmpty?AssetImage(asset) as ImageProvider:null),child:photo.isEmpty&&asset.isEmpty?const Icon(Icons.person_rounded,size:52,color:Colors.white70):null))))
  ]));

  Widget _genderBadge(String gender) { final male=gender=='ذكر'; return Container(width:23,height:23,alignment:Alignment.center,decoration:BoxDecoration(shape:BoxShape.circle,color:(male?const Color(0xFF2196F3):const Color(0xFFFF4FA3)).withValues(alpha:.18),border:Border.all(color:male?const Color(0xFF42A5F5):const Color(0xFFFF69B4))),child:Text(male?'♂':'♀',style:TextStyle(color:male?const Color(0xFF42A5F5):const Color(0xFFFF69B4),fontSize:16,fontWeight:FontWeight.w900))); }
  Widget _button(IconData i,String l,VoidCallback t)=>OutlinedButton.icon(onPressed:t,icon:Icon(i,size:18),label:FittedBox(child:Text(l)),style:OutlinedButton.styleFrom(foregroundColor:const Color(0xFFFFC84A),side:BorderSide(color:const Color(0xFFFFC84A).withValues(alpha:.35)),padding:const EdgeInsets.symmetric(vertical:13)));
  Widget _stats(Map<String,dynamic>d)=>Container(margin:const EdgeInsets.symmetric(horizontal:16),padding:const EdgeInsets.symmetric(vertical:16),decoration:BoxDecoration(color:const Color(0xFF10121D),borderRadius:BorderRadius.circular(20)),child:Row(mainAxisAlignment:MainAxisAlignment.spaceEvenly,children:[_stat('${d['followersCount']??d['followers']??0}','متابعون'),_stat('${d['followingCount']??d['following']??0}','أتابع'),_stat('${d['roomsCount']??0}','غرف'),_stat('${d['giftsCount']??d['totalGiftsReceived']??0}','هدايا')]));
  Widget _stat(String v,String l)=>Column(children:[Text(v,style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w900,fontSize:17)),const SizedBox(height:4),Text(l,style:const TextStyle(color:Colors.white54,fontSize:11))]);
  Widget _quick(IconData i,String l,VoidCallback t)=>Material(color:const Color(0xFF111321),borderRadius:BorderRadius.circular(18),child:InkWell(onTap:t,borderRadius:BorderRadius.circular(18),child:Padding(padding:const EdgeInsets.symmetric(vertical:18,horizontal:6),child:Column(children:[Icon(i,color:const Color(0xFFFFC84A),size:27),const SizedBox(height:7),Text(l,style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w700))]))));
}
