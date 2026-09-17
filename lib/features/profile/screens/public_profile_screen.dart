import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../chat/screens/private_chat_screen.dart';

class PublicProfileScreen extends StatelessWidget {
  final String userId;
  const PublicProfileScreen({super.key, required this.userId});

  String _conversationId(String a,String b){final ids=[a,b]..sort();return ids.join('_');}
  ImageProvider? _avatar(Map<String,dynamic> data){final photo='${data['profileImageUrl']??''}';final asset='${data['profileAvatarAsset']??''}';if(photo.isNotEmpty)return NetworkImage(photo);if(asset.isNotEmpty)return AssetImage(asset);return null;}

  @override
  Widget build(BuildContext context)=>Directionality(
    textDirection: TextDirection.rtl,
    child: Scaffold(
      backgroundColor: const Color(0xFF05060D),
      appBar: AppBar(backgroundColor:const Color(0xFF0B0D16),foregroundColor:Colors.white,title:const Text('الملف الشخصي')),
      body: FutureBuilder<DocumentSnapshot<Map<String,dynamic>>>(
        future: FirebaseFirestore.instance.collection('public_profiles').doc(userId).get(),
        builder:(context,snapshot){
          if(snapshot.hasError)return const Center(child:Text('تعذر تحميل الملف الشخصي',style:TextStyle(color:Colors.white60)));
          if(!snapshot.hasData)return const Center(child:CircularProgressIndicator(color:Color(0xFF8A3DFF)));
          final data=snapshot.data?.data();
          if(data==null)return const Center(child:Text('هذا الملف غير متاح',style:TextStyle(color:Colors.white60)));
          final name='${data['displayName']??'مستخدم Shadow Live'}';final publicId='${data['publicId']??'—'}';final provider=_avatar(data);final bio='${data['bio']??''}';final location='${data['location']??''}';
          return ListView(padding:const EdgeInsets.all(20),children:[
            const SizedBox(height:12),
            Center(child:CircleAvatar(radius:54,backgroundColor:const Color(0xFF25183F),backgroundImage:provider,child:provider==null?const Icon(Icons.person,size:50,color:Color(0xFFFFD54A)):null)),
            const SizedBox(height:14),
            Text(name,textAlign:TextAlign.center,style:const TextStyle(color:Colors.white,fontSize:24,fontWeight:FontWeight.w900)),
            const SizedBox(height:5),
            Text('ID: $publicId',textAlign:TextAlign.center,style:const TextStyle(color:Colors.white54)),
            if(bio.isNotEmpty)...[const SizedBox(height:14),Text(bio,textAlign:TextAlign.center,style:const TextStyle(color:Colors.white70,height:1.5))],
            if(location.isNotEmpty)...[const SizedBox(height:8),Row(mainAxisAlignment:MainAxisAlignment.center,children:[const Icon(Icons.location_on_outlined,color:Colors.white38,size:16),const SizedBox(width:4),Text(location,style:const TextStyle(color:Colors.white54))])],
            const SizedBox(height:22),
            FilledButton.icon(onPressed:() async {
              final current=FirebaseAuth.instance.currentUser?.uid;if(current==null||current==userId||!context.mounted)return;
              final id=_conversationId(current,userId);final ref=FirebaseFirestore.instance.collection('conversations').doc(id);final snap=await ref.get();
              if(!snap.exists){await ref.set({'participants':[current,userId],'createdAt':FieldValue.serverTimestamp(),'updatedAt':FieldValue.serverTimestamp(),'unreadCounts':{current:0,userId:0}});}
              if(context.mounted)Navigator.push(context,MaterialPageRoute(builder:(_)=>PrivateChatScreen(conversationId:id,otherUid:userId,otherName:name,otherPhoto:'${data['profileImageUrl']??''}')));
            },style:FilledButton.styleFrom(backgroundColor:const Color(0xFF7B2DFF),padding:const EdgeInsets.symmetric(vertical:14)),icon:const Icon(Icons.chat_bubble_outline),label:const Text('رسالة')),
            const SizedBox(height:18),
            Container(padding:const EdgeInsets.all(18),decoration:BoxDecoration(color:const Color(0xFF101522),borderRadius:BorderRadius.circular(20)),child:const Row(mainAxisAlignment:MainAxisAlignment.spaceAround,children:[_Stat('المتابعون','—'),_Stat('يتابع','—'),_Stat('الأصدقاء','—')])),
            const SizedBox(height:18),
            const Text('المزيد من معلومات الملف العام ستظهر هنا مع تفعيل نظام المتابعة والهدايا والإنجازات.',textAlign:TextAlign.center,style:TextStyle(color:Colors.white38,height:1.5)),
          ]);
        },
      ),
    ),
  );
}

class _Stat extends StatelessWidget{final String label,value;const _Stat(this.label,this.value);@override Widget build(BuildContext context)=>Column(children:[Text(value,style:const TextStyle(color:Color(0xFFFFD54A),fontSize:18,fontWeight:FontWeight.w900)),const SizedBox(height:4),Text(label,style:const TextStyle(color:Colors.white54,fontSize:12))]);}
