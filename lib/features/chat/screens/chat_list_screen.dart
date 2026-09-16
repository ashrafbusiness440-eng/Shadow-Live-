import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'private_chat_screen.dart';

class ChatListScreen extends StatelessWidget {
  const ChatListScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return const SizedBox.shrink();

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          child: Column(
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(18, 18, 18, 12),
                child: Row(children: [
                  Icon(Icons.chat_bubble_rounded, color: Color(0xFFFFD54A)),
                  SizedBox(width: 10),
                  Text('الرسائل', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
                ]),
              ),
              Expanded(
                child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  stream: FirebaseFirestore.instance.collection('conversations').where('participants', arrayContains: uid).snapshots(),
                  builder: (context, snapshot) {
                    if (snapshot.hasError) return _state(Icons.error_outline_rounded, 'تعذر تحميل المحادثات');
                    if (!snapshot.hasData) return const Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF)));
                    final docs = [...snapshot.data!.docs];
                    docs.sort((a, b) {
                      final at = a.data()['updatedAt'] as Timestamp?;
                      final bt = b.data()['updatedAt'] as Timestamp?;
                      return (bt?.millisecondsSinceEpoch ?? 0).compareTo(at?.millisecondsSinceEpoch ?? 0);
                    });
                    if (docs.isEmpty) return _state(Icons.forum_outlined, 'لا توجد محادثات بعد');
                    return ListView.separated(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 20),
                      itemCount: docs.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (context, index) {
                        final data = docs[index].data();
                        final participants = List<String>.from(data['participants'] ?? const []);
                        final otherUid = participants.firstWhere((id) => id != uid, orElse: () => '');
                        return _ConversationTile(conversationId: docs[index].id, otherUid: otherUid, lastMessage: '${data['lastMessage'] ?? ''}');
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static Widget _state(IconData icon, String text) => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [Icon(icon, color: Colors.white38, size: 48), const SizedBox(height: 12), Text(text, style: const TextStyle(color: Colors.white60, fontSize: 15))]));
}

class _ConversationTile extends StatelessWidget {
  final String conversationId;
  final String otherUid;
  final String lastMessage;
  const _ConversationTile({required this.conversationId, required this.otherUid, required this.lastMessage});

  @override
  Widget build(BuildContext context) => FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
    future: otherUid.isEmpty ? null : FirebaseFirestore.instance.collection('users').doc(otherUid).get(),
    builder: (context, snapshot) {
      final user = snapshot.data?.data() ?? const <String, dynamic>{};
      final name = '${user['displayName'] ?? user['name'] ?? 'مستخدم Shadow Live'}';
      final photo = '${user['photoUrl'] ?? user['avatarUrl'] ?? ''}';
      return Material(
        color: const Color(0xFF101522),
        borderRadius: BorderRadius.circular(18),
        child: ListTile(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
          leading: CircleAvatar(backgroundColor: const Color(0xFF25183F), backgroundImage: photo.isNotEmpty ? NetworkImage(photo) : null, child: photo.isEmpty ? const Icon(Icons.person_rounded, color: Color(0xFFFFD54A)) : null),
          title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)),
          subtitle: Text(lastMessage.isEmpty ? 'ابدأ المحادثة' : lastMessage, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(color: Colors.white54)),
          trailing: const Icon(Icons.chevron_left_rounded, color: Colors.white38),
          onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => PrivateChatScreen(conversationId: conversationId, otherUid: otherUid, otherName: name, otherPhoto: photo))),
        ),
      );
    },
  );
}
