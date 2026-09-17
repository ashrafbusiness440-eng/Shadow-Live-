import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../profile/screens/public_profile_screen.dart';

class PrivateChatScreen extends StatefulWidget {
  final String conversationId;
  final String otherUid;
  final String otherName;
  final String otherPhoto;

  const PrivateChatScreen({super.key, required this.conversationId, required this.otherUid, required this.otherName, this.otherPhoto = ''});

  @override
  State<PrivateChatScreen> createState() => _PrivateChatScreenState();
}

class _PrivateChatScreenState extends State<PrivateChatScreen> {
  final _controller = TextEditingController();
  bool _sending = false;
  bool _markingRead = false;

  String get _uid => FirebaseAuth.instance.currentUser!.uid;
  DocumentReference<Map<String, dynamic>> get _conversation => FirebaseFirestore.instance.collection('conversations').doc(widget.conversationId);

  @override
  void initState() {super.initState();_markRead();}

  Future<void> _markRead() async {if (_markingRead) return;_markingRead = true;try {await _conversation.update({'unreadCounts.$_uid': 0});} catch (_) {} finally {_markingRead = false;}}

  Future<void> _send() async {
    final text = _controller.text.trim();if (text.isEmpty || _sending || text.length > 2000) return;setState(() => _sending = true);
    try {
      final batch = FirebaseFirestore.instance.batch();
      batch.update(_conversation, {'lastMessage': text,'lastSenderId': _uid,'updatedAt': FieldValue.serverTimestamp(),'unreadCounts.$_uid': 0,'unreadCounts.${widget.otherUid}': FieldValue.increment(1)});
      batch.set(_conversation.collection('messages').doc(), {'senderId': _uid,'text': text,'type': 'text','createdAt': FieldValue.serverTimestamp()});
      await batch.commit();_controller.clear();
    } catch (_) {if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تعذر إرسال الرسالة')));} finally {if (mounted) setState(() => _sending = false);}
  }

  @override void dispose(){_controller.dispose();super.dispose();}
  String _time(dynamic value){if(value is! Timestamp)return '';final d=value.toDate();final hour=d.hour%12==0?12:d.hour%12;final minute=d.minute.toString().padLeft(2,'0');return '$hour:$minute ${d.hour>=12?'م':'ص'}';}
  void _openProfile()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>PublicProfileScreen(userId:widget.otherUid)));

  @override
  Widget build(BuildContext context)=>Directionality(textDirection:TextDirection.rtl,child:Scaffold(
    backgroundColor:const Color(0xFF05060D),
    appBar:AppBar(backgroundColor:const Color(0xFF0B0D16),foregroundColor:Colors.white,titleSpacing:0,title:InkWell(onTap:_openProfile,borderRadius:BorderRadius.circular(12),child:Padding(padding:const EdgeInsets.symmetric(vertical:5),child:Row(children:[CircleAvatar(radius:18,backgroundColor:const Color(0xFF25183F),backgroundImage:widget.otherPhoto.isNotEmpty?NetworkImage(widget.otherPhoto):null,child:widget.otherPhoto.isEmpty?const Icon(Icons.person,color:Color(0xFFFFD54A),size:20):null),const SizedBox(width:10),Expanded(child:Text(widget.otherName,style:const TextStyle(fontSize:16,fontWeight:FontWeight.w800)))])))),
    body:Column(children:[
      Expanded(child:StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(stream:_conversation.collection('messages').orderBy('createdAt',descending:true).limit(100).snapshots(),builder:(context,snapshot){
        if(snapshot.hasError)return const Center(child:Text('تعذر تحميل الرسائل',style:TextStyle(color:Colors.white60)));
        if(!snapshot.hasData)return const Center(child:CircularProgressIndicator(color:Color(0xFF8A3DFF)));
        WidgetsBinding.instance.addPostFrameCallback((_)=>_markRead());final docs=snapshot.data!.docs;
        if(docs.isEmpty)return const Center(child:Text('ابدأ المحادثة برسالة 👋',style:TextStyle(color:Colors.white54)));
        return ListView.builder(reverse:true,padding:const EdgeInsets.all(14),itemCount:docs.length,itemBuilder:(_,index){final data=docs[index].data();final mine=data['senderId']==_uid;return Align(alignment:mine?Alignment.centerRight:Alignment.centerLeft,child:Container(constraints:const BoxConstraints(maxWidth:300),margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.symmetric(horizontal:14,vertical:9),decoration:BoxDecoration(color:mine?const Color(0xFF6D27D9):const Color(0xFF151925),borderRadius:BorderRadius.circular(18)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('${data['text']??''}',style:const TextStyle(color:Colors.white,height:1.35)),const SizedBox(height:3),Text(_time(data['createdAt']),style:const TextStyle(color:Colors.white54,fontSize:9))])));});
      })),
      SafeArea(top:false,child:Container(padding:const EdgeInsets.fromLTRB(10,8,10,10),decoration:const BoxDecoration(color:Color(0xFF0B0D16),border:Border(top:BorderSide(color:Colors.white10))),child:Row(children:[Expanded(child:TextField(controller:_controller,minLines:1,maxLines:5,maxLength:2000,buildCounter:(_,{required currentLength,required isFocused,maxLength})=>null,style:const TextStyle(color:Colors.white),decoration:InputDecoration(hintText:'اكتب رسالة...',hintStyle:const TextStyle(color:Colors.white38),filled:true,fillColor:const Color(0xFF151925),border:OutlineInputBorder(borderRadius:BorderRadius.circular(22),borderSide:BorderSide.none),contentPadding:const EdgeInsets.symmetric(horizontal:16,vertical:10)))),const SizedBox(width:8),IconButton.filled(onPressed:_sending?null:_send,style:IconButton.styleFrom(backgroundColor:const Color(0xFF7B2DFF),foregroundColor:Colors.white),icon:_sending?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2,color:Colors.white)):const Icon(Icons.send_rounded))]))),
    ]),
  ));
}
