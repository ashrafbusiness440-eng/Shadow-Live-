import 'dart:async';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

class DiscoverySearchScreen extends StatefulWidget {
  const DiscoverySearchScreen({super.key});
  @override
  State<DiscoverySearchScreen> createState() => _DiscoverySearchScreenState();
}

class _DiscoverySearchScreenState extends State<DiscoverySearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  bool _loading = false;
  String? _error;
  List<Map<String, dynamic>> _people = [];
  List<Map<String, dynamic>> _rooms = [];

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _changed(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 450), () => _search(value.trim()));
  }

  Future<void> _search(String q) async {
    if (q.length < 2) {
      if (mounted) {
        setState(() {
          _people = [];
          _rooms = [];
          _error = null;
          _loading = false;
        });
      }
      return;
    }
    setState(() {_loading = true; _error = null;});
    try {
      final people = <Map<String, dynamic>>[];
      final rooms = <Map<String, dynamic>>[];
      final id = await FirebaseFirestore.instance.collection('public_ids').doc(q).get();
      if (id.exists) {
        final uid = id.data()?['uid']?.toString();
        if (uid != null) {
          final u = await FirebaseFirestore.instance.collection('users').doc(uid).get();
          if (u.exists) people.add({...?u.data(), 'uid': uid});
        }
      }
      try {
        final users = await FirebaseFirestore.instance.collection('users').orderBy('displayName').startAt([q]).endAt(['$q\uf8ff']).limit(12).get();
        for (final d in users.docs) {
          if (!people.any((x) => x['uid'] == d.id)) people.add({...d.data(), 'uid': d.id});
        }
      } catch (_) {}
      try {
        final rs = await FirebaseFirestore.instance.collection('rooms').orderBy('name').startAt([q]).endAt(['$q\uf8ff']).limit(12).get();
        for (final d in rs.docs) {
          rooms.add({...d.data(), 'roomId': d.id});
        }
      } catch (_) {}
      if (mounted) setState(() {_people = people; _rooms = rooms;});
    } catch (_) {
      if (mounted) setState(() => _error = 'تعذر البحث حالياً. حاول مرة أخرى.');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  ImageProvider? _avatar(Map<String, dynamic> p) {
    final u = (p['profileImageUrl'] ?? p['avatarUrl'])?.toString();
    if (u != null && u.isNotEmpty) return NetworkImage(u);
    final a = p['profileAvatarAsset']?.toString();
    return a != null && a.isNotEmpty ? AssetImage(a) : null;
  }

  Widget _personCard(Map<String, dynamic> p) {
    final avatar = _avatar(p);
    return Card(
      color: const Color(0xFF101827),
      child: ListTile(
        leading: CircleAvatar(backgroundImage: avatar, child: avatar == null ? const Icon(Icons.person) : null),
        title: Text((p['displayName'] ?? p['username'] ?? 'مستخدم').toString(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        subtitle: Text('ID: ${p['publicId'] ?? '—'}', style: const TextStyle(color: Colors.white54)),
      ),
    );
  }

  Widget _roomCard(Map<String, dynamic> r) {
    return Card(
      color: const Color(0xFF101827),
      child: ListTile(
        leading: const CircleAvatar(child: Icon(Icons.mic)),
        title: Text((r['name'] ?? r['title'] ?? 'غرفة').toString(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        subtitle: Text('${r['onlineCount'] ?? r['memberCount'] ?? 0} متصل', style: const TextStyle(color: Colors.white54)),
      ),
    );
  }

  Widget _results() {
    if (_error != null) return Center(child: Text(_error!, style: const TextStyle(color: Colors.white60)));
    if (_controller.text.trim().length < 2) return const Center(child: Text('اكتب حرفين على الأقل للبحث', style: TextStyle(color: Colors.white38)));
    if (_people.isEmpty && _rooms.isEmpty && !_loading) return const Center(child: Text('لا توجد نتائج', style: TextStyle(color: Colors.white54)));
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        if (_people.isNotEmpty) ...[const _Heading('أشخاص'), ..._people.map(_personCard)],
        if (_rooms.isNotEmpty) ...[const _Heading('غرف'), ..._rooms.map(_roomCard)],
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        appBar: AppBar(backgroundColor: const Color(0xFF0A1020), title: const Text('البحث والاستكشاف')),
        body: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(16),
              child: TextField(
                controller: _controller,
                onChanged: _changed,
                autofocus: true,
                style: const TextStyle(color: Colors.white),
                decoration: InputDecoration(
                  hintText: 'اسم المستخدم، ID أو اسم الغرفة',
                  hintStyle: const TextStyle(color: Colors.white38),
                  prefixIcon: const Icon(Icons.search, color: Color(0xFF8A3DFF)),
                  filled: true,
                  fillColor: const Color(0xFF111827),
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                ),
              ),
            ),
            if (_loading) const LinearProgressIndicator(),
            Expanded(child: _results()),
          ],
        ),
      ),
    );
  }
}

class _Heading extends StatelessWidget {
  final String text;
  const _Heading(this.text);
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(4,18,4,8),
    child: Text(text, style: const TextStyle(color: Color(0xFFFFD54A), fontSize: 18, fontWeight: FontWeight.w900)),
  );
}
