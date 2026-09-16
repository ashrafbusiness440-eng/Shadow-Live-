import 'dart:async';
import 'dart:typed_data';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'profile_image_crop_screen.dart';
import 'cover_image_crop_screen.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});
  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  static const _bg = Color(0xFF050814), _purple = Color(0xFF8B5CF6), _gold = Color(0xFFFFD166);
  final _key = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _bio = TextEditingController();
  final _picker = ImagePicker();
  Map<String, dynamic> _data = {};
  bool _loading = true, _saving = false;
  String _gender = 'أنثى';
  String? _avatar, _country;
  DateTime? _birth;
  Uint8List? _newAvatar, _newCover;
  bool _removeCover = false;
  final Set<String> _interests = {};

  static const interests = ['موسيقى','ألعاب','رياضة','أفلام ومسلسلات','أنمي','تقنية','سيارات','سفر','طبخ','أعمال','تعلم ولغات','ثقافة','فن وتصميم','تصوير','موضة'];
  static const countries = ['الإمارات','السعودية','سوريا','الأردن','لبنان','العراق','مصر','الكويت','قطر','البحرين','عُمان','فلسطين','اليمن','المغرب','الجزائر','تونس','ليبيا','السودان','تركيا','أخرى'];

  @override
  void initState() { super.initState(); _load(); }
  @override
  void dispose() { _name.dispose(); _bio.dispose(); super.dispose(); }

  Future<void> _load() async {
    final u = FirebaseAuth.instance.currentUser;
    if (u == null) { if (mounted) setState(() => _loading = false); return; }
    try {
      final s = await FirebaseFirestore.instance.collection('users').doc(u.uid).get().timeout(const Duration(seconds: 12));
      final d = s.data() ?? <String, dynamic>{};
      _data = d;
      _name.text = (d['displayName'] ?? '').toString();
      _bio.text = (d['bio'] ?? '').toString();
      _gender = (d['gender'] ?? 'أنثى').toString();
      _avatar = d['profileAvatarAsset']?.toString();
      _country = d['location']?.toString();
      if (d['birthDate'] is Timestamp) _birth = (d['birthDate'] as Timestamp).toDate();
      if (d['interests'] is List) _interests.addAll((d['interests'] as List).map((e) => e.toString()));
    } finally { if (mounted) setState(() => _loading = false); }
  }

  List<String> get _avatars => List.generate(6, (i) => 'assets/images/avatars/${_gender == 'ذكر' ? 'male' : 'female'}_${i + 1}.png');
  bool get _birthOk => _data['birthDateChangedByUser'] != true;
  bool get _locationOk { final t = _data['locationLastChangedAt']; return t is! Timestamp || DateTime.now().difference(t.toDate()).inDays >= 7; }

  Future<void> _pickAvatar() async {
    final x = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 95);
    if (x == null || !mounted) return;
    final bytes = await x.readAsBytes();
    if (!mounted) return;
    final cropped = await Navigator.push<Uint8List>(context, MaterialPageRoute(builder: (_) => ProfileImageCropScreen(imageData: bytes)));
    if (cropped != null && mounted) setState(() { _newAvatar = cropped; _avatar = null; });
  }

  Future<void> _pickCover() async {
    final x = await _picker.pickImage(source: ImageSource.gallery, imageQuality: 95);
    if (x == null || !mounted) return;
    final bytes = await x.readAsBytes();
    if (!mounted) return;
    final cropped = await Navigator.push<Uint8List>(context, MaterialPageRoute(builder: (_) => CoverImageCropScreen(imageData: bytes)));
    if (cropped != null && mounted) setState(() { _newCover = cropped; _removeCover = false; });
  }

  Future<String> _upload(Uint8List b, String path) async {
    final r = FirebaseStorage.instance.ref(path);
    await r.putData(b, SettableMetadata(contentType: 'image/jpeg')).timeout(const Duration(seconds: 25));
    return r.getDownloadURL().timeout(const Duration(seconds: 12));
  }

  List<String> get _ids {
    final out = <String>[];
    final c = _data['publicId']?.toString();
    if (c != null && c.isNotEmpty) out.add(c);
    final h = _data['publicIdHistory'];
    if (h is List) for (final x in h) { final id = x is Map ? x['id']?.toString() : x.toString(); if (id != null && id.isNotEmpty && !out.contains(id)) out.add(id); }
    return out;
  }

  Future<void> _copyIds() async { if (_ids.isEmpty) return; await Clipboard.setData(ClipboardData(text: _ids.first)); if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم نسخ ID'))); }
  Future<void> _pickBirth() async { if (!_birthOk) { _msg('تم استخدام تغيير تاريخ الميلاد. للتغيير مرة أخرى تواصل مع الإدارة.'); return; } final n = DateTime.now(); final p = await showDatePicker(context: context, initialDate: _birth ?? DateTime(n.year - 18), firstDate: DateTime(1900), lastDate: n); if (p != null) setState(() => _birth = p); }

  Future<void> _save() async {
    if (_saving || !_key.currentState!.validate()) return;
    final u = FirebaseAuth.instance.currentUser;
    if (u == null) { _msg('انتهت جلسة تسجيل الدخول'); return; }
    setState(() => _saving = true);
    try {
      final up = <String, dynamic>{'displayName': _name.text.trim(), 'bio': _bio.text.trim(), 'gender': _gender, 'interests': _interests.toList(), 'updatedAt': FieldValue.serverTimestamp()};
      if (_newAvatar != null) { up['profileImageUrl'] = await _upload(_newAvatar!, 'profile_images/${u.uid}.jpg'); up['profileAvatarAsset'] = FieldValue.delete(); }
      else if (_avatar != null) { up['profileAvatarAsset'] = _avatar; up['profileImageUrl'] = FieldValue.delete(); }
      if (_newCover != null) up['coverImageUrl'] = await _upload(_newCover!, 'profile_covers/${u.uid}.jpg'); else if (_removeCover) up['coverImageUrl'] = FieldValue.delete();
      if (_birth != null && _birthOk) { final o = _data['birthDate']; final od = o is Timestamp ? o.toDate() : null; if (od == null || od.year != _birth!.year || od.month != _birth!.month || od.day != _birth!.day) { up['birthDate'] = Timestamp.fromDate(_birth!); up['birthDateChangedByUser'] = true; up['birthDateLastChangedAt'] = FieldValue.serverTimestamp(); } }
      if (_country != null && _locationOk && _country != _data['location']) { up['location'] = _country; up['locationLastChangedAt'] = FieldValue.serverTimestamp(); }
      await FirebaseFirestore.instance.collection('users').doc(u.uid).set(up, SetOptions(merge: true)).timeout(const Duration(seconds: 15));
      if (mounted) Navigator.pop(context, true);
    } on TimeoutException { _msg('انتهت مهلة الحفظ. تحقق من الاتصال وحاول مرة أخرى.'); }
    catch (e) { _msg('تعذر حفظ التعديلات: $e'); }
    finally { if (mounted) setState(() => _saving = false); }
  }

  void _msg(String s) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s))); }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(backgroundColor: _bg, body: Center(child: CircularProgressIndicator()));
    final cover = (_data['coverImageUrl'] ?? '').toString();
    return Directionality(textDirection: TextDirection.rtl, child: Scaffold(backgroundColor: _bg, appBar: AppBar(backgroundColor: Colors.transparent, foregroundColor: Colors.white, title: const Text('تعديل الملف الشخصي')), body: Form(key: _key, child: ListView(padding: const EdgeInsets.all(16), children: [
      const Text('صورة الغلاف', style: _label), const SizedBox(height: 8),
      Container(height: 150, decoration: BoxDecoration(borderRadius: BorderRadius.circular(18), color: const Color(0xFF101827), image: _newCover != null ? DecorationImage(image: MemoryImage(_newCover!), fit: BoxFit.cover) : (!_removeCover && cover.isNotEmpty ? DecorationImage(image: NetworkImage(cover), fit: BoxFit.cover) : null)), child: Center(child: Wrap(spacing: 8, children: [FilledButton.icon(onPressed: _saving ? null : _pickCover, icon: const Icon(Icons.photo_library), label: const Text('تعديل الغلاف')), if (_newCover != null || (!_removeCover && cover.isNotEmpty)) IconButton(onPressed: _saving ? null : () => setState(() { _newCover = null; _removeCover = true; }), icon: const Icon(Icons.delete_outline, color: Colors.redAccent))]))),
      const SizedBox(height: 20), const Text('الصورة الشخصية', style: _label), Row(children: [FilledButton.icon(onPressed: _saving ? null : _pickAvatar, icon: const Icon(Icons.add_photo_alternate), label: const Text('اختيار من الهاتف')), const SizedBox(width: 8), if (_newAvatar != null) CircleAvatar(radius: 28, backgroundImage: MemoryImage(_newAvatar!))]),
      const SizedBox(height: 10), SizedBox(height: 76, child: ListView(scrollDirection: Axis.horizontal, children: _avatars.map((a) => GestureDetector(onTap: () => setState(() { _avatar = a; _newAvatar = null; }), child: Padding(padding: const EdgeInsets.only(left: 8), child: CircleAvatar(radius: 34, backgroundImage: AssetImage(a))))).toList())),
      const SizedBox(height: 18), TextFormField(controller: _name, maxLength: 20, style: const TextStyle(color: Colors.white), decoration: _dec('الاسم الظاهر'), validator: (v) { final s = v?.trim() ?? ''; if (s.length < 3) return 'الاسم يجب أن يكون 3 أحرف على الأقل'; if (!RegExp(r'^[\p{L}]', unicode: true).hasMatch(s)) return 'يجب أن يبدأ الاسم بحرف'; return null; }),
      TextFormField(controller: _bio, maxLength: 150, maxLines: 3, style: const TextStyle(color: Colors.white), decoration: _dec('النبذة الشخصية Bio')),
      const Text('ID', style: _label), ListTile(tileColor: const Color(0xFF101827), title: Text((_data['publicId'] ?? '—').toString(), style: const TextStyle(color: _gold, fontWeight: FontWeight.bold)), trailing: IconButton(onPressed: _copyIds, icon: const Icon(Icons.copy, color: _purple))),
      const SizedBox(height: 16), const Text('الجنس', style: _label), SegmentedButton<String>(segments: const [ButtonSegment(value: 'أنثى', label: Text('أنثى')), ButtonSegment(value: 'ذكر', label: Text('ذكر'))], selected: {_gender}, onSelectionChanged: (s) => setState(() { _gender = s.first; _avatar = _avatars.first; _newAvatar = null; })),
      const SizedBox(height: 16), ListTile(onTap: _pickBirth, tileColor: const Color(0xFF101827), title: const Text('تاريخ الميلاد', style: TextStyle(color: Colors.white)), subtitle: Text(_birth == null ? 'غير محدد' : '${_birth!.year}/${_birth!.month}/${_birth!.day}', style: const TextStyle(color: Colors.white60))),
      const SizedBox(height: 12), DropdownButtonFormField<String>(value: countries.contains(_country) ? _country : null, dropdownColor: const Color(0xFF101827), decoration: _dec(_locationOk ? 'الدولة / الموقع' : 'يمكن تغيير الموقع مرة كل 7 أيام'), items: countries.map((c) => DropdownMenuItem(value: c, child: Text(c))).toList(), onChanged: _locationOk ? (v) => setState(() => _country = v) : null),
      const SizedBox(height: 18), const Text('الاهتمامات', style: _label), Wrap(spacing: 8, children: interests.map((i) => FilterChip(label: Text(i), selected: _interests.contains(i), onSelected: (v) => setState(() { v ? _interests.add(i) : _interests.remove(i); }))).toList()),
      const SizedBox(height: 28), FilledButton(onPressed: _saving ? null : _save, style: FilledButton.styleFrom(backgroundColor: _purple, padding: const EdgeInsets.all(16)), child: Text(_saving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'))
    ]))));
  }

  static InputDecoration _dec(String s) => InputDecoration(labelText: s, labelStyle: const TextStyle(color: Colors.white60), filled: true, fillColor: const Color(0xFF101827), border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none));
  static const _label = TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16);
}
