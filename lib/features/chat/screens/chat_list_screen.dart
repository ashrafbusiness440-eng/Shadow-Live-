import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'private_chat_screen.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  String get uid => FirebaseAuth.instance.currentUser!.uid;

  String _conversationId(String otherUid) {
    final ids = [uid, otherUid]..sort();
    return ids.join('_');
  }

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _searchUsers(String query) async {
    final q = query.trim();
    if (q.length < 2) return [];
    final found = <String, QueryDocumentSnapshot<Map<String, dynamic>>>{};

    try {
      final idDoc = await FirebaseFirestore.instance.collection('public_ids').doc(q).get();
      final targetUid = idDoc.data()?['uid']?.toString();
      if (targetUid != null && targetUid != uid) {
        final userDoc = await FirebaseFirestore.instance.collection('users').doc(targetUid).get();
        if (userDoc.exists) {
          final all = await FirebaseFirestore.instance.collection('users').where(FieldPath.documentId, isEqualTo: targetUid).limit(1).get();
          for (final doc in all.docs) {
            found[doc.id] = doc;
          }
        }
      }
    } catch (_) {}

    try {
      final users = await FirebaseFirestore.instance
          .collection('users')
          .orderBy('displayName')
          .startAt([q])
          .endAt(['$q\uf8ff'])
          .limit(20)
          .get();
      for (final doc in users.docs) {
        if (doc.id != uid) found[doc.id] = doc;
      }
    } catch (_) {
      try {
        final users = await FirebaseFirestore.instance.collection('users').limit(50).get();
        final low = q.toLowerCase();
        for (final doc in users.docs) {
          if (doc.id == uid) continue;
          final data = doc.data();
          final name = '${data['displayName'] ?? data['name'] ?? ''}'.toLowerCase();
          final publicId = '${data['publicId'] ?? ''}'.toLowerCase();
          if (name.contains(low) || publicId == low) found[doc.id] = doc;
        }
      } catch (_) {}
    }
    return found.values.toList();
  }

  Future<void> _newChat() async {
    final controller = TextEditingController();
    var results = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    var loading = false;
    var searchVersion = 0;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101522),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) => Padding(
            padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(context).viewInsets.bottom + 18),
            child: SizedBox(
              height: MediaQuery.of(context).size.height * .62,
              child: Column(
                children: [
                  const Text('محادثة جديدة', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 14),
                  TextField(
                    controller: controller,
                    autofocus: true,
                    style: const TextStyle(color: Colors.white),
                    decoration: InputDecoration(
                      prefixIcon: const Icon(Icons.search, color: Color(0xFFFFD54A)),
                      hintText: 'ابحث بالاسم أو ID',
                      hintStyle: const TextStyle(color: Colors.white38),
                      filled: true,
                      fillColor: const Color(0xFF181C29),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                    ),
                    onChanged: (value) async {
                      final version = ++searchVersion;
                      final q = value.trim();
                      if (q.length < 2) {
                        setSheetState(() {
                          loading = false;
                          results = [];
                        });
                        return;
                      }
                      setSheetState(() => loading = true);
                      final next = await _searchUsers(q);
                      if (!context.mounted || version != searchVersion) return;
                      setSheetState(() {
                        results = next;
                        loading = false;
                      });
                    },
                  ),
                  const SizedBox(height: 10),
                  if (loading)
                    const Expanded(child: Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF))))
                  else if (controller.text.trim().length < 2)
                    const Expanded(child: Center(child: Text('اكتب حرفين على الأقل', style: TextStyle(color: Colors.white38))))
                  else if (results.isEmpty)
                    const Expanded(child: Center(child: Text('لا توجد نتائج', style: TextStyle(color: Colors.white54))))
                  else
                    Expanded(
                      child: ListView.builder(
                        itemCount: results.length,
                        itemBuilder: (_, index) {
                          final doc = results[index];
                          final user = doc.data();
                          final name = '${user['displayName'] ?? user['name'] ?? 'مستخدم Shadow Live'}';
                          final photo = '${user['profileImageUrl'] ?? user['photoUrl'] ?? user['avatarUrl'] ?? ''}';
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: const Color(0xFF25183F),
                              backgroundImage: photo.isNotEmpty ? NetworkImage(photo) : null,
                              child: photo.isEmpty ? const Icon(Icons.person, color: Color(0xFFFFD54A)) : null,
                            ),
                            title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                            subtitle: Text('ID: ${user['publicId'] ?? doc.id}', style: const TextStyle(color: Colors.white54)),
                            onTap: () async {
                              final id = _conversationId(doc.id);
                              final ref = FirebaseFirestore.instance.collection('conversations').doc(id);
                              final existing = await ref.get();
                              if (!existing.exists) {
                                await ref.set({
                                  'participants': [uid, doc.id],
                                  'createdAt': FieldValue.serverTimestamp(),
                                  'updatedAt': FieldValue.serverTimestamp(),
                                  'unreadCounts': {uid: 0, doc.id: 0},
                                });
                              }
                              if (!sheetContext.mounted) return;
                              Navigator.pop(sheetContext);
                              if (!mounted) return;
                              Navigator.push(
                                this.context,
                                MaterialPageRoute(
                                  builder: (_) => PrivateChatScreen(
                                    conversationId: id,
                                    otherUid: doc.id,
                                    otherName: name,
                                    otherPhoto: photo,
                                  ),
                                ),
                              );
                            },
                          );
                        },
                      ),
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
    controller.dispose();
  }

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF05060D),
          body: SafeArea(
            child: Column(
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
                  child: Row(
                    children: [
                      const Icon(Icons.chat_bubble_rounded, color: Color(0xFFFFD54A)),
                      const SizedBox(width: 10),
                      const Expanded(child: Text('الرسائل', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900))),
                      IconButton(onPressed: _newChat, tooltip: 'محادثة جديدة', icon: const Icon(Icons.add_comment_rounded, color: Color(0xFFFFD54A))),
                    ],
                  ),
                ),
                Expanded(
                  child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                    stream: FirebaseFirestore.instance.collection('conversations').where('participants', arrayContains: uid).snapshots(),
                    builder: (context, snapshot) {
                      if (snapshot.hasError) return _state(Icons.error_outline, 'تعذر تحميل المحادثات');
                      if (!snapshot.hasData) return const Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF)));
                      final docs = [...snapshot.data!.docs]
                        ..sort((a, b) => ((b.data()['updatedAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0)
                            .compareTo((a.data()['updatedAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0));
                      if (docs.isEmpty) return _state(Icons.forum_outlined, 'لا توجد محادثات بعد\nاضغط + لبدء محادثة');
                      return ListView.separated(
                        padding: const EdgeInsets.fromLTRB(12, 4, 12, 20),
                        itemCount: docs.length,
                        separatorBuilder: (_, __) => const SizedBox(height: 8),
                        itemBuilder: (_, index) {
                          final doc = docs[index];
                          final data = doc.data();
                          final participants = List<String>.from(data['participants'] ?? const []);
                          final other = participants.firstWhere((id) => id != uid, orElse: () => '');
                          final unread = ((data['unreadCounts'] as Map?)?[uid] as num?)?.toInt() ?? 0;
                          return _ConversationTile(
                            id: doc.id,
                            otherUid: other,
                            lastMessage: '${data['lastMessage'] ?? ''}',
                            unread: unread,
                            updatedAt: data['updatedAt'],
                          );
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

  static Widget _state(IconData icon, String text) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, color: Colors.white38, size: 48),
            const SizedBox(height: 12),
            Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white60, height: 1.6)),
          ],
        ),
      );
}

class _ConversationTile extends StatelessWidget {
  final String id;
  final String otherUid;
  final String lastMessage;
  final int unread;
  final dynamic updatedAt;

  const _ConversationTile({required this.id, required this.otherUid, required this.lastMessage, required this.unread, required this.updatedAt});

  String _time(dynamic value) {
    if (value is! Timestamp) return '';
    final d = value.toDate();
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final m = d.minute.toString().padLeft(2, '0');
    return '$h:$m ${d.hour >= 12 ? 'م' : 'ص'}';
  }

  @override
  Widget build(BuildContext context) => FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        future: otherUid.isEmpty ? null : FirebaseFirestore.instance.collection('users').doc(otherUid).get(),
        builder: (context, snapshot) {
          final user = snapshot.data?.data() ?? const <String, dynamic>{};
          final name = '${user['displayName'] ?? user['name'] ?? 'مستخدم Shadow Live'}';
          final photo = '${user['profileImageUrl'] ?? user['photoUrl'] ?? user['avatarUrl'] ?? ''}';
          return Material(
            color: const Color(0xFF101522),
            borderRadius: BorderRadius.circular(18),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: const Color(0xFF25183F),
                backgroundImage: photo.isNotEmpty ? NetworkImage(photo) : null,
                child: photo.isEmpty ? const Icon(Icons.person, color: Color(0xFFFFD54A)) : null,
              ),
              title: Text(name, style: TextStyle(color: Colors.white, fontWeight: unread > 0 ? FontWeight.w900 : FontWeight.w700)),
              subtitle: Text(lastMessage.isEmpty ? 'ابدأ المحادثة' : lastMessage, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: unread > 0 ? Colors.white70 : Colors.white54)),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(_time(updatedAt), style: const TextStyle(color: Colors.white38, fontSize: 10)),
                  if (unread > 0) ...[
                    const SizedBox(height: 5),
                    CircleAvatar(radius: 11, backgroundColor: const Color(0xFF8A3DFF), child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold))),
                  ],
                ],
              ),
              onTap: otherUid.isEmpty
                  ? null
                  : () => Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => PrivateChatScreen(conversationId: id, otherUid: otherUid, otherName: name, otherPhoto: photo),
                        ),
                      ),
            ),
          );
        },
      );
}
