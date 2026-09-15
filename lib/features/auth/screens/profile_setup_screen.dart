import 'dart:typed_data';

import 'package:flutter/material.dart';
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
  final _usernameController = TextEditingController();

  bool _checkingUsername = false;
  bool _usernameAvailable = false;
  String? _usernameStatus;
  int _usernameCheckId = 0;
  final _displayNameController = TextEditingController();
  final _bioController = TextEditingController();

  String? _gender = 'أنثى';
  String? _selectedLocation;

  final ImagePicker _imagePicker = ImagePicker();
  String? _selectedAvatarAsset = 'assets/images/avatars/female_1.png';
  Uint8List? _pickedImageBytes;

  static const List<String> _maleAvatars = [
    'assets/images/avatars/male_1.png',
    'assets/images/avatars/male_2.png',
    'assets/images/avatars/male_3.png',
    'assets/images/avatars/male_4.png',
    'assets/images/avatars/male_5.png',
    'assets/images/avatars/male_6.png',
  ];

  static const List<String> _femaleAvatars = [
    'assets/images/avatars/female_1.png',
    'assets/images/avatars/female_2.png',
    'assets/images/avatars/female_3.png',
    'assets/images/avatars/female_4.png',
    'assets/images/avatars/female_5.png',
    'assets/images/avatars/female_6.png',
  ];

  List<String> get _currentAvatars =>
      _gender == 'ذكر' ? _maleAvatars : _femaleAvatars;

  static const List<String> _countries = [
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
    '🇺🇦 أوكرانيا',
    '🇸🇨 الباشان',
  ];
  DateTime? _birthDate;

  @override
  void dispose() {
    _usernameController.dispose();
    _displayNameController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  Future<void> _checkUsername(String value) async {
    final username = value.trim().toLowerCase();
    final checkId = ++_usernameCheckId;

    if (username.isEmpty) {
      setState(() {
        _checkingUsername = false;
        _usernameAvailable = false;
        _usernameStatus = null;
      });
      return;
    }

    if (!RegExp(r'^[a-zA-Z0-9]+$').hasMatch(username)) {
      setState(() {
        _checkingUsername = false;
        _usernameAvailable = false;
        _usernameStatus = 'استخدم الأحرف الإنجليزية والأرقام فقط';
      });
      return;
    }

    if (username.length < 3) {
      setState(() {
        _checkingUsername = false;
        _usernameAvailable = false;
        _usernameStatus = 'اسم المستخدم يجب أن يكون 3 أحرف على الأقل';
      });
      return;
    }

    setState(() {
      _checkingUsername = true;
      _usernameAvailable = false;
      _usernameStatus = 'جاري التحقق...';
    });

    await Future<void>.delayed(const Duration(milliseconds: 500));

    if (checkId != _usernameCheckId) return;

    try {
      final doc = await FirebaseFirestore.instance
          .collection('usernames')
          .doc(username)
          .get();

      if (!mounted || checkId != _usernameCheckId) return;

      final currentUid = FirebaseAuth.instance.currentUser?.uid;
      final ownerUid = doc.data()?['uid'] as String?;

      final available =
          !doc.exists || (currentUid != null && ownerUid == currentUid);

      setState(() {
        _checkingUsername = false;
        _usernameAvailable = available;
        _usernameStatus =
            available ? '✓ اسم المستخدم متاح' : '✕ اسم المستخدم مستخدم بالفعل';
      });
    } on FirebaseException catch (e) {
      if (!mounted || checkId != _usernameCheckId) return;

      setState(() {
        _checkingUsername = false;
        _usernameAvailable = false;
        _usernameStatus = 'تعذر التحقق: ${e.code}';
      });
    } catch (e) {
      if (!mounted || checkId != _usernameCheckId) return;

      setState(() {
        _checkingUsername = false;
        _usernameAvailable = false;
        _usernameStatus = 'تعذر التحقق: $e';
      });
    }
  }

  bool get _hasProfileImage =>
      _selectedAvatarAsset != null || _pickedImageBytes != null;

  Future<void> _pickImageFromPhone() async {
    final image = await _imagePicker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
      maxWidth: 1200,
    );

    if (image == null) return;

    final bytes = await image.readAsBytes();

    if (!mounted) return;

    setState(() {
      _pickedImageBytes = bytes;
      _selectedAvatarAsset = null;
    });

    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _showImagePicker() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF08111F),
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
      ),
      builder: (sheetContext) {
        return Directionality(
          textDirection: TextDirection.rtl,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(20, 22, 20, 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 46,
                    height: 5,
                    decoration: BoxDecoration(
                      color: Colors.white24,
                      borderRadius: BorderRadius.circular(20),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    'اختر صورة الحساب',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 6),
                  const Text(
                    'اختر إحدى الصور الجاهزة أو صورة من هاتفك',
                    style: TextStyle(
                      color: Colors.white54,
                      fontSize: 14,
                    ),
                  ),
                  const SizedBox(height: 22),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 12,
                    runSpacing: 12,
                    children: _currentAvatars.map((avatar) {
                      final selected = _selectedAvatarAsset == avatar;

                      return GestureDetector(
                        onTap: () {
                          setState(() {
                            _selectedAvatarAsset = avatar;
                            _pickedImageBytes = null;
                          });
                          Navigator.of(sheetContext).pop();
                        },
                        child: Container(
                          width: 82,
                          height: 82,
                          padding: const EdgeInsets.all(3),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: selected
                                  ? const Color(0xFFFFD54A)
                                  : const Color(0xFF7237A8),
                              width: selected ? 3 : 1.5,
                            ),
                          ),
                          child: ClipOval(
                            child: Image.asset(
                              avatar,
                              fit: BoxFit.cover,
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  const SizedBox(height: 24),
                  SizedBox(
                    width: double.infinity,
                    height: 54,
                    child: OutlinedButton.icon(
                      onPressed: _pickImageFromPhone,
                      icon: const Icon(
                        Icons.photo_library_rounded,
                        color: Color(0xFFFFD54A),
                      ),
                      label: const Text(
                        'اختيار صورة من الهاتف',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFF7A39B8)),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(16),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Future<void> _pickBirthDate() async {
    final now = DateTime.now();
    final latestAllowed = DateTime(now.year - 18, now.month, now.day);

    final result = await showDatePicker(
      context: context,
      initialDate: DateTime(2000, 1, 1),
      firstDate: DateTime(1940, 1, 1),
      lastDate: latestAllowed,
      helpText: 'اختر تاريخ الميلاد',
      cancelText: 'إلغاء',
      confirmText: 'اختيار',
    );

    if (result != null) {
      setState(() => _birthDate = result);
    }
  }

  Future<void> _next() async {
    if (!_hasProfileImage) {
      _message('اختر صورة للحساب');
      return;
    }

    if (_usernameController.text.trim().isEmpty) {
      _message('أدخل اسم المستخدم');
      return;
    }

    if (!_usernameAvailable) {
      _message('اختر اسم مستخدم متاح');
      return;
    }

    if (_displayNameController.text.trim().isEmpty) {
      _message('أدخل الاسم الظاهر');
      return;
    }

    if (_gender == null) {
      _message('اختر الجنس');
      return;
    }

    if (_birthDate == null) {
      _message('اختر تاريخ الميلاد');
      return;
    }

    if (_selectedLocation == null) {
      _message('اختر الموقع');
      return;
    }

    final user = FirebaseAuth.instance.currentUser;

    if (user == null) {
      _message('يجب تسجيل الدخول أولاً');
      return;
    }

    final username = _usernameController.text.trim().toLowerCase();
    final ref =
        FirebaseFirestore.instance.collection('usernames').doc(username);

    try {
      await FirebaseFirestore.instance.runTransaction((transaction) async {
        final snapshot = await transaction.get(ref);

        if (snapshot.exists) {
          final ownerUid = snapshot.data()?['uid'] as String?;

          if (ownerUid != user.uid) {
            throw Exception('USERNAME_TAKEN');
          }

          return;
        }

        transaction.set(ref, {
          'uid': user.uid,
          'username': username,
          'createdAt': FieldValue.serverTimestamp(),
        });
      });

      String? photoUrl;

      if (_pickedImageBytes != null) {
        final storageRef = FirebaseStorage.instance
            .ref()
            .child('profile_images')
            .child('${user.uid}.jpg');

        await storageRef.putData(
          _pickedImageBytes!,
          SettableMetadata(contentType: 'image/jpeg'),
        );

        photoUrl = await storageRef.getDownloadURL();
      }

      await FirebaseFirestore.instance.collection('users').doc(user.uid).set({
        'uid': user.uid,
        'username': username,
        'displayName': _displayNameController.text.trim(),
        'bio': _bioController.text.trim(),
        'gender': _gender,
        'birthDate': Timestamp.fromDate(_birthDate!),
        'location': _selectedLocation,
        'profileImageUrl': photoUrl,
        'profileAvatarAsset': photoUrl == null ? _selectedAvatarAsset : null,
        'setupStep': 'success',
        'updatedAt': FieldValue.serverTimestamp(),
      }, SetOptions(merge: true));

      if (!mounted) return;

      Navigator.of(context).pushReplacementNamed('/account-success');
      return;
    } catch (e) {
      if (!mounted) return;

      if (e.toString().contains('USERNAME_TAKEN')) {
        setState(() {
          _usernameAvailable = false;
          _usernameStatus = '✕ اسم المستخدم مستخدم بالفعل';
        });

        _message('اسم المستخدم مستخدم بالفعل');
      } else {
        _message('تعذر حجز اسم المستخدم، حاول مرة أخرى');
      }
    }
  }

  void _message(String text) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  bool get _formReady {
    return _hasProfileImage &&
        _usernameController.text.trim().isNotEmpty &&
        _usernameAvailable &&
        !_checkingUsername &&
        _displayNameController.text.trim().isNotEmpty &&
        _gender != null &&
        _birthDate != null &&
        _selectedLocation != null;
  }

  String get _formattedDate {
    if (_birthDate == null) return 'اختر تاريخ الميلاد';

    final d = _birthDate!;
    return '${d.year}/${d.month.toString().padLeft(2, '0')}/${d.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF020711),
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            center: Alignment(0.55, -0.4),
            radius: 1.2,
            colors: [
              Color(0xFF251044),
              Color(0xFF07111F),
              Color(0xFF020711),
            ],
          ),
        ),
        child: SafeArea(
          child: Directionality(
            textDirection: TextDirection.rtl,
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(22, 16, 22, 30),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const Expanded(
                        child: Text(
                          'إنشاء الملف الشخصي',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 27,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      Container(
                        width: 46,
                        height: 46,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withValues(alpha: 0.07),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.18),
                          ),
                        ),
                        child: IconButton(
                          onPressed: () {
                            Navigator.of(context).pushNamedAndRemoveUntil(
                              '/login',
                              (route) => false,
                            );
                          },
                          icon: const Icon(
                            Icons.arrow_forward_ios_rounded,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 28),
                  Center(
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        GestureDetector(
                          onTap: _showImagePicker,
                          child: Container(
                            width: 132,
                            height: 132,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              gradient: const LinearGradient(
                                colors: [
                                  Color(0xFF8A00FF),
                                  Color(0xFFFF00D4),
                                ],
                              ),
                              boxShadow: const [
                                BoxShadow(
                                  color: Color(0x558A00FF),
                                  blurRadius: 24,
                                ),
                              ],
                            ),
                            padding: const EdgeInsets.all(3),
                            child: Container(
                              decoration: const BoxDecoration(
                                shape: BoxShape.circle,
                                color: Color(0xFF101A2C),
                              ),
                              child: ClipOval(
                                child: _pickedImageBytes != null
                                    ? Image.memory(
                                        _pickedImageBytes!,
                                        fit: BoxFit.cover,
                                        width: double.infinity,
                                        height: double.infinity,
                                      )
                                    : _selectedAvatarAsset != null
                                        ? Image.asset(
                                            _selectedAvatarAsset!,
                                            fit: BoxFit.cover,
                                            width: double.infinity,
                                            height: double.infinity,
                                          )
                                        : const Icon(
                                            Icons.person_rounded,
                                            size: 72,
                                            color: Colors.white54,
                                          ),
                              ),
                            ),
                          ),
                        ),
                        Positioned(
                          left: -4,
                          bottom: 2,
                          child: GestureDetector(
                            onTap: _showImagePicker,
                            child: Container(
                              width: 44,
                              height: 44,
                              decoration: BoxDecoration(
                                shape: BoxShape.circle,
                                color: const Color(0xFF171D31),
                                border: Border.all(
                                  color: const Color(0xFFB84CFF),
                                ),
                              ),
                              child: const Icon(
                                Icons.camera_alt_rounded,
                                color: Colors.white,
                                size: 22,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 34),
                  _label('اسم المستخدم'),
                  TextField(
                    controller: _usernameController,
                    onChanged: (value) {
                      setState(() {
                        _usernameAvailable = false;
                      });
                      _checkUsername(value);
                    },
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                    ),
                    decoration: _decoration(
                      'أدخل اسم المستخدم',
                      Icons.alternate_email_rounded,
                    ),
                  ),
                  const SizedBox(height: 8),
                  AnimatedSwitcher(
                    duration: const Duration(milliseconds: 180),
                    child: Text(
                      _usernameStatus ??
                          'يمكنك استخدام الأحرف الإنجليزية والأرقام فقط',
                      key: ValueKey(_usernameStatus),
                      style: TextStyle(
                        fontSize: 13,
                        color: _checkingUsername
                            ? Colors.white54
                            : _usernameAvailable
                                ? Colors.greenAccent
                                : _usernameStatus == null
                                    ? Colors.white38
                                    : Colors.redAccent,
                      ),
                    ),
                  ),
                  const SizedBox(height: 24),
                  _label('الاسم الظاهر'),
                  _field(
                    controller: _displayNameController,
                    hint: 'أدخل اسمك الظاهر',
                    icon: Icons.badge_outlined,
                  ),
                  const SizedBox(height: 24),
                  _label('نبذة عنك (اختياري)'),
                  TextField(
                    controller: _bioController,
                    maxLength: 100,
                    maxLines: 3,
                    style: const TextStyle(color: Colors.white),
                    decoration: _decoration(
                      'اكتب نبذة قصيرة عنك...',
                      Icons.edit_note_rounded,
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    'معلومات إضافية',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 25,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 24),
                  _label('الجنس'),
                  Row(
                    children: [
                      Expanded(
                        child: _genderCard(
                          value: 'ذكر',
                          icon: Icons.male_rounded,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: _genderCard(
                          value: 'أنثى',
                          icon: Icons.female_rounded,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 24),
                  _label('تاريخ الميلاد'),
                  InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: _pickBirthDate,
                    child: Container(
                      height: 62,
                      padding: const EdgeInsets.symmetric(horizontal: 18),
                      decoration: _boxDecoration(),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.calendar_month_rounded,
                            color: Color(0xFFFFD54A),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              _formattedDate,
                              style: TextStyle(
                                color: _birthDate == null
                                    ? Colors.white38
                                    : Colors.white,
                                fontSize: 16,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'يجب أن يكون عمرك 18 سنة أو أكثر لاستخدام التطبيق',
                    style: TextStyle(
                      color: Colors.white38,
                      fontSize: 13,
                    ),
                  ),
                  const SizedBox(height: 24),
                  _label('الموقع'),
                  DropdownButtonFormField<String>(
                    initialValue: _selectedLocation,
                    isExpanded: true,
                    dropdownColor: const Color(0xFF0C1728),
                    icon: const Icon(
                      Icons.keyboard_arrow_down_rounded,
                      color: Color(0xFFFFD54A),
                    ),
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                    ),
                    decoration: _decoration(
                      'اختر الدولة',
                      Icons.location_on_rounded,
                    ),
                    items: _countries
                        .map(
                          (country) => DropdownMenuItem<String>(
                            value: country,
                            child: Text(
                              country,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        )
                        .toList(),
                    onChanged: (value) {
                      setState(() {
                        _selectedLocation = value;
                      });
                    },
                  ),
                  const SizedBox(height: 34),
                  SizedBox(
                    height: 58,
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(16),
                        gradient: LinearGradient(
                          colors: _formReady
                              ? const [
                                  Color(0xFF8A00FF),
                                  Color(0xFFFF00D4),
                                ]
                              : const [
                                  Color(0xFF303747),
                                  Color(0xFF202635),
                                ],
                        ),
                        boxShadow: const [
                          BoxShadow(
                            color: Color(0x558A00FF),
                            blurRadius: 20,
                          ),
                        ],
                      ),
                      child: TextButton(
                        onPressed: _formReady ? _next : null,
                        child: const Text(
                          'التالي',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 20,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _label(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Text(
        text,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 17,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _field({
    required TextEditingController controller,
    required String hint,
    required IconData icon,
  }) {
    return TextField(
      controller: controller,
      onChanged: (_) => setState(() {}),
      style: const TextStyle(
        color: Colors.white,
        fontSize: 16,
      ),
      decoration: _decoration(hint, icon),
    );
  }

  InputDecoration _decoration(String hint, IconData icon) {
    return InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: Colors.white38),
      prefixIcon: Icon(
        icon,
        color: const Color(0xFFFFD54A),
      ),
      filled: true,
      fillColor: const Color(0xFF0C1728),
      counterStyle: const TextStyle(color: Colors.white38),
      contentPadding: const EdgeInsets.symmetric(
        horizontal: 16,
        vertical: 18,
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFF263A57),
        ),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(16),
        borderSide: const BorderSide(
          color: Color(0xFF9D28FF),
          width: 1.5,
        ),
      ),
    );
  }

  Widget _genderCard({
    required String value,
    required IconData icon,
  }) {
    final selected = _gender == value;

    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: () {
        setState(() {
          if (_gender == value) return;

          _gender = value;

          if (_pickedImageBytes == null) {
            _selectedAvatarAsset =
                value == 'ذكر' ? _maleAvatars.first : _femaleAvatars.first;
          }
        });
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        height: 105,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: const Color(0xFF0C1728),
          border: Border.all(
            color: selected ? const Color(0xFFFFD54A) : const Color(0xFF263A57),
            width: selected ? 1.8 : 1,
          ),
          boxShadow: selected
              ? const [
                  BoxShadow(
                    color: Color(0x44FFD54A),
                    blurRadius: 16,
                  ),
                ]
              : null,
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 37,
              color: selected ? const Color(0xFFFFD54A) : Colors.white70,
            ),
            const SizedBox(height: 7),
            Text(
              value,
              style: TextStyle(
                color: selected ? const Color(0xFFFFD54A) : Colors.white,
                fontSize: 16,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
        ),
      ),
    );
  }

  BoxDecoration _boxDecoration() {
    return BoxDecoration(
      color: const Color(0xFF0C1728),
      borderRadius: BorderRadius.circular(16),
      border: Border.all(
        color: const Color(0xFF263A57),
      ),
    );
  }
}
