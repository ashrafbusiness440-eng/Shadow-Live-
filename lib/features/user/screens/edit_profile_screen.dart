import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  static const _bg = Color(0xFF050814);
  static const _purple = Color(0xFF8B5CF6);
  static const _gold = Color(0xFFFFD166);
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _bio = TextEditingController();
  Map<String, dynamic> _data = {};
  bool _loading = true;
  bool _saving = false;
  String _gender = 'أنثى';
  String? _avatar;
  String? _country;
  DateTime? _birthDate;
  final Set<String> _interests = {};

  static const interests = ['موسيقى','ألعاب','رياضة','أفلام ومسلسلات','أنمي','تقنية','سيارات','سفر','طبخ','أعمال','تعلم ولغات','ثقافة','فن وتصميم','تصوير','موضة'];
  static const countries = ['الإمارات','السعودية','سوريا','الأردن','لبنان','العراق','مصر','الكويت','قطر','البحرين','عُمان','فلسطين','اليمن','المغرب','الجزائر','تونس','ليبيا','السودان','تركيا','أخرى'];

  @override
  void initState() { super.initState(); _load(); }

  Future<void> _load() async {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    final doc = await FirebaseFirestore.instance.collection('users').doc(uid).get();
    final d = doc.data() ?? <String,dynamic>{};
    _data = d;
    _name.text = (d['displayName'] ?? '').toString();
    _bio.text = (d['bio'] ?? '').toString();
    _gender = (d['gender'] ?? 'أنثى').toString();
    _avatar = d['profileAvatarAsset']?.toString();
    _country = d['location']?.toString();
    final birth = d['birthDate'];
    if (birth is Timestamp) _birthDate = birth.toDate();
    final list = d['interests'];
    if (list is List) _interests.addAll(list.map((e) => e.toString()));
    if (mounted) setState(() => _loading = false);
  }

  List<String> get _avatars => List.generate(6, (i) => 'assets/images/avatars/${_gender == 'ذكر' ? 'male' : 'female'}_${i + 1}.png');

  bool get _birthChangeAvailable => _data['birthDateChangedByUser'] != true;
  bool get _locationChangeAvailable {
    final last = _data['locationLastChangedAt'];
    if (last is! Timestamp) return true;
    return DateTime.now().difference(last.toDate()).inDays >= 7;
  }

  List<String> get _copyIds {
    final ids = <String>[];
    final current = _data['publicId']?.toString();
    if (current != null && current.isNotEmpty) ids.add(current);
    final history = _data['publicIdHistory'];
    if (history is List) {
      for (final item in history) {
        final id = item is Map ? item['id']?.toString() : item.toString();
        if (id != null && id.isNotEmpty && !ids.contains(id)) ids.add(id);
      }
    }
    return ids;
  }

  Future<void> _copyId() async {
    final ids = _copyIds;
    if (ids.isEmpty) return;
    if (ids.length == 1) return _copy(ids.first);
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: const Color(0xFF101827),
      builder: (_) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('اختر ID للنسخ', style: TextStyle(color: Colors.white,fontSize:18,fontWeight:FontWeight.bold)),
            const SizedBox(height: 10),
            ...ids.asMap().entries.map((e) => ListTile(
              leading: Icon(e.key == 0 ? Icons.verified_rounded : Icons.history_rounded, color: e.key == 0 ? _gold : Colors.white54),
              title: Text(e.value, style: const TextStyle(color: Colors.white)),
              subtitle: Text(e.key == 0 ? 'ID الحالي' : 'ID سابق', style: const TextStyle(color: Colors.white54)),
              trailing: const Icon(Icons.copy_rounded,color:_purple),
              onTap: () => Navigator.pop(context,e.value),
            )),
          ]),
        )),
      ),
    );
    if (selected != null) _copy(selected);
  }

  Future<void> _copy(String id) async {
    await Clipboard.setData(ClipboardData(text: id));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم نسخ ID')));
  }

  Future<void> _pickBirthDate() async {
    if (!_birthChangeAvailable) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('تم استخدام تغيير تاريخ الميلاد. للتغيير مرة أخرى تواصل مع الإدارة.')));
      return;
    }
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: _birthDate ?? DateTime(now.year - 18), firstDate: DateTime(1900), lastDate: now);
    if (picked != null) setState(() => _birthDate = picked);
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) return;
    setState(() => _saving = true);
    final update = <String,dynamic>{
      'displayName': _name.text.trim(), 'bio': _bio.text.trim(), 'gender': _gender,
      'profileAvatarAsset': _avatar, 'interests': _interests.toList(), 'updatedAt': FieldValue.serverTimestamp(),
    };
    if (_birthDate != null && _birthChangeAvailable) {
      final old = _data['birthDate'];
      final oldDate = old is Timestamp ? old.toDate() : null;
      if (oldDate == null || oldDate.year != _birthDate!.year || oldDate.month != _birthDate!.month || oldDate.day != _birthDate!.day) {
        update['birthDate'] = Timestamp.fromDate(_birthDate!);
        update['birthDateChangedByUser'] = true;
        update['birthDateLastChangedAt'] = FieldValue.serverTimestamp();
      }
    }
    if (_country != null && _locationChangeAvailable && _country != _data['location']) {
      update['location'] = _country;
      update['locationLastChangedAt'] = FieldValue.serverTimestamp();
    }
    await FirebaseFirestore.instance.collection('users').doc(uid).set(update, SetOptions(merge:true));
    if (mounted) { setState(() => _saving = false); Navigator.pop(context, true); }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Scaffold(backgroundColor:_bg,body:Center(child:CircularProgressIndicator()));
    return Directionality(textDirection:TextDirection.rtl,child:Scaffold(
      backgroundColor:_bg,
      appBar:AppBar(backgroundColor:Colors.transparent,foregroundColor:Colors.white,title:const Text('تعديل الملف الشخصي'),centerTitle:true),
      body:Form(key:_formKey,child:ListView(padding:const EdgeInsets.all(16),children:[
        const Text('الصورة الشخصية',style:_label), const SizedBox(height:10),
        SizedBox(height:82,child:ListView(scrollDirection:Axis.horizontal,children:_avatars.map((a)=>GestureDetector(onTap:()=>setState(()=>_avatar=a),child:Container(margin:const EdgeInsets.only(left:8),padding:const EdgeInsets.all(3),decoration:BoxDecoration(shape:BoxShape.circle,border:Border.all(color:_avatar==a?_gold:Colors.transparent,width:2)),child:CircleAvatar(radius:34,backgroundImage:AssetImage(a))))).toList())),
        const SizedBox(height:20),
        TextFormField(controller:_name,maxLength:20,style:const TextStyle(color:Colors.white),decoration:_dec('الاسم الظاهر'),validator:(v){final s=v?.trim()??'';if(s.length<3)return 'الاسم يجب أن يكون 3 أحرف على الأقل';if(!RegExp(r'^[\p{L}]',unicode:true).hasMatch(s))return 'يجب أن يبدأ الاسم بحرف';return null;}),
        TextFormField(controller:_bio,maxLength:150,maxLines:3,style:const TextStyle(color:Colors.white),decoration:_dec('النبذة الشخصية Bio')),
        const SizedBox(height:10), const Text('ID',style:_label), const SizedBox(height:6),
        ListTile(tileColor:const Color(0xFF101827),shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(14)),title:Text((_data['publicId']??'—').toString(),style:const TextStyle(color:_gold,fontWeight:FontWeight.bold)),subtitle:const Text('لا يمكن تعديله من الحساب',style:TextStyle(color:Colors.white54)),trailing:IconButton(onPressed:_copyId,icon:const Icon(Icons.copy_rounded,color:_purple))),
        const SizedBox(height:20), const Text('الجنس',style:_label),
        SegmentedButton<String>(segments:const [ButtonSegment(value:'أنثى',label:Text('أنثى'),icon:Icon(Icons.female)),ButtonSegment(value:'ذكر',label:Text('ذكر'),icon:Icon(Icons.male))],selected:{_gender},onSelectionChanged:(s)=>setState((){_gender=s.first;_avatar=_avatars.first;})),
        const SizedBox(height:20),
        ListTile(onTap:_pickBirthDate,tileColor:const Color(0xFF101827),shape:RoundedRectangleBorder(borderRadius:BorderRadius.circular(14)),title:const Text('تاريخ الميلاد',style:TextStyle(color:Colors.white)),subtitle:Text(_birthDate==null?'غير محدد':'${_birthDate!.year}/${_birthDate!.month}/${_birthDate!.day}',style:const TextStyle(color:Colors.white60)),trailing:Icon(_birthChangeAvailable?Icons.edit_calendar_rounded:Icons.lock_rounded,color:_birthChangeAvailable?_purple:Colors.white38)),
        const SizedBox(height:12),
        DropdownButtonFormField<String>(value:countries.contains(_country)?_country:null,dropdownColor:const Color(0xFF101827),style:const TextStyle(color:Colors.white),decoration:_dec(_locationChangeAvailable?'الدولة / الموقع':'الدولة / الموقع — التغيير متاح كل 7 أيام'),items:countries.map((c)=>DropdownMenuItem(value:c,child:Text(c))).toList(),onChanged:_locationChangeAvailable?(v)=>setState(()=>_country=v):null),
        const SizedBox(height:20), const Text('الاهتمامات',style:_label), const SizedBox(height:8),
        Wrap(spacing:8,runSpacing:8,children:interests.map((i)=>FilterChip(label:Text(i),selected:_interests.contains(i),onSelected:(v)=>setState((){v?_interests.add(i):_interests.remove(i);}))).toList()),
        const SizedBox(height:28),
        FilledButton(onPressed:_saving?null:_save,style:FilledButton.styleFrom(backgroundColor:_purple,padding:const EdgeInsets.symmetric(vertical:16)),child:Text(_saving?'جارٍ الحفظ...':'حفظ التعديلات')),
      ])),
    ));
  }

  static InputDecoration _dec(String label)=>InputDecoration(labelText:label,labelStyle:const TextStyle(color:Colors.white60),filled:true,fillColor:const Color(0xFF101827),border:OutlineInputBorder(borderRadius:BorderRadius.circular(14),borderSide:BorderSide.none));
  static const _label=TextStyle(color:Colors.white,fontWeight:FontWeight.bold,fontSize:16);

  @override
  void dispose(){_name.dispose();_bio.dispose();super.dispose();}
}
