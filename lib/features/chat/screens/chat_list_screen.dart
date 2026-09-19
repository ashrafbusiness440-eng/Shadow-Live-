import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'private_chat_screen.dart';
import '../../profile/screens/public_profile_screen.dart';

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
        final exact = await FirebaseFirestore.instance.collection('public_profiles').where(FieldPath.documentId, isEqualTo: targetUid).limit(1).get();
        for (final doc in exact.docs) {
          found[doc.id] = doc;
        }
      }
    } catch (_) {}
    try {
      final snap = await FirebaseFirestore.instance.collection('public_profiles').orderBy('displayName').startAt([q]).endAt(['$q\uf8ff']).limit(20).get();
      for (final doc in snap.docs) {
        if (doc.id != uid) found[doc.id] = doc;
      }
    } catch (_) {}
    return found.values.toList();
  }

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _suggestedUsers() async {
    try {
      final snap = await FirebaseFirestore.instance.collection('public_profiles').orderBy('createdAt', descending: true).limit(20).get();
      return snap.docs.where((d) => d.id != uid).take(12).toList();
    } catch (_) {
      return [];
    }
  }

  ImageProvider? _avatar(Map<String, dynamic> user) {
    final photo = '${user['profileImageUrl'] ?? ''}';
    final asset = '${user['profileAvatarAsset'] ?? ''}';
    if (photo.isNotEmpty) return NetworkImage(photo);
    if (asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  Future<void> _openChat(BuildContext sheetContext, QueryDocumentSnapshot<Map<String, dynamic>> doc) async {
    final user = doc.data();
    final name = '${user['displayName'] ?? 'مستخدم Shadow Live'}';
    final photo = '${user['profileImageUrl'] ?? ''}';
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
    Navigator.push(context, MaterialPageRoute(builder: (_) => PrivateChatScreen(conversationId: id, otherUid: doc.id, otherName: name, otherPhoto: photo)));
  }

  Widget _userTile(BuildContext sheetContext, QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final user = doc.data();
    final name = '${user['displayName'] ?? 'مستخدم Shadow Live'}';
    final provider = _avatar(user);
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: CircleAvatar(
        backgroundColor: const Color(0xFF25183F),
        backgroundImage: provider,
        child: provider == null ? const Icon(Icons.person, color: Color(0xFFFFD54A)) : null,
      ),
      title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      subtitle: Text('ID: ${user['publicId'] ?? doc.id}', style: const TextStyle(color: Colors.white54)),
      trailing: IconButton(tooltip:'فتح الملف الشخصي',icon:const Icon(Icons.person_outline_rounded,color:Colors.white54),onPressed:(){Navigator.pop(sheetContext);Navigator.push(context,MaterialPageRoute(builder:(_)=>PublicProfileScreen(userId:doc.id)));}),
      onTap: () => _openChat(sheetContext, doc),
    );
  }

  Future<void> _newChat() async {
    final controller = TextEditingController();
    var results = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    var suggestions = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    var loading = false;
    var loadingSuggestions = true;
    var searchVersion = 0;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101522),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) {
            if (loadingSuggestions) {
              loadingSuggestions = false;
              _suggestedUsers().then((value) {
                if (sheetContext.mounted) setSheetState(() => suggestions = value);
              });
            }
            final searching = controller.text.trim().length >= 2;
            return Padding(
              padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(context).viewInsets.bottom + 18),
              child: SizedBox(
                height: MediaQuery.of(context).size.height * .72,
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
                    const SizedBox(height: 14),
                    Expanded(
                      child: loading
                          ? const Center(child: CircularProgressIndicator(color: Color(0xFF8A3DFF)))
                          : searching
                              ? (results.isEmpty
                                  ? const Center(child: Text('لا توجد نتائج', style: TextStyle(color: Colors.white54)))
                                  : ListView.builder(itemCount: results.length, itemBuilder: (_, i) => _userTile(sheetContext, results[i])))
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    const Text('مقترح لك', style: TextStyle(color: Color(0xFFFFD54A), fontSize: 17, fontWeight: FontWeight.w900)),
                                    const SizedBox(height: 4),
                                    const Text('أحدث الحسابات المنضمة إلى Shadow Live', style: TextStyle(color: Colors.white38, fontSize: 12)),
                                    const SizedBox(height: 8),
                                    Expanded(
                                      child: suggestions.isEmpty
                                          ? const Center(child: Text('لا توجد حسابات مقترحة حالياً', style: TextStyle(color: Colors.white38)))
                                          : ListView.builder(itemCount: suggestions.length, itemBuilder: (_, i) => _userTile(sheetContext, suggestions[i])),
                                    ),
                                  ],
                                ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
    controller.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
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
                      ..sort((a, b) => ((b.data()['updatedAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0).compareTo((a.data()['updatedAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0));
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
                        return _ConversationTile(id: doc.id, otherUid: other, lastMessage: '${data['lastMessage'] ?? ''}', unread: unread, updatedAt: data['updatedAt']);
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
  Widget build(BuildContext context) {
    return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      future: otherUid.isEmpty ? null : FirebaseFirestore.instance.collection('public_profiles').doc(otherUid).get(),
      builder: (context, snapshot) {
        final user = snapshot.data?.data() ?? const <String, dynamic>{};
        final name = '${user['displayName'] ?? 'مستخدم Shadow Live'}';
        final photo = '${user['profileImageUrl'] ?? ''}';
        final asset = '${user['profileAvatarAsset'] ?? ''}';
        ImageProvider? provider;
        if (photo.isNotEmpty) provider = NetworkImage(photo);
        if (photo.isEmpty && asset.isNotEmpty) provider = AssetImage(asset);
        return Material(
          color: const Color(0xFF101522),
          borderRadius: BorderRadius.circular(18),
          child: ListTile(
            leading: CircleAvatar(
              backgroundColor: const Color(0xFF25183F),
              backgroundImage: provider,
              child: provider == null ? const Icon(Icons.person, color: Color(0xFFFFD54A)) : null,
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
            onTap: otherUid.isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => PrivateChatScreen(conversationId: id, otherUid: otherUid, otherName: name, otherPhoto: photo))),
            onLongPress: otherUid.isEmpty ? null : () => showModalBottomSheet<void>(context: context, backgroundColor: const Color(0xFF101522), shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))), builder: (sheetContext) => Directionality(textDirection: TextDirection.rtl, child: SafeArea(child: Wrap(children: [ListTile(leading: const Icon(Icons.person_outline_rounded, color: Color(0xFFFFD54A)), title: const Text('عرض الملف الشخصي', style: TextStyle(color: Colors.white)), onTap: () {Navigator.pop(sheetContext);Navigator.push(context, MaterialPageRoute(builder: (_) => PublicProfileScreen(userId: otherUid)));}), ListTile(leading: const Icon(Icons.close_rounded, color: Colors.white54), title: const Text('إغلاق', style: TextStyle(color: Colors.white70)), onTap: () => Navigator.pop(sheetContext))]))),
          ),
        );
      },
    );
  }
}
