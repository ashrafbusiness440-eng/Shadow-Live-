import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';
import '../../../services/numeric_id_service.dart';

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});

  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _usernameController = TextEditingController();
  final _displayNameController = TextEditingController();
  final _bioController = TextEditingController();
  bool _checkingUsername = false;
  bool _usernameAvailable = false;
  String? _usernameStatus;
  int _usernameCheckId = 0;
  String? _gender = 'أنثى';
  String? _selectedLocation;
  DateTime? _birthDate;
  final ImagePicker _imagePicker = ImagePicker();
  String? _selectedAvatarAsset = 'assets/images/avatars/female_1.png';
  Uint8List? _pickedImageBytes;

  static const _maleAvatars = [
    'assets/images/avatars/male_1.png','assets/images/avatars/male_2.png','assets/images/avatars/male_3.png','assets/images/avatars/male_4.png','assets/images/avatars/male_5.png','assets/images/avatars/male_6.png',
  ];
  static const _femaleAvatars = [
    'assets/images/avatars/female_1.png','assets/images/avatars/female_2.png','assets/images/avatars/female_3.png','assets/images/avatars/female_4.png','assets/images/avatars/female_5.png','assets/images/avatars/female_6.png',
  ];
  List<String> get _currentAvatars => _gender == 'ذكر' ? _maleAvatars : _femaleAvatars;

  static const _countries = [
    '🇦🇪 الإمارات العربية المتحدة','🇸🇦 السعودية','🇸🇾 سوريا','🇯🇴 الأردن','🇱🇧 لبنان','🇮🇶 العراق','🇵🇸 فلسطين','🇰🇼 الكويت','🇶🇦 قطر','🇧🇭 البحرين','🇴🇲 عُمان','🇾🇪 اليمن','🇪🇬 مصر','🇱🇾 ليبيا','🇹🇳 تونس','🇩🇿 الجزائر','🇲🇦 المغرب','🇸🇩 السودان','🇸🇴 الصومال','🇩🇯 جيبوتي','🇲🇷 موريتانيا','🇰🇲 جزر القمر','🇹🇷 تركيا','🇺🇸 الولايات المتحدة','🇬🇧 المملكة المتحدة','🇫🇷 فرنسا','🇩🇪 ألمانيا','🇮🇹 إيطاليا','🇪🇸 إسبانيا','🇵🇹 البرتغال','🇳🇱 هولندا','🇧🇪 بلجيكا','🇨🇭 سويسرا','🇦🇹 النمسا','🇸🇪 السويد','🇳🇴 النرويج','🇩🇰 الدنمارك','🇫🇮 فنلندا','🇮🇪 أيرلندا','🇵🇱 بولندا','🇨🇿 التشيك','🇬🇷 اليونان','🇷🇴 رومانيا','🇧🇬 بلغاريا','🇭🇺 المجر','🇭🇷 كرواتيا','🇷🇸 صربيا','🇸🇰 سلوفاكيا','🇸🇮 سلوفينيا','🇱🇺 لوكسمبورغ','🇮🇸 آيسلندا','🇲🇹 مالطا','🇨🇾 قبرص','🇪🇪 إستونيا','🇱🇻 لاتفيا','🇱🇹 ليتوانيا','🇺🇦 أوكرانيا',
  ];

  @override
  void dispose() {
    _usernameController.dispose();
    _displayNameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  Future<void> _checkUsername(String value) async {
    final username = value.trim().toLowerCase();
    final id = ++_usernameCheckId;
    if (username.isEmpty || !RegExp(r'^[a-zA-Z0-9]{3,}$').hasMatch(username)) {
      setState(() { _checkingUsername=false; _usernameAvailable=false; _usernameStatus=username.isEmpty?null:'استخدم 3 أحرف إنجليزية أو أرقام على الأقل'; });
      return;
    }
    setState(() { _checkingUsername=true; _usernameAvailable=false; _usernameStatus='جاري التحقق...'; });
    await Future<void>.delayed(const Duration(milliseconds: 450));
    if (id != _usernameCheckId) return;
    try {
      final doc = await FirebaseFirestore.instance.collection('usernames').doc(username).get();
      if (!mounted || id != _usernameCheckId) return;
      final uid = FirebaseAuth.instance.currentUser?.uid;
      final available = !doc.exists || doc.data()?['uid'] == uid;
      setState(() { _checkingUsername=false; _usernameAvailable=available; _usernameStatus=available?'✓ اسم المستخدم متاح':'✕ اسم المستخدم مستخدم بالفعل'; });
    } catch (_) {
      if (mounted) setState(() { _checkingUsername=false; _usernameAvailable=false; _usernameStatus='تعذر التحقق من اسم المستخدم'; });
    }
  }

  bool get _hasProfileImage => _selectedAvatarAsset != null || _pickedImageBytes != null;

  Future<void> _pickImageFromPhone() async {
    final image = await _imagePicker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1200);
    if (image == null) return;
    final bytes = await image.readAsBytes();
    if (!mounted) return;
    setState(() { _pickedImageBytes=bytes; _selectedAvatarAsset=null; });
    Navigator.of(context).pop();
  }

  Future<void> _showImagePicker() async {
    await showModalBottomSheet<void>(context: context, backgroundColor: const Color(0xFF08111F), builder: (sheetContext) => Directionality(textDirection: TextDirection.rtl, child: SafeArea(child: Padding(padding: const EdgeInsets.all(20), child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Text('اختر صورة الحساب', style: TextStyle(color: Colors.white,fontSize:22,fontWeight:FontWeight.w900)), const SizedBox(height:16),
      Wrap(spacing:10,runSpacing:10,children:_currentAvatars.map((a)=>GestureDetector(onTap:(){setState((){_selectedAvatarAsset=a;_pickedImageBytes=null;});Navigator.pop(sheetContext);},child:CircleAvatar(radius:38,backgroundImage:AssetImage(a)))).toList()),
      const SizedBox(height:18), OutlinedButton.icon(onPressed:_pickImageFromPhone,icon:const Icon(Icons.photo_library_rounded),label:const Text('اختيار صورة من الهاتف')),
    ])))));
  }

  Future<void> _pickBirthDate() async {
    final now=DateTime.now();
    final result=await showDatePicker(context:context,initialDate:DateTime(2000),firstDate:DateTime(1940),lastDate:DateTime(now.year-18,now.month,now.day),helpText:'اختر تاريخ الميلاد');
    if(result!=null)setState(()=>_birthDate=result);
  }

  Future<void> _next() async {
    if(!_formReady){_message('أكمل جميع البيانات المطلوبة');return;}
    final user=FirebaseAuth.instance.currentUser;
    if(user==null){_message('يجب تسجيل الدخول أولاً');return;}
    final username=_usernameController.text.trim().toLowerCase();
    try {
      final usernameRef=FirebaseFirestore.instance.collection('usernames').doc(username);
      await FirebaseFirestore.instance.runTransaction((tx) async {
        final snap=await tx.get(usernameRef);
        if(snap.exists && snap.data()?['uid']!=user.uid)throw Exception('USERNAME_TAKEN');
        if(!snap.exists)tx.set(usernameRef,{'uid':user.uid,'username':username,'createdAt':FieldValue.serverTimestamp()});
      });
      final numericId=await NumericIdService.ensureForUser(user.uid);
      String? photoUrl;
      if(_pickedImageBytes!=null){
        final storageRef=FirebaseStorage.instance.ref().child('profile_images').child('${user.uid}.jpg');
        await storageRef.putData(_pickedImageBytes!,SettableMetadata(contentType:'image/jpeg'));
        photoUrl=await storageRef.getDownloadURL();
      }
      await FirebaseFirestore.instance.collection('users').doc(user.uid).set({
        'uid':user.uid,'numericId':numericId,'username':username,'displayName':_displayNameController.text.trim(),'bio':_bioController.text.trim(),'gender':_gender,'birthDate':Timestamp.fromDate(_birthDate!),'location':_selectedLocation,
        'profileImageUrl':photoUrl,'profileAvatarAsset':photoUrl==null?_selectedAvatarAsset:null,'setupStep':'success','updatedAt':FieldValue.serverTimestamp(),
      },SetOptions(merge:true));
      if(!mounted)return;
      Navigator.of(context).pushReplacementNamed('/account-success');
    } catch(e){if(mounted)_message(e.toString().contains('USERNAME_TAKEN')?'اسم المستخدم مستخدم بالفعل':'تعذر حفظ الملف الشخصي، حاول مرة أخرى');}
  }

  bool get _formReady => _hasProfileImage && _usernameController.text.trim().isNotEmpty && _usernameAvailable && !_checkingUsername && _displayNameController.text.trim().isNotEmpty && _gender!=null && _birthDate!=null && _selectedLocation!=null;
  void _message(String text)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(text)));

  @override
  Widget build(BuildContext context) => Directionality(textDirection:TextDirection.rtl,child:Scaffold(backgroundColor:const Color(0xFF020711),body:SafeArea(child:ListView(padding:const EdgeInsets.all(20),children:[
    const SizedBox(height:16),const Text('إعداد الملف الشخصي',textAlign:TextAlign.center,style:TextStyle(color:Colors.white,fontSize:26,fontWeight:FontWeight.w900)),const SizedBox(height:22),
    Center(child:GestureDetector(onTap:_showImagePicker,child:CircleAvatar(radius:52,backgroundColor:const Color(0xFF21163A),backgroundImage:_pickedImageBytes!=null?MemoryImage(_pickedImageBytes!):(_selectedAvatarAsset!=null?AssetImage(_selectedAvatarAsset!) as ImageProvider:null),child:!_hasProfileImage?const Icon(Icons.add_a_photo,color:Colors.white):null))),const SizedBox(height:20),
    TextField(controller:_usernameController,onChanged:_checkUsername,style:const TextStyle(color:Colors.white),decoration:InputDecoration(labelText:'اسم المستخدم',labelStyle:const TextStyle(color:Colors.white70),helperText:_usernameStatus,helperStyle:TextStyle(color:_usernameAvailable?Colors.greenAccent:Colors.white60))),const SizedBox(height:12),
    TextField(controller:_displayNameController,onChanged:(_)=>setState((){}),style:const TextStyle(color:Colors.white),decoration:const InputDecoration(labelText:'الاسم الظاهر',labelStyle:TextStyle(color:Colors.white70))),const SizedBox(height:12),
    TextField(controller:_bioController,style:const TextStyle(color:Colors.white),decoration:const InputDecoration(labelText:'نبذة قصيرة',labelStyle:TextStyle(color:Colors.white70))),const SizedBox(height:18),
    const Text('الجنس',style:TextStyle(color:Colors.white,fontWeight:FontWeight.bold)),Row(children:[Expanded(child:RadioListTile<String>(title:const Text('أنثى',style:TextStyle(color:Colors.white)),value:'أنثى',groupValue:_gender,onChanged:(v)=>setState((){_gender=v;_selectedAvatarAsset=_femaleAvatars.first;_pickedImageBytes=null;}))),Expanded(child:RadioListTile<String>(title:const Text('ذكر',style:TextStyle(color:Colors.white)),value:'ذكر',groupValue:_gender,onChanged:(v)=>setState((){_gender=v;_selectedAvatarAsset=_maleAvatars.first;_pickedImageBytes=null;})))]),
    ListTile(onTap:_pickBirthDate,title:Text(_birthDate==null?'اختر تاريخ الميلاد':'${_birthDate!.year}/${_birthDate!.month.toString().padLeft(2,'0')}/${_birthDate!.day.toString().padLeft(2,'0')}',style:const TextStyle(color:Colors.white)),trailing:const Icon(Icons.calendar_month,color:Color(0xFFFFC84A))),
    DropdownButtonFormField<String>(initialValue:_selectedLocation,dropdownColor:const Color(0xFF10121D),style:const TextStyle(color:Colors.white),decoration:const InputDecoration(labelText:'الدولة',labelStyle:TextStyle(color:Colors.white70)),items:_countries.map((c)=>DropdownMenuItem(value:c,child:Text(c))).toList(),onChanged:(v)=>setState(()=>_selectedLocation=v)),const SizedBox(height:24),
    SizedBox(height:54,child:ElevatedButton(onPressed:_formReady?_next:null,child:const Text('التالي'))),const SizedBox(height:30),
  ]))));
}
