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
  final _displayNameController = TextEditingController();
  final _bioController = TextEditingController();
  final ImagePicker _imagePicker = ImagePicker();
  String? _numericId;
  String? _idError;
  String? _gender = 'أنثى';
  String? _selectedLocation;
  String? _selectedAvatarAsset = 'assets/images/avatars/female_1.png';
  Uint8List? _pickedImageBytes;
  DateTime? _birthDate;

  static const _maleAvatars = ['assets/images/avatars/male_1.png','assets/images/avatars/male_2.png','assets/images/avatars/male_3.png','assets/images/avatars/male_4.png','assets/images/avatars/male_5.png','assets/images/avatars/male_6.png'];
  static const _femaleAvatars = ['assets/images/avatars/female_1.png','assets/images/avatars/female_2.png','assets/images/avatars/female_3.png','assets/images/avatars/female_4.png','assets/images/avatars/female_5.png','assets/images/avatars/female_6.png'];
  List<String> get _currentAvatars => _gender == 'ذكر' ? _maleAvatars : _femaleAvatars;
  static const _countries = ['🇦🇪 الإمارات العربية المتحدة','🇸🇦 السعودية','🇸🇾 سوريا','🇯🇴 الأردن','🇱🇧 لبنان','🇮🇶 العراق','🇵🇸 فلسطين','🇰🇼 الكويت','🇶🇦 قطر','🇧🇭 البحرين','🇴🇲 عُمان','🇾🇪 اليمن','🇪🇬 مصر','🇱🇾 ليبيا','🇹🇳 تونس','🇩🇿 الجزائر','🇲🇦 المغرب','🇸🇩 السودان','🇸🇴 الصومال','🇩🇯 جيبوتي','🇲🇷 موريتانيا','🇰🇲 جزر القمر','🇹🇷 تركيا','🇺🇸 الولايات المتحدة','🇬🇧 المملكة المتحدة','🇫🇷 فرنسا','🇩🇪 ألمانيا','🇮🇹 إيطاليا','🇪🇸 إسبانيا','🇵🇹 البرتغال','🇳🇱 هولندا','🇧🇪 بلجيكا','🇨🇭 سويسرا','🇦🇹 النمسا','🇸🇪 السويد','🇳🇴 النرويج','🇩🇰 الدنمارك','🇫🇮 فنلندا','🇮🇪 أيرلندا','🇵🇱 بولندا','🇨🇿 التشيك','🇬🇷 اليونان','🇷🇴 رومانيا','🇧🇬 بلغاريا','🇭🇺 المجر','🇭🇷 كرواتيا','🇷🇸 صربيا','🇸🇰 سلوفاكيا','🇸🇮 سلوفينيا','🇱🇺 لوكسمبورغ','🇮🇸 آيسلندا','🇲🇹 مالطا','🇨🇾 قبرص','🇪🇪 إستونيا','🇱🇻 لاتفيا','🇱🇹 ليتوانيا','🇺🇦 أوكرانيا'];

  @override
  void initState(){super.initState();WidgetsBinding.instance.addPostFrameCallback((_)=>_loadId());}
  Future<void> _loadId() async {final u=FirebaseAuth.instance.currentUser;if(u==null){if(mounted)setState(()=>_idError='يجب تسجيل الدخول أولاً');return;}try{final id=await NumericIdService.ensureForUser(u.uid);if(mounted)setState((){_numericId=id;_idError=null;});}catch(_){if(mounted)setState(()=>_idError='تعذر إنشاء ID');}}
  @override
  void dispose(){_displayNameController.dispose();_bioController.dispose();super.dispose();}
  bool get _hasImage=>_selectedAvatarAsset!=null||_pickedImageBytes!=null;
  bool get _ready=>_hasImage&&_numericId!=null&&_displayNameController.text.trim().isNotEmpty&&_birthDate!=null&&_selectedLocation!=null;

  Future<void> _pickPhone() async {final x=await _imagePicker.pickImage(source:ImageSource.gallery,imageQuality:85,maxWidth:1200);if(x==null)return;final b=await x.readAsBytes();if(!mounted)return;setState((){_pickedImageBytes=b;_selectedAvatarAsset=null;});if(mounted)Navigator.pop(context);}
  Future<void> _showImages() async {await showModalBottomSheet<void>(context:context,backgroundColor:const Color(0xFF08111F),isScrollControlled:true,shape:const RoundedRectangleBorder(borderRadius:BorderRadius.vertical(top:Radius.circular(28))),builder:(c)=>Directionality(textDirection:TextDirection.rtl,child:SafeArea(child:Padding(padding:const EdgeInsets.all(20),child:Column(mainAxisSize:MainAxisSize.min,children:[const Text('اختر صورة الحساب',style:TextStyle(color:Colors.white,fontSize:22,fontWeight:FontWeight.w900)),const SizedBox(height:8),const Text('اختر إحدى الصور الجاهزة أو صورة من هاتفك',style:TextStyle(color:Colors.white54)),const SizedBox(height:20),Wrap(spacing:12,runSpacing:12,children:_currentAvatars.map((a)=>GestureDetector(onTap:(){setState((){_selectedAvatarAsset=a;_pickedImageBytes=null;});Navigator.pop(c);},child:Container(width:82,height:82,padding:const EdgeInsets.all(3),decoration:BoxDecoration(shape:BoxShape.circle,border:Border.all(color:_selectedAvatarAsset==a?const Color(0xFFFFD54A):const Color(0xFF7237A8),width:_selectedAvatarAsset==a?3:1.5)),child:ClipOval(child:Image.asset(a,fit:BoxFit.cover))))).toList()),const SizedBox(height:22),SizedBox(width:double.infinity,height:54,child:OutlinedButton.icon(onPressed:_pickPhone,icon:const Icon(Icons.photo_library_rounded,color:Color(0xFFFFD54A)),label:const Text('اختيار صورة من الهاتف',style:TextStyle(color:Colors.white)),style:OutlinedButton.styleFrom(side:const BorderSide(color:Color(0xFF7A39B8)))))])))));}
  Future<void> _pickDate() async {final n=DateTime.now();final d=await showDatePicker(context:context,initialDate:DateTime(2000),firstDate:DateTime(1940),lastDate:DateTime(n.year-18,n.month,n.day),helpText:'اختر تاريخ الميلاد',cancelText:'إلغاء',confirmText:'اختيار');if(d!=null)setState(()=>_birthDate=d);}
  String get _date=>_birthDate==null?'اختر تاريخ الميلاد':'${_birthDate!.year}/${_birthDate!.month.toString().padLeft(2,'0')}/${_birthDate!.day.toString().padLeft(2,'0')}';
  void _msg(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s)));

  Future<void> _next() async {if(!_hasImage){_msg('اختر صورة للحساب');return;}if(_numericId==null){_msg(_idError??'جاري إنشاء ID...');return;}if(_displayNameController.text.trim().isEmpty){_msg('أدخل الاسم الظاهر');return;}if(_birthDate==null){_msg('اختر تاريخ الميلاد');return;}if(_selectedLocation==null){_msg('اختر الموقع');return;}final u=FirebaseAuth.instance.currentUser;if(u==null){_msg('يجب تسجيل الدخول أولاً');return;}try{final id=await NumericIdService.ensureForUser(u.uid);String? url;if(_pickedImageBytes!=null){final r=FirebaseStorage.instance.ref().child('profile_images').child('${u.uid}.jpg');await r.putData(_pickedImageBytes!,SettableMetadata(contentType:'image/jpeg'));url=await r.getDownloadURL();}await FirebaseFirestore.instance.collection('users').doc(u.uid).set({'uid':u.uid,'numericId':id,'displayName':_displayNameController.text.trim(),'bio':_bioController.text.trim(),'gender':_gender,'birthDate':Timestamp.fromDate(_birthDate!),'location':_selectedLocation,'profileImageUrl':url,'profileAvatarAsset':url==null?_selectedAvatarAsset:null,'setupStep':'success','updatedAt':FieldValue.serverTimestamp()},SetOptions(merge:true));if(mounted)Navigator.of(context).pushReplacementNamed('/account-success');}catch(_){if(mounted)_msg('تعذر حفظ الملف الشخصي، حاول مرة أخرى');}}

  @override
  Widget build(BuildContext context)=>Scaffold(backgroundColor:const Color(0xFF020711),body:Container(decoration:const BoxDecoration(gradient:RadialGradient(center:Alignment(.55,-.4),radius:1.2,colors:[Color(0xFF251044),Color(0xFF07111F),Color(0xFF020711)])),child:SafeArea(child:Directionality(textDirection:TextDirection.rtl,child:SingleChildScrollView(padding:const EdgeInsets.fromLTRB(22,16,22,30),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
    Row(children:[const Expanded(child:Text('إنشاء الملف الشخصي',style:TextStyle(color:Colors.white,fontSize:27,fontWeight:FontWeight.w900))),IconButton(onPressed:()=>Navigator.of(context).pushNamedAndRemoveUntil('/login',(_)=>false),icon:const Icon(Icons.arrow_forward_ios_rounded,color:Colors.white))]),const SizedBox(height:28),
    Center(child:Stack(clipBehavior:Clip.none,children:[GestureDetector(onTap:_showImages,child:Container(width:132,height:132,padding:const EdgeInsets.all(3),decoration:const BoxDecoration(shape:BoxShape.circle,gradient:LinearGradient(colors:[Color(0xFF8A00FF),Color(0xFFFF00D4)]),boxShadow:[BoxShadow(color:Color(0x558A00FF),blurRadius:24)]),child:ClipOval(child:_pickedImageBytes!=null?Image.memory(_pickedImageBytes!,fit:BoxFit.cover):Image.asset(_selectedAvatarAsset!,fit:BoxFit.cover)))),Positioned(left:-4,bottom:2,child:GestureDetector(onTap:_showImages,child:Container(width:44,height:44,decoration:BoxDecoration(shape:BoxShape.circle,color:const Color(0xFF171D31),border:Border.all(color:const Color(0xFFB84CFF))),child:const Icon(Icons.camera_alt_rounded,color:Colors.white))))])),const SizedBox(height:34),
    _label('ID'),Container(height:62,padding:const EdgeInsets.symmetric(horizontal:18),decoration:_box(),child:Row(children:[const Icon(Icons.badge_outlined,color:Color(0xFFFFD54A)),const SizedBox(width:12),Expanded(child:Text(_numericId??(_idError??'جاري إنشاء ID...'),textDirection:TextDirection.ltr,style:TextStyle(color:_numericId==null?Colors.white38:Colors.white,fontSize:18,fontWeight:FontWeight.w800,letterSpacing:2))),const Icon(Icons.lock_rounded,color:Colors.white38,size:19)])),const SizedBox(height:8),const Text('ID مكوّن من 6 أرقام، يتم إنشاؤه تلقائياً ولا يمكن تغييره',style:TextStyle(color:Colors.white38,fontSize:13)),const SizedBox(height:24),
    _label('الاسم الظاهر'),_field(_displayNameController,'أدخل اسمك الظاهر',Icons.badge_outlined),const SizedBox(height:24),_label('نبذة عنك (اختياري)'),TextField(controller:_bioController,maxLength:100,maxLines:3,style:const TextStyle(color:Colors.white),decoration:_dec('اكتب نبذة قصيرة عنك...',Icons.edit_note_rounded)),const SizedBox(height:16),const Text('معلومات إضافية',style:TextStyle(color:Colors.white,fontSize:25,fontWeight:FontWeight.w900)),const SizedBox(height:24),
    _label('الجنس'),Row(children:[Expanded(child:_gender('ذكر',Icons.male_rounded)),const SizedBox(width:12),Expanded(child:_gender('أنثى',Icons.female_rounded))]),const SizedBox(height:24),_label('تاريخ الميلاد'),InkWell(onTap:_pickDate,child:Container(height:62,padding:const EdgeInsets.symmetric(horizontal:18),decoration:_box(),child:Row(children:[const Icon(Icons.calendar_month_rounded,color:Color(0xFFFFD54A)),const SizedBox(width:12),Text(_date,style:TextStyle(color:_birthDate==null?Colors.white38:Colors.white,fontSize:16))]))),const SizedBox(height:8),const Text('يجب أن يكون عمرك 18 سنة أو أكثر لاستخدام التطبيق',style:TextStyle(color:Colors.white38,fontSize:13)),const SizedBox(height:24),
    _label('الموقع'),DropdownButtonFormField<String>(initialValue:_selectedLocation,isExpanded:true,dropdownColor:const Color(0xFF0C1728),style:const TextStyle(color:Colors.white),decoration:_dec('اختر الدولة',Icons.location_on_rounded),items:_countries.map((x)=>DropdownMenuItem(value:x,child:Text(x))).toList(),onChanged:(v)=>setState(()=>_selectedLocation=v)),const SizedBox(height:34),
    SizedBox(height:58,child:DecoratedBox(decoration:BoxDecoration(borderRadius:BorderRadius.circular(16),gradient:LinearGradient(colors:_ready?const[Color(0xFF8A00FF),Color(0xFFFF00D4)]:const[Color(0xFF303747),Color(0xFF202635)])),child:TextButton(onPressed:_ready?_next:null,child:const Text('التالي',style:TextStyle(color:Colors.white,fontSize:20,fontWeight:FontWeight.w900)))))
  ]))))));

  Widget _label(String s)=>Padding(padding:const EdgeInsets.only(bottom:9),child:Text(s,style:const TextStyle(color:Colors.white,fontSize:17,fontWeight:FontWeight.w800)));
  Widget _field(TextEditingController c,String h,IconData i)=>TextField(controller:c,onChanged:(_)=>setState((){}),style:const TextStyle(color:Colors.white),decoration:_dec(h,i));
  InputDecoration _dec(String h,IconData i)=>InputDecoration(hintText:h,hintStyle:const TextStyle(color:Colors.white38),prefixIcon:Icon(i,color:const Color(0xFFFFD54A)),filled:true,fillColor:const Color(0xFF0C1728),enabledBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(16),borderSide:const BorderSide(color:Color(0xFF263A57))),focusedBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(16),borderSide:const BorderSide(color:Color(0xFF9D28FF),width:1.5)));
  BoxDecoration _box()=>BoxDecoration(color:const Color(0xFF0C1728),borderRadius:BorderRadius.circular(16),border:Border.all(color:const Color(0xFF263A57)));
  Widget _gender(String v,IconData i){final s=_gender==v;return InkWell(onTap:()=>setState((){_gender=v;if(_pickedImageBytes==null)_selectedAvatarAsset=v=='ذكر'?_maleAvatars.first:_femaleAvatars.first;}),child:Container(height:105,decoration:BoxDecoration(color:const Color(0xFF0C1728),borderRadius:BorderRadius.circular(16),border:Border.all(color:s?const Color(0xFFFFD54A):const Color(0xFF263A57))),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[Icon(i,size:37,color:s?const Color(0xFFFFD54A):Colors.white70),const SizedBox(height:7),Text(v,style:TextStyle(color:s?const Color(0xFFFFD54A):Colors.white,fontWeight:FontWeight.w800))])));}
}
