import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:image_picker/image_picker.dart';
import '../../../shared/services/firebase_service.dart';

class ProfileSetupScreen extends StatefulWidget {
  const ProfileSetupScreen({super.key});
  @override
  State<ProfileSetupScreen> createState() => _ProfileSetupScreenState();
}

class _ProfileSetupScreenState extends State<ProfileSetupScreen> {
  final _displayNameController = TextEditingController();
  final _bioController = TextEditingController();
  final _imagePicker = ImagePicker();
  final _firebase = FirebaseService();
  String _gender = 'أنثى';
  String? _selectedLocation;
  DateTime? _birthDate;
  String? _selectedAvatarAsset = 'assets/images/avatars/female_1.png';
  Uint8List? _pickedImageBytes;
  String? _displayNameError;
  bool _saving = false;

  static const _male = [
    'assets/images/avatars/male_1.png','assets/images/avatars/male_2.png','assets/images/avatars/male_3.png','assets/images/avatars/male_4.png','assets/images/avatars/male_5.png','assets/images/avatars/male_6.png'
  ];
  static const _female = [
    'assets/images/avatars/female_1.png','assets/images/avatars/female_2.png','assets/images/avatars/female_3.png','assets/images/avatars/female_4.png','assets/images/avatars/female_5.png','assets/images/avatars/female_6.png'
  ];
  static const _countries = [
    '🇦🇪 الإمارات العربية المتحدة','🇸🇦 السعودية','🇸🇾 سوريا','🇯🇴 الأردن','🇱🇧 لبنان','🇮🇶 العراق','🇵🇸 فلسطين','🇰🇼 الكويت','🇶🇦 قطر','🇧🇭 البحرين','🇴🇲 عُمان','🇾🇪 اليمن','🇪🇬 مصر','🇱🇾 ليبيا','🇹🇳 تونس','🇩🇿 الجزائر','🇲🇦 المغرب','🇸🇩 السودان','🇸🇴 الصومال','🇩🇯 جيبوتي','🇲🇷 موريتانيا','🇰🇲 جزر القمر','🇹🇷 تركيا','🇺🇸 الولايات المتحدة','🇬🇧 المملكة المتحدة','🇫🇷 فرنسا','🇩🇪 ألمانيا','🇮🇹 إيطاليا','🇪🇸 إسبانيا','🇵🇹 البرتغال','🇳🇱 هولندا','🇧🇪 بلجيكا','🇨🇭 سويسرا','🇦🇹 النمسا','🇸🇪 السويد','🇳🇴 النرويج','🇩🇰 الدنمارك','🇫🇮 فنلندا','🇮🇪 أيرلندا','🇵🇱 بولندا','🇨🇿 التشيك','🇬🇷 اليونان','🇷🇴 رومانيا','🇧🇬 بلغاريا','🇭🇺 المجر','🇭🇷 كرواتيا','🇷🇸 صربيا','🇸🇰 سلوفاكيا','🇸🇮 سلوفينيا','🇱🇺 لوكسمبورغ','🇮🇸 آيسلندا','🇲🇹 مالطا','🇨🇾 قبرص','🇪🇪 إستونيا','🇱🇻 لاتفيا','🇱🇹 ليتوانيا','🇺🇦 أوكرانيا'
  ];

  List<String> get _avatars => _gender == 'ذكر' ? _male : _female;
  bool get _hasImage => _selectedAvatarAsset != null || _pickedImageBytes != null;
  bool get _ready => _hasImage && _validateName(_displayNameController.text) == null && _birthDate != null && !_saving;

  @override
  void dispose() {
    _displayNameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  String? _validateName(String raw) {
    final s = raw.trim();
    if (s.isEmpty) return 'أدخل الاسم الظاهر';
    if (s.length < 3) return 'الاسم الظاهر يجب أن يتكون من 3 أحرف على الأقل.';
    if (!RegExp(r'^[\p{L}]', unicode: true).hasMatch(s)) {
      return 'الاسم الظاهر يجب أن يبدأ بحرف، ولا يمكن أن يبدأ برقم.';
    }
    return null;
  }

  Future<void> _pickPhone() async {
    final x = await _imagePicker.pickImage(source: ImageSource.gallery, imageQuality: 85, maxWidth: 1200);
    if (x == null) return;
    final b = await x.readAsBytes();
    if (!mounted) return;
    setState(() { _pickedImageBytes = b; _selectedAvatarAsset = null; });
    if (Navigator.canPop(context)) Navigator.pop(context);
  }

  Future<void> _showImages() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF08111F),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(28))),
      builder: (sheetContext) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('اختر صورة الحساب', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
                  const SizedBox(height: 18),
                  Wrap(
                    spacing: 12,
                    runSpacing: 12,
                    children: _avatars.map((a) => GestureDetector(
                      onTap: () { setState(() { _selectedAvatarAsset = a; _pickedImageBytes = null; }); Navigator.pop(sheetContext); },
                      child: CircleAvatar(radius: 38, backgroundImage: AssetImage(a)),
                    )).toList(),
                  ),
                  const SizedBox(height: 20),
                  SizedBox(width: double.infinity, child: OutlinedButton.icon(
                    onPressed: _pickPhone,
                    icon: const Icon(Icons.photo_library_rounded, color: Color(0xFFFFD54A)),
                    label: const Text('اختيار صورة من الهاتف', style: TextStyle(color: Colors.white)),
                  )),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _pickBirth() async {
    final n = DateTime.now();
    final last = DateTime(n.year - 18, n.month, n.day);
    final d = await showDatePicker(context: context, initialDate: DateTime(2000), firstDate: DateTime(1940), lastDate: last, helpText: 'اختر تاريخ الميلاد', cancelText: 'إلغاء', confirmText: 'اختيار');
    if (d != null && mounted) setState(() => _birthDate = d);
  }

  Future<void> _next() async {
    if (_saving) return;
    final err = _validateName(_displayNameController.text);
    if (err != null) { setState(() => _displayNameError = err); return; }
    if (!_hasImage) { _msg('اختر صورة للحساب'); return; }
    if (_birthDate == null) { _msg('اختر تاريخ الميلاد'); return; }
    final u = FirebaseAuth.instance.currentUser;
    if (u == null) { _msg('انتهت جلسة تسجيل الدخول، سجّل الدخول من جديد'); return; }
    setState(() => _saving = true);
    try {
      String? photo;
      if (_pickedImageBytes != null) {
        photo = await _firebase.uploadFile('profile_images/${u.uid}.jpg', _pickedImageBytes!).timeout(const Duration(seconds: 35));
      }
      await _firebase.updateUserProfile(u.uid, {
        'uid': u.uid,
        'displayName': _displayNameController.text.trim(),
        'bio': _bioController.text.trim(),
        'gender': _gender,
        'birthDate': Timestamp.fromDate(_birthDate!),
        'location': _selectedLocation ?? '',
        'profileImageUrl': photo,
        'profileAvatarAsset': photo == null ? _selectedAvatarAsset : null,
        'setupStep': 'success',
        'setupComplete': false,
      }).timeout(const Duration(seconds: 12));
      await _firebase.ensurePublicId(u.uid).timeout(const Duration(seconds: 12));
      if (mounted) Navigator.of(context).pushReplacementNamed('/account-success');
    } catch (_) {
      if (mounted) _msg('تعذر حفظ الملف الشخصي. تحقق من الاتصال وحاول مجدداً.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _msg(String s) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s)));
  String get _date => _birthDate == null ? 'اختر تاريخ الميلاد' : '${_birthDate!.year}/${_birthDate!.month.toString().padLeft(2, '0')}/${_birthDate!.day.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF020711),
      body: Container(
        decoration: const BoxDecoration(gradient: RadialGradient(center: Alignment(.55, -.4), radius: 1.2, colors: [Color(0xFF251044), Color(0xFF07111F), Color(0xFF020711)])),
        child: SafeArea(child: Directionality(textDirection: TextDirection.rtl, child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(22, 16, 22, 30),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              const Expanded(child: Text('إنشاء الملف الشخصي', style: TextStyle(color: Colors.white, fontSize: 27, fontWeight: FontWeight.w900))),
              IconButton(onPressed: _saving ? null : () => Navigator.of(context).pushNamedAndRemoveUntil('/auth-choice', (r) => false), icon: const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white)),
            ]),
            const SizedBox(height: 28),
            Center(child: Stack(clipBehavior: Clip.none, children: [
              GestureDetector(onTap: _saving ? null : _showImages, child: Container(width: 132, height: 132, padding: const EdgeInsets.all(3), decoration: const BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [Color(0xFF8A00FF), Color(0xFFFF00D4)])), child: ClipOval(child: _pickedImageBytes != null ? Image.memory(_pickedImageBytes!, fit: BoxFit.cover) : Image.asset(_selectedAvatarAsset!, fit: BoxFit.cover)))),
              Positioned(left: -4, bottom: 2, child: GestureDetector(onTap: _saving ? null : _showImages, child: Container(width: 44, height: 44, decoration: BoxDecoration(shape: BoxShape.circle, color: const Color(0xFF171D31), border: Border.all(color: const Color(0xFFB84CFF))), child: const Icon(Icons.camera_alt_rounded, color: Colors.white))))
            ])),
            const SizedBox(height: 34),
            _label('الاسم الظاهر'),
            TextField(controller: _displayNameController, enabled: !_saving, maxLength: 20, maxLengthEnforcement: MaxLengthEnforcement.enforced, inputFormatters: [LengthLimitingTextInputFormatter(20)], onChanged: (v) => setState(() => _displayNameError = _validateName(v)), style: const TextStyle(color: Colors.white), decoration: _dec('أدخل اسمك الظاهر', Icons.badge_outlined).copyWith(errorText: _displayNameError)),
            const SizedBox(height: 16),
            _label('نبذة عنك (اختياري)'),
            TextField(controller: _bioController, enabled: !_saving, maxLength: 100, maxLines: 3, style: const TextStyle(color: Colors.white), decoration: _dec('اكتب نبذة قصيرة عنك', Icons.edit_note_rounded)),
            const SizedBox(height: 18),
            _label('الجنس'),
            Row(children: [Expanded(child: _genderBtn('ذكر', Icons.male_rounded)), const SizedBox(width: 12), Expanded(child: _genderBtn('أنثى', Icons.female_rounded))]),
            const SizedBox(height: 18),
            _label('تاريخ الميلاد'),
            _tile(Icons.cake_outlined, _date, _pickBirth),
            const SizedBox(height: 18),
            _label('الموقع (اختياري)'),
            DropdownButtonFormField<String>(initialValue: _selectedLocation, isExpanded: true, dropdownColor: const Color(0xFF11182A), style: const TextStyle(color: Colors.white), decoration: _dec('اختر الدولة', Icons.public_rounded), items: _countries.map((c) => DropdownMenuItem(value: c, child: Text(c, overflow: TextOverflow.ellipsis))).toList(), onChanged: _saving ? null : (v) => setState(() => _selectedLocation = v)),
            const SizedBox(height: 30),
            SizedBox(height: 58, child: DecoratedBox(decoration: BoxDecoration(borderRadius: BorderRadius.circular(17), gradient: const LinearGradient(colors: [Color(0xFF8A00FF), Color(0xFFFF00D4)])), child: TextButton(onPressed: _ready ? _next : null, child: _saving ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('متابعة', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900))))),
          ]),
        ))),
      ),
    );
  }

  Widget _genderBtn(String value, IconData icon) {
    final selected = _gender == value;
    return OutlinedButton.icon(
      onPressed: _saving ? null : () => setState(() { _gender = value; _selectedAvatarAsset = value == 'ذكر' ? _male.first : _female.first; _pickedImageBytes = null; }),
      icon: Icon(icon, color: selected ? const Color(0xFFFFD54A) : Colors.white60),
      label: Text(value, style: TextStyle(color: selected ? Colors.white : Colors.white60)),
      style: OutlinedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 15), backgroundColor: selected ? const Color(0x332B1A6B) : const Color(0xFF0C1728), side: BorderSide(color: selected ? const Color(0xFF8A5CFF) : Colors.white12)),
    );
  }

  Widget _tile(IconData icon, String text, VoidCallback action) => InkWell(onTap: _saving ? null : action, child: InputDecorator(decoration: _dec('', icon), child: Text(text, style: const TextStyle(color: Colors.white))));
  Widget _label(String text) => Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)));
  InputDecoration _dec(String hint, IconData icon) => InputDecoration(hintText: hint, hintStyle: const TextStyle(color: Colors.white38), prefixIcon: Icon(icon, color: const Color(0xFF9A5CFF)), filled: true, fillColor: const Color(0xFF0C1728), border: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: BorderSide.none), enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: const BorderSide(color: Colors.white12)), focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: const BorderSide(color: Color(0xFF8A5CFF))));
}
