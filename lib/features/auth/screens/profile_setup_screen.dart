import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});
  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _displayNameController = TextEditingController(),
      _bioController = TextEditingController();
  final _imagePicker = ImagePicker();
  String? _gender = 'أنثى', _selectedLocation;
  DateTime? _birthDate;
  String? _selectedAvatarAsset = 'assets/images/avatars/female_1.png';
  Uint8List? _pickedImageBytes;
  String? _displayNameError;
  bool _saving = false;
  static const _male = [
    'assets/images/avatars/male_1.png',
    'assets/images/avatars/male_2.png',
    'assets/images/avatars/male_3.png',
    'assets/images/avatars/male_4.png',
    'assets/images/avatars/male_5.png',
    'assets/images/avatars/male_6.png'
  ];
  static const _female = [
    'assets/images/avatars/female_1.png',
    'assets/images/avatars/female_2.png',
    'assets/images/avatars/female_3.png',
    'assets/images/avatars/female_4.png',
    'assets/images/avatars/female_5.png',
    'assets/images/avatars/female_6.png'
  ];
  List<String> get _avatars => _gender == 'ذكر' ? _male : _female;
  static const _countries = [
    '🇦🇪 الإمارات العربية المتحدة',
    '🇸🇦 السعودية',
    '🇸🇾 سوريا',
    '🇯🇴 الأردن',
    '🇱🇧 لبنان',
    '🇮🇶 العراق',
    '🇵🇸 فلسطين',
    '🇰🇼 الكويت',
    '🇶🇦 قطر',
    '🇧🇭 البحرين',
    '🇴🇲 عُمان',
    '🇾🇪 اليمن',
    '🇪🇬 مصر',
    '🇱🇾 ليبيا',
    '🇹🇳 تونس',
    '🇩🇿 الجزائر',
    '🇲🇦 المغرب',
    '🇸🇩 السودان',
    '🇸🇴 الصومال',
    '🇩🇯 جيبوتي',
    '🇲🇷 موريتانيا',
    '🇰🇲 جزر القمر',
    '🇹🇷 تركيا',
    '🇺🇸 الولايات المتحدة',
    '🇬🇧 المملكة المتحدة',
    '🇫🇷 فرنسا',
    '🇩🇪 ألمانيا',
    '🇮🇹 إيطاليا',
    '🇪🇸 إسبانيا',
    '🇵🇹 البرتغال',
    '🇳🇱 هولندا',
    '🇧🇪 بلجيكا',
    '🇨🇭 سويسرا',
    '🇦🇹 النمسا',
    '🇸🇪 السويد',
    '🇳🇴 النرويج',
    '🇩🇰 الدنمارك',
    '🇫🇮 فنلندا',
    '🇮🇪 أيرلندا',
    '🇵🇱 بولندا',
    '🇨🇿 التشيك',
    '🇬🇷 اليونان',
    '🇷🇴 رومانيا',
    '🇧🇬 بلغاريا',
    '🇭🇺 المجر',
    '🇭🇷 كرواتيا',
    '🇷🇸 صربيا',
    '🇸🇰 سلوفاكيا',
    '🇸🇮 سلوفينيا',
    '🇱🇺 لوكسمبورغ',
    '🇮🇸 آيسلندا',
    '🇲🇹 مالطا',
    '🇨🇾 قبرص',
    '🇪🇪 إستونيا',
    '🇱🇻 لاتفيا',
    '🇱🇹 ليتوانيا',
    '🇺🇦 أوكرانيا'
  ];
  @override
  void dispose() {
    _displayNameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  bool get _hasImage =>
      _selectedAvatarAsset != null || _pickedImageBytes != null;
  String? _validateName(String raw) {
    final s = raw.trim();
    if (s.isEmpty) return 'أدخل الاسم الظاهر';
    if (s.length < 3) return 'الاسم الظاهر يجب أن يتكون من 3 أحرف على الأقل.';
    if (!RegExp(r'^[\p{L}]', unicode: true).hasMatch(s))
      return 'الاسم الظاهر يجب أن يبدأ بحرف، ولا يمكن أن يبدأ برقم.';
    return null;
  }

  void _onNameChanged(String v) =>
      setState(() => _displayNameError = _validateName(v));
  bool get _ready =>
      _hasImage &&
      _validateName(_displayNameController.text) == null &&
      _gender != null &&
      _birthDate != null &&
      _selectedLocation != null &&
      !_saving;
  Future<void> _pickPhone() async {
    final x = await _imagePicker.pickImage(
        source: ImageSource.gallery, imageQuality: 85, maxWidth: 1200);
    if (x == null) return;
    final b = await x.readAsBytes();
    if (!mounted) return;
    setState(() {
      _pickedImageBytes = b;
      _selectedAvatarAsset = null;
    });
    Navigator.of(context).pop();
  }

  Future<void> _showImages() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF08111F),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (sheet) => Directionality(
        textDirection: TextDirection.rtl,
        child: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text(
                  'اختر صورة الحساب',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 22,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 18),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  children: _avatars.map((a) {
                    return GestureDetector(
                      onTap: () {
                        setState(() {
                          _selectedAvatarAsset = a;
                          _pickedImageBytes = null;
                        });
                        Navigator.pop(sheet);
                      },
                      child: CircleAvatar(
                        radius: 38,
                        backgroundImage: AssetImage(a),
                      ),
                    );
                  }).toList(),
                ),
                const SizedBox(height: 20),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: _pickPhone,
                    icon: const Icon(
                      Icons.photo_library_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    label: const Text(
                      'اختيار صورة من الهاتف',
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _pickBirth() async {
    final n = DateTime.now(), last = DateTime(n.year - 18, n.month, n.day);
    final d = await showDatePicker(
        context: context,
        initialDate: DateTime(2000),
        firstDate: DateTime(1940),
        lastDate: last,
        helpText: 'اختر تاريخ الميلاد',
        cancelText: 'إلغاء',
        confirmText: 'اختيار');
    if (d != null) setState(() => _birthDate = d);
  }

  Future<void> _next() async {
    final err = _validateName(_displayNameController.text);
    if (err != null) {
      setState(() => _displayNameError = err);
      return;
    }
    if (!_hasImage) {
      _msg('اختر صورة للحساب');
      return;
    }
    if (_birthDate == null) {
      _msg('اختر تاريخ الميلاد');
      return;
    }
    if (_selectedLocation == null) {
      _msg('اختر الموقع');
      return;
    }
    final u = FirebaseAuth.instance.currentUser;
    if (u == null) {
      _msg('يجب تسجيل الدخول أولاً');
      return;
    }
    setState(() => _saving = true);
    try {
      String? photo;
      if (_pickedImageBytes != null) {
        final r = FirebaseStorage.instance.ref('profile_images/${u.uid}.jpg');
        await r.putData(
            _pickedImageBytes!, SettableMetadata(contentType: 'image/jpeg'));
        photo = await r.getDownloadURL();
      }
      await FirebaseFirestore.instance.collection('users').doc(u.uid).set({
        'uid': u.uid,
        'displayName': _displayNameController.text.trim(),
        'bio': _bioController.text.trim(),
        'gender': _gender,
        'birthDate': Timestamp.fromDate(_birthDate!),
        'location': _selectedLocation,
        'profileImageUrl': photo,
        'profileAvatarAsset': photo == null ? _selectedAvatarAsset : null,
        'setupStep': 'success',
        'updatedAt': FieldValue.serverTimestamp()
      }, SetOptions(merge: true));
      if (mounted)
        Navigator.of(context).pushReplacementNamed('/account-success');
    } catch (e) {
      if (mounted) {
        setState(() => _saving = false);
        _msg('تعذر حفظ الملف الشخصي، حاول مرة أخرى');
      }
    }
  }

  void _msg(String s) =>
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s)));
  String get _date => _birthDate == null
      ? 'اختر تاريخ الميلاد'
      : '${_birthDate!.year}/${_birthDate!.month.toString().padLeft(2, '0')}/${_birthDate!.day.toString().padLeft(2, '0')}';
  @override
  Widget build(BuildContext context) => Scaffold(
      backgroundColor: const Color(0xFF020711),
      body: Container(
          decoration: const BoxDecoration(
              gradient: RadialGradient(
                  center: Alignment(.55, -.4),
                  radius: 1.2,
                  colors: [
                Color(0xFF251044),
                Color(0xFF07111F),
                Color(0xFF020711)
              ])),
          child: SafeArea(
              child: Directionality(
                  textDirection: TextDirection.rtl,
                  child: SingleChildScrollView(
                      padding: const EdgeInsets.fromLTRB(22, 16, 22, 30),
                      child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(children: [
                              const Expanded(
                                  child: Text('إنشاء الملف الشخصي',
                                      style: TextStyle(
                                          color: Colors.white,
                                          fontSize: 27,
                                          fontWeight: FontWeight.w900))),
                              Container(
                                  width: 46,
                                  height: 46,
                                  decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color:
                                          Colors.white.withValues(alpha: .07),
                                      border: Border.all(
                                          color: Colors.white
                                              .withValues(alpha: .18))),
                                  child: IconButton(
                                      onPressed: () => Navigator.of(context)
                                          .pushNamedAndRemoveUntil(
                                              '/auth-choice', (r) => false),
                                      icon: const Icon(
                                          Icons.arrow_forward_ios_rounded,
                                          color: Colors.white,
                                          size: 20)))
                            ]),
                            const SizedBox(height: 28),
                            Center(
                                child:
                                    Stack(clipBehavior: Clip.none, children: [
                              GestureDetector(
                                  onTap: _showImages,
                                  child: Container(
                                      width: 132,
                                      height: 132,
                                      padding: const EdgeInsets.all(3),
                                      decoration: const BoxDecoration(
                                          shape: BoxShape.circle,
                                          gradient: LinearGradient(colors: [
                                            Color(0xFF8A00FF),
                                            Color(0xFFFF00D4)
                                          ])),
                                      child: ClipOval(
                                          child: _pickedImageBytes != null
                                              ? Image.memory(_pickedImageBytes!,
                                                  fit: BoxFit.cover)
                                              : Image.asset(
                                                  _selectedAvatarAsset!,
                                                  fit: BoxFit.cover)))),
                              Positioned(
                                  left: -4,
                                  bottom: 2,
                                  child: GestureDetector(
                                      onTap: _showImages,
                                      child: Container(
                                          width: 44,
                                          height: 44,
                                          decoration: BoxDecoration(
                                              shape: BoxShape.circle,
                                              color: const Color(0xFF171D31),
                                              border: Border.all(
                                                  color:
                                                      const Color(0xFFB84CFF))),
                                          child: const Icon(
                                              Icons.camera_alt_rounded,
                                              color: Colors.white))))
                            ])),
                            const SizedBox(height: 34),
                            _label('الاسم الظاهر'),
                            TextField(
                                controller: _displayNameController,
                                maxLength: 20,
                                maxLengthEnforcement:
                                    MaxLengthEnforcement.enforced,
                                inputFormatters: [
                                  LengthLimitingTextInputFormatter(20)
                                ],
                                onChanged: _onNameChanged,
                                style: const TextStyle(
                                    color: Colors.white, fontSize: 16),
                                decoration: _dec('أدخل اسمك الظاهر',
                                        Icons.badge_outlined)
                                    .copyWith(
                                        errorText: _displayNameError,
                                        errorMaxLines: 2)),
                            const SizedBox(height: 16),
                            _label('نبذة عنك (اختياري)'),
                            TextField(
                                controller: _bioController,
                                maxLength: 100,
                                maxLines: 3,
                                style: const TextStyle(color: Colors.white),
                                decoration: _dec('اكتب نبذة قصيرة عنك...',
                                    Icons.edit_note_rounded)),
                            const SizedBox(height: 16),
                            const Text('معلومات إضافية',
                                style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 25,
                                    fontWeight: FontWeight.w900)),
                            const SizedBox(height: 24),
                            _label('الجنس'),
                            Row(children: [
                              Expanded(
                                  child:
                                      _genderCard('ذكر', Icons.male_rounded)),
                              const SizedBox(width: 12),
                              Expanded(
                                  child:
                                      _genderCard('أنثى', Icons.female_rounded))
                            ]),
                            const SizedBox(height: 24),
                            _label('تاريخ الميلاد'),
                            InkWell(
                                onTap: _pickBirth,
                                child: Container(
                                    height: 62,
                                    padding: const EdgeInsets.symmetric(
                                        horizontal: 18),
                                    decoration: _box(),
                                    child: Row(children: [
                                      const Icon(Icons.calendar_month_rounded,
                                          color: Color(0xFFFFD54A)),
                                      const SizedBox(width: 12),
                                      Text(_date,
                                          style: TextStyle(
                                              color: _birthDate == null
                                                  ? Colors.white38
                                                  : Colors.white,
                                              fontSize: 16))
                                    ]))),
                            const SizedBox(height: 8),
                            const Text(
                                'يجب أن يكون عمرك 18 سنة أو أكثر لاستخدام التطبيق',
                                style: TextStyle(
                                    color: Colors.white38, fontSize: 13)),
                            const SizedBox(height: 24),
                            _label('الموقع'),
                            DropdownButtonFormField<String>(
                                initialValue: _selectedLocation,
                                isExpanded: true,
                                dropdownColor: const Color(0xFF0C1728),
                                style: const TextStyle(
                                    color: Colors.white, fontSize: 16),
                                decoration: _dec(
                                    'اختر الدولة', Icons.location_on_rounded),
                                items: _countries
                                    .map((c) => DropdownMenuItem(
                                        value: c,
                                        child: Text(c,
                                            overflow: TextOverflow.ellipsis)))
                                    .toList(),
                                onChanged: (v) =>
                                    setState(() => _selectedLocation = v)),
                            const SizedBox(height: 34),
                            SizedBox(
                                height: 58,
                                child: DecoratedBox(
                                    decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(16),
                                        gradient: LinearGradient(
                                            colors: _ready
                                                ? const [
                                                    Color(0xFF8A00FF),
                                                    Color(0xFFFF00D4)
                                                  ]
                                                : const [
                                                    Color(0xFF303747),
                                                    Color(0xFF202635)
                                                  ])),
                                    child: TextButton(
                                        onPressed: _ready ? _next : null,
                                        child: Text(
                                            _saving
                                                ? 'جارٍ الحفظ...'
                                                : 'التالي',
                                            style: const TextStyle(
                                                color: Colors.white,
                                                fontSize: 20,
                                                fontWeight: FontWeight.w900)))))
                          ]))))));
  Widget _label(String s) => Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Text(s,
          style: const TextStyle(
              color: Colors.white, fontSize: 17, fontWeight: FontWeight.w800)));
  InputDecoration _dec(String h, IconData i) => InputDecoration(
      hintText: h,
      hintStyle: const TextStyle(color: Colors.white38),
      prefixIcon: Icon(i, color: const Color(0xFFFFD54A)),
      filled: true,
      fillColor: const Color(0xFF0C1728),
      counterStyle: const TextStyle(color: Colors.white38),
      enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFF263A57))),
      focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Color(0xFF9D28FF), width: 1.5)),
      errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Colors.redAccent)),
      focusedErrorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: Colors.redAccent, width: 1.5)));
  Widget _genderCard(String v, IconData i) {
    final s = _gender == v;
    return InkWell(
        onTap: () => setState(() {
              _gender = v;
              if (_pickedImageBytes == null)
                _selectedAvatarAsset = v == 'ذكر' ? _male.first : _female.first;
            }),
        child: Container(
            height: 105,
            decoration: BoxDecoration(
                color: const Color(0xFF0C1728),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                    color:
                        s ? const Color(0xFFFFD54A) : const Color(0xFF263A57),
                    width: s ? 1.8 : 1)),
            child:
                Column(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(i,
                  size: 37,
                  color: s ? const Color(0xFFFFD54A) : Colors.white70),
              const SizedBox(height: 7),
              Text(v,
                  style: TextStyle(
                      color: s ? const Color(0xFFFFD54A) : Colors.white,
                      fontWeight: FontWeight.w800))
            ])));
  }

  BoxDecoration _box() => BoxDecoration(
      color: const Color(0xFF0C1728),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: const Color(0xFF263A57)));
}
