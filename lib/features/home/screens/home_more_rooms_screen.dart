import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../../../services/navigation_service.dart';
import '../../room/widgets/discovery_room_password_dialog.dart';
import '../services/discovery_service.dart';
import 'home_screen.dart';

class HomeMoreRoomsScreen extends StatefulWidget {
  const HomeMoreRoomsScreen({super.key,required this.initiallyShown});
  final Set<String> initiallyShown;
  @override State<HomeMoreRoomsScreen> createState()=>_HomeMoreRoomsScreenState();
}
class _HomeMoreRoomsScreenState extends State<HomeMoreRoomsScreen> {
  final service=DiscoveryService();
  final scroll=ScrollController();
  final rooms=<DiscoveryRoom>[];
  DocumentSnapshot<Map<String,dynamic>>? cursor;
  StreamSubscription<User?>? authSubscription;
  String? uid;
  int generation=0;
  bool loading=false,hasMore=true;
  String? error;
  final opening=<String>{};

  @override void initState(){
    super.initState();
    uid=FirebaseAuth.instance.currentUser?.uid;
    scroll.addListener((){
      if(scroll.hasClients&&scroll.position.extentAfter<350) unawaited(loadNext());
    });
    authSubscription=FirebaseAuth.instance.userChanges().listen((user){
      if(user?.uid==uid||!mounted)return;
      setState((){
        uid=user?.uid;generation++;cursor=null;hasMore=true;loading=false;error=null;rooms.clear();opening.clear();
      });
      unawaited(loadNext());
    });
    unawaited(loadNext());
  }
  Future<void> loadNext() async {
    if(loading||!hasMore)return;
    final requestedUid=uid,requestGeneration=generation;
    setState((){loading=true;error=null;});
    try{
      final page=await service.loadRoomPage(after:cursor);
      if(!mounted||uid!=requestedUid||generation!=requestGeneration)return;
      setState((){
        cursor=page.cursor;hasMore=page.hasMore;
        final merged=mergeHomeRoomPages(rooms,page.rooms,exclude:widget.initiallyShown);
        rooms..clear()..addAll(merged);
      });
    }catch(_){
      if(mounted&&uid==requestedUid&&generation==requestGeneration) setState(()=>error='تعذر تحميل الغرف');
    }finally{
      if(mounted&&uid==requestedUid&&generation==requestGeneration)setState(()=>loading=false);
    }
  }
  Future<void> enter(DiscoveryRoom room) async {
    if(!opening.add(room.id))return;
    final requestedUid=uid,requestGeneration=generation;
    try{
      final fresh=await service.recheckRoomForEntry(room.id);
      if(!mounted||requestedUid!=uid||requestGeneration!=generation)return;
      if(fresh==null){
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('الغرفة غير متاحة الآن')));
        return;
      }
      final args=fresh.toNavigationArguments();
      final owner=(fresh.data['ownerUid']??fresh.data['ownerId']??fresh.data['hostId']??'').toString();
      if(fresh.isPasswordProtected&&requestedUid!=owner){
        final password=await showDiscoveryRoomPasswordPrompt(context,fresh.title);
        if(!mounted||password==null||requestedUid!=FirebaseAuth.instance.currentUser?.uid)return;
        args['roomPassword']=password;
      }
      if(mounted&&requestedUid==uid) NavigationService.navigateTo(AppRoutes.voiceChatRoom,arguments:args);
    }catch(_){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('تعذر الدخول إلى الغرفة')));
    }finally{opening.remove(room.id);}
  }
  @override void dispose(){authSubscription?.cancel();scroll.dispose();service.close();super.dispose();}
  @override Widget build(BuildContext context)=>Directionality(
    textDirection:TextDirection.rtl,
    child:Scaffold(
      backgroundColor:const Color(0xFF05060D),
      appBar:AppBar(title:const Text('عرض المزيد من الغرف'),backgroundColor:const Color(0xFF111321)),
      body:CustomScrollView(controller:scroll,slivers:[
        SliverPadding(
          padding:const EdgeInsets.all(12),
          sliver:SliverGrid(
            delegate:SliverChildBuilderDelegate((context,index){
              final room=rooms[index];
              return HomeCompactRoomCard(key:ValueKey(room.id),room:room,onTap:()=>enter(room));
            },childCount:rooms.length),
            gridDelegate:const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount:2,mainAxisSpacing:8,crossAxisSpacing:8,childAspectRatio:1),
          ),
        ),
        SliverToBoxAdapter(child:Center(child:Padding(
          padding:const EdgeInsets.all(16),
          child:loading?const CircularProgressIndicator():
            error!=null?TextButton(onPressed:loadNext,child:const Text('إعادة المحاولة')):
            hasMore?TextButton(onPressed:loadNext,child:const Text('تحميل المزيد')):
            const Text('وصلت إلى نهاية الغرف',style:TextStyle(color:Colors.white70)),
        ))),
      ]),
    ),
  );
}
