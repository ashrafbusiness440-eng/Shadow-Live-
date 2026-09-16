import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../../services/navigation_service.dart';
import '../../wallet/screens/recharge_screen.dart';
import 'discovery_search_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override State<HomeScreen> createState()=>_HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen>{
  Map<String,dynamic>? _userData;
  List<Map<String,dynamic>> _rooms=[];
  bool _loading=true;
  String? _error;
  static const _bg=Color(0xFF05060D),_card=Color(0xFF111321),_gold=Color(0xFFFFD54A),_purple=Color(0xFF8A3DFF);

  @override void initState(){super.initState();_load();}

  Future<void> _load()async{
    if(mounted)setState((){_loading=true;_error=null;});
    try{
      final u=FirebaseAuth.instance.currentUser;
      Map<String,dynamic>? user;
      if(u!=null){final s=await FirebaseFirestore.instance.collection('users').doc(u.uid).get();user=s.data();}
      final rooms=<Map<String,dynamic>>[];
      try{
        final rs=await FirebaseFirestore.instance.collection('rooms').limit(12).get();
        for(final d in rs.docs){final data=d.data();final active=data['isActive'];if(active==null||active==true)rooms.add({...data,'roomId':d.id});}
        rooms.sort((a,b)=>_count(b).compareTo(_count(a)));
      }catch(_){ }
      if(mounted)setState((){_userData=user;_rooms=rooms;});
    }catch(_){if(mounted)setState(()=>_error='تعذر تحديث الصفحة حالياً');}
    finally{if(mounted)setState(()=>_loading=false);}
  }

  static int _count(Map<String,dynamic> r){final v=r['onlineCount']??r['memberCount']??r['participantsCount']??0;return v is num?v.toInt():int.tryParse(v.toString())??0;}
  ImageProvider? _profileImage(){final url=(_userData?['profileImageUrl']??_userData?['avatarUrl'])?.toString();if(url!=null&&url.trim().isNotEmpty)return NetworkImage(url);final asset=_userData?['profileAvatarAsset']?.toString();if(asset!=null&&asset.trim().isNotEmpty)return AssetImage(asset);final auth=FirebaseAuth.instance.currentUser?.photoURL;return auth!=null&&auth.trim().isNotEmpty?NetworkImage(auth):null;}
  void _recharge(int tab)=>Navigator.push(context,MaterialPageRoute(builder:(_)=>RechargeScreen(initialTab:tab)));
  void _search()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>const DiscoverySearchScreen()));
  void _openRoom(Map<String,dynamic> room)=>NavigationService.navigateTo(AppRoutes.voiceChatRoom,arguments:room);
  void _soon(String title)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$title سيتم تفعيله في مرحلته القادمة')));

  @override Widget build(BuildContext context){
    final name=(_userData?['displayName']??_userData?['username']??'صديقنا').toString();
    final level=(_userData?['level']??1).toString(),coins=(_userData?['coins']??0).toString(),diamonds=(_userData?['diamonds']??0).toString();
    return Directionality(textDirection:TextDirection.rtl,child:Scaffold(backgroundColor:_bg,body:Container(decoration:const BoxDecoration(gradient:RadialGradient(center:Alignment(.7,-.9),radius:1.25,colors:[Color(0xFF251047),_bg])),child:SafeArea(bottom:false,child:RefreshIndicator(onRefresh:_load,child:ListView(padding:const EdgeInsets.fromLTRB(16,12,16,28),children:[
      _header(name,level,coins,diamonds),
      if(_loading)...[const SizedBox(height:10),const LinearProgressIndicator(minHeight:2,color:_purple,backgroundColor:Colors.transparent)],
      if(_error!=null)Padding(padding:const EdgeInsets.only(top:10),child:Text(_error!,style:const TextStyle(color:Colors.orangeAccent,fontSize:12))),
      const SizedBox(height:18),_searchBox(),const SizedBox(height:18),_hero(),const SizedBox(height:24),
      _title('غرف مقترحة'),const SizedBox(height:12),_roomsSection(),
      const SizedBox(height:24),_title('استكشف Shadow Live'),const SizedBox(height:12),
      GridView.count(crossAxisCount:2,shrinkWrap:true,physics:const NeverScrollableScrollPhysics(),mainAxisSpacing:12,crossAxisSpacing:12,childAspectRatio:1.65,children:[
        _Feature('الأصدقاء','ابحث بالاسم أو ID',Icons.people_alt_rounded,_search),
        _Feature('الألعاب','العب واربح',Icons.sports_esports_rounded,()=>_soon('الألعاب')),
        _Feature('الفعاليات','لا تفوّت الجديد',Icons.celebration_rounded,()=>_soon('الفعاليات')),
        _Feature('الترتيب','نجوم المجتمع',Icons.emoji_events_rounded,()=>_soon('الترتيب')),
      ])
    ]))))));
  }

  Widget _roomsSection(){
    if(_loading&&_rooms.isEmpty)return const SizedBox(height:130,child:Center(child:CircularProgressIndicator(color:_purple)));
    if(_rooms.isEmpty)return Container(height:120,padding:const EdgeInsets.all(18),decoration:BoxDecoration(color:_card,borderRadius:BorderRadius.circular(20),border:Border.all(color:Colors.white10)),child:const Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(Icons.mic_none_rounded,color:Colors.white38,size:32),SizedBox(height:8),Text('لا توجد غرف متاحة حالياً',style:TextStyle(color:Colors.white70,fontWeight:FontWeight.w700)),SizedBox(height:4),Text('ستظهر الغرف النشطة هنا تلقائياً',style:TextStyle(color:Colors.white38,fontSize:11))]));
    return SizedBox(height:170,child:ListView(scrollDirection:Axis.horizontal,children:_rooms.take(8).map((r)=>_RoomCard(room:r,onTap:()=>_openRoom(r))).toList()));
  }

  Widget _header(String name,String level,String coins,String diamonds){final image=_profileImage();return Row(children:[Container(width:50,height:50,padding:const EdgeInsets.all(2),decoration:BoxDecoration(shape:BoxShape.circle,gradient:const LinearGradient(colors:[_gold,_purple]),border:Border.all(color:Colors.white24)),child:CircleAvatar(backgroundColor:const Color(0xFF171D31),backgroundImage:image,child:image==null?const Icon(Icons.person_rounded,color:Colors.white,size:28):null)),const SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('أهلاً، $name',maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:Colors.white,fontSize:18,fontWeight:FontWeight.w800)),Text('LV.$level',style:const TextStyle(color:_gold,fontSize:11,fontWeight:FontWeight.w800))])),_wallet(Icons.monetization_on_rounded,coins,_gold,0),const SizedBox(width:6),_wallet(Icons.diamond_rounded,diamonds,const Color(0xFF64D8FF),1),const SizedBox(width:6),IconButton(onPressed:()=>_soon('الإشعارات'),icon:const Icon(Icons.notifications_none_rounded,color:Colors.white),tooltip:'الإشعارات')]);}
  Widget _wallet(IconData icon,String value,Color color,int tab)=>InkWell(onTap:()=>_recharge(tab),borderRadius:BorderRadius.circular(14),child:Container(padding:const EdgeInsets.symmetric(horizontal:6,vertical:7),decoration:BoxDecoration(color:Colors.white.withValues(alpha:.06),borderRadius:BorderRadius.circular(14),border:Border.all(color:Colors.white10)),child:Row(children:[Icon(icon,color:color,size:15),const SizedBox(width:3),Text(value,style:const TextStyle(color:Colors.white,fontSize:11,fontWeight:FontWeight.w700)),const SizedBox(width:3),const Icon(Icons.add_circle_rounded,color:Color(0xFF9A5CFF),size:15)])));
  Widget _searchBox()=>InkWell(onTap:_search,borderRadius:BorderRadius.circular(16),child:Container(height:48,padding:const EdgeInsets.symmetric(horizontal:14),decoration:BoxDecoration(color:_card,borderRadius:BorderRadius.circular(16),border:Border.all(color:Colors.white10)),child:const Row(children:[Icon(Icons.search_rounded,color:Colors.white54),SizedBox(width:10),Text('ابحث عن غرف، أصدقاء أو ID...',style:TextStyle(color:Colors.white54,fontSize:13))])));
  Widget _hero()=>Container(height:175,padding:const EdgeInsets.all(20),decoration:BoxDecoration(borderRadius:BorderRadius.circular(24),gradient:const LinearGradient(colors:[Color(0xFF5A19B8),Color(0xFF17103B),Color(0xFF08101E)]),border:Border.all(color:_purple)),child:const Row(children:[Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,mainAxisAlignment:MainAxisAlignment.center,children:[Text('صوتك يجمعنا',style:TextStyle(color:_gold,fontSize:25,fontWeight:FontWeight.w900)),SizedBox(height:8),Text('اكتشف الغرف والأصدقاء\nوعِش اللحظة مع مجتمعك',style:TextStyle(color:Colors.white70,height:1.5,fontSize:13))])),Icon(Icons.mic_rounded,color:_gold,size:70)]));
  Widget _title(String t)=>Text(t,style:const TextStyle(color:Colors.white,fontSize:18,fontWeight:FontWeight.w900));
}

class _RoomCard extends StatelessWidget{
  final Map<String,dynamic> room;final VoidCallback onTap;const _RoomCard({required this.room,required this.onTap});
  @override Widget build(BuildContext context){final title=(room['name']??room['title']??'غرفة صوتية').toString();final count=_HomeScreenState._count(room);return InkWell(onTap:onTap,borderRadius:BorderRadius.circular(20),child:Container(width:145,margin:const EdgeInsetsDirectional.only(end:10),padding:const EdgeInsets.all(14),decoration:BoxDecoration(borderRadius:BorderRadius.circular(20),gradient:const LinearGradient(colors:[Color(0xFF251A42),Color(0xFF10121D)]),border:Border.all(color:Colors.white10)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const CircleAvatar(radius:27,backgroundColor:Color(0xFF372064),child:Icon(Icons.mic_rounded,color:Color(0xFFFFD54A))),const Spacer(),Text(title,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w800)),Text('$count متصل',style:const TextStyle(color:Colors.white54,fontSize:11))])));}
}

class _Feature extends StatelessWidget{
  final String t,s;final IconData i;final VoidCallback onTap;const _Feature(this.t,this.s,this.i,this.onTap);
  @override Widget build(BuildContext context)=>InkWell(onTap:onTap,borderRadius:BorderRadius.circular(18),child:Container(padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:const Color(0xFF111321),borderRadius:BorderRadius.circular(18),border:Border.all(color:Colors.white10)),child:Row(children:[Icon(i,color:const Color(0xFF8A3DFF),size:28),const SizedBox(width:10),Expanded(child:Column(mainAxisAlignment:MainAxisAlignment.center,crossAxisAlignment:CrossAxisAlignment.start,children:[Text(t,style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w800)),Text(s,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:Colors.white38,fontSize:10))]))])));
}
