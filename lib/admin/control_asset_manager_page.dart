import 'control_firebase.dart';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import 'control_asset_policy.dart';
import 'control_asset_studio_template.dart';

class ControlAssetManagerPage extends StatefulWidget {
  const ControlAssetManagerPage({super.key});

  @override
  State<ControlAssetManagerPage> createState() => _ControlAssetManagerPageState();
}

class _ControlAssetManagerPageState extends State<ControlAssetManagerPage> {
  final _assetKey = TextEditingController(text: 'vip.badge.1');
  final _directory = TextEditingController(text: 'assets/images/vip');
  final _fileName = TextEditingController(text: 'vip_1.webp');
  final _reason = TextEditingController(text: 'تحديث أصل التطبيق من Shadow Control');

  Uint8List? _bytes;
  Uint8List? _sourceBytes;
  String? _mimeType;
  String? _pickedName;
  String? _conversionNote;
  bool _preparedAnimated = false;
  bool _busy = false;
  String _mode = 'remote';
  String? _message;
  int _studioVersion = 1;
  String? _selectedTemplateId = 'badge.base.v1';
  int? _preparedWidth;
  int? _preparedHeight;
  List<ControlAssetStudioTemplate> _templates = const [];
  List<String> _channels = const [
    'store',
    'agency_packages',
    'events',
    'vip',
    'agency',
    'admin_grants',
    'system',
  ];
  final Set<String> _selectedChannels = {'vip'};
  List<Map<String, dynamic>> _assets = const [];

  @override
  void dispose() {
    _assetKey.dispose();
    _directory.dispose();
    _fileName.dispose();
    _reason.dispose();
    super.dispose();
  }

  Future<String> _token() async {
    final token = await controlAuth.currentUser?.getIdToken(true);
    if (token == null || token.trim().isEmpty) {
      throw StateError('تعذر الحصول على جلسة Firebase.');
    }
    return token;
  }

  static final Uri _endpoint = Uri.parse('https://shadow-live.ashraf-business-440.workers.dev/api/manage-app-asset');

  ControlAssetStudioTemplate? get _selectedTemplate {
    final id = _selectedTemplateId;
    if (id == null) return null;
    for (final template in _templates) {
      if (template.id == id) return template;
    }
    return null;
  }

  void _selectAuthHeaderPreset() {
    final matches =
        _templates.where((e) => e.id == 'auth_screen.base.v1').toList();
    setState(() {
      _assetKey.text = 'auth.login.header';
      _directory.text = 'assets/images';
      _fileName.text = 'auth_header.png';
      _reason.text = 'تحديث صورة شاشة تسجيل الدخول';
      _mode = 'remote';
      _selectedChannels
        ..clear()
        ..add('system');
      _sourceBytes = null;
      _bytes = null;
      _mimeType = null;
      _pickedName = null;
      _conversionNote = null;
      _preparedAnimated = false;
      _preparedWidth = null;
      _preparedHeight = null;
      if (matches.isNotEmpty) {
        _applyTemplate(matches.first);
      } else {
        _selectedTemplateId = 'auth_screen.base.v1';
      }
      _message =
          'تم اختيار صورة شاشة الدخول. اختر الصورة الجديدة ثم اضغط نشر.';
    });
  }

  String _extensionOf(String value) {
    final name = value.trim().toLowerCase();
    final dot = name.lastIndexOf('.');
    if (dot <= 0 || dot == name.length - 1) return '';
    return name.substring(dot + 1);
  }

  void _applyTemplate(ControlAssetStudioTemplate template) {
    _selectedTemplateId = template.id;
    final currentDirectory = ControlAssetPolicy.normalizeDirectory(_directory.text);
    if (!template.allowsDirectory(currentDirectory) && template.directories.isNotEmpty) {
      _directory.text = template.directories.first;
    }
    final extension = _extensionOf(_fileName.text);
    if (!template.allowsExtension(extension) && template.extensions.isNotEmpty) {
      final name = _fileName.text.trim();
      final dot = name.lastIndexOf('.');
      final base = dot > 0 ? name.substring(0, dot) : (name.isEmpty ? 'asset' : name);
      _fileName.text = '$base.${template.extensions.first}';
    }
    _syncGiftFileNameFromAssetKey();
  }

  String _defaultFileNameFromCurrent(String pickedName) {
    final directory = ControlAssetPolicy.normalizeDirectory(_directory.text);
    final key = _assetKey.text.trim();
    if (directory == 'assets/images/gifts' && key.startsWith('gifts.')) {
      final id = key.substring('gifts.'.length).replaceAll('.', '_');
      if (id.isNotEmpty) return 'gift_$id.webp';
    }

    final current = _fileName.text.trim();
    if (current.isNotEmpty && ControlAssetPolicy.fileNameAllowed(current)) {
      return current;
    }
    final dot = pickedName.lastIndexOf('.');
    final base = dot > 0 ? pickedName.substring(0, dot) : pickedName;
    return '$base.webp';
  }

  void _syncGiftFileNameFromAssetKey() {
    final directory = ControlAssetPolicy.normalizeDirectory(_directory.text);
    final key = _assetKey.text.trim();
    if (directory != 'assets/images/gifts' || !key.startsWith('gifts.')) {
      return;
    }
    final id = key.substring('gifts.'.length).replaceAll('.', '_');
    if (id.isNotEmpty) _fileName.text = 'gift_$id.webp';
  }

  String? _targetExtension() {
    final name = _fileName.text.trim().toLowerCase();
    final dot = name.lastIndexOf('.');
    if (dot <= 0 || dot == name.length - 1) return null;
    final ext = name.substring(dot + 1);
    return ControlAssetPolicy.allowedExtensions.contains(ext) ? ext : null;
  }

  String _mimeForExtension(String extension) => switch (extension) {
        'png' => 'image/png',
        'jpg' || 'jpeg' => 'image/jpeg',
        'webp' => 'image/webp',
        'gif' => 'image/gif',
        _ => 'application/octet-stream',
      };

  img.Image _prepareDimensions(img.Image decoded) {
    final directory = ControlAssetPolicy.normalizeDirectory(_directory.text);
    if (directory == 'assets/images/gifts') {
      return img.copyResizeCropSquare(
        decoded,
        size: 1024,
        interpolation: img.Interpolation.linear,
        antialias: true,
      );
    }

    final longest =
        decoded.width > decoded.height ? decoded.width : decoded.height;
    if (longest <= 2048) return decoded;
    return decoded.width >= decoded.height
        ? img.copyResize(
            decoded,
            width: 2048,
            interpolation: img.Interpolation.linear,
          )
        : img.copyResize(
            decoded,
            height: 2048,
            interpolation: img.Interpolation.linear,
          );
  }

  Uint8List? _encodeForTarget(img.Image image, String extension) {
    if (extension == 'webp') {
      Uint8List? smallest;
      for (final quality in const [90, 86, 82, 76, 70, 64]) {
        final encoded = img.encodeWebP(
          image,
          lossless: false,
          quality: quality,
          method: 4,
          alphaQuality: 100,
        );
        smallest = encoded;
        if (encoded.length <= ControlAssetPolicy.maxBytes) return encoded;
      }
      return smallest != null && smallest.length <= ControlAssetPolicy.maxBytes
          ? smallest
          : null;
    }

    if (extension == 'jpg' || extension == 'jpeg') {
      Uint8List? smallest;
      for (final quality in const [92, 88, 84, 78, 72, 66]) {
        final encoded = img.encodeJpg(image, quality: quality);
        smallest = encoded;
        if (encoded.length <= ControlAssetPolicy.maxBytes) return encoded;
      }
      return smallest != null && smallest.length <= ControlAssetPolicy.maxBytes
          ? smallest
          : null;
    }

    if (extension == 'png') {
      final encoded = img.encodePng(image, level: 7);
      return encoded.length <= ControlAssetPolicy.maxBytes ? encoded : null;
    }

    if (extension == 'gif') {
      final encoded = img.encodeGif(image);
      return encoded.length <= ControlAssetPolicy.maxBytes ? encoded : null;
    }

    return null;
  }

  String _formatLabel(String extension) => switch (extension) {
        'jpg' || 'jpeg' => 'JPEG',
        _ => extension.toUpperCase(),
      };

  Future<bool> _convertSelectedToTarget({bool updateMessage = true}) async {
    final sourceBytes = _sourceBytes;
    if (sourceBytes == null) return false;

    final extension = _targetExtension();
    if (extension == null) {
      if (mounted && updateMessage) {
        setState(() => _message =
            'امتداد اسم الملف غير مدعوم. استخدم PNG أو JPG/JPEG أو WebP أو GIF.');
      }
      return false;
    }

    final decoded = img.decodeImage(sourceBytes);
    if (decoded == null) {
      if (mounted && updateMessage) {
        setState(() => _message =
            'تعذر قراءة الصورة الأصلية. الصيغ المدعومة: PNG / JPG / JPEG / WebP / GIF.');
      }
      return false;
    }

    final sourceExtension = _extensionOf(_pickedName ?? '');
    final animated = decoded.numFrames > 1;
    if (animated) {
      if (sourceExtension != extension) {
        if (mounted && updateMessage) {
          setState(() => _message =
              'الملف متحرك. للحفاظ على الحركة استخدم نفس الامتداد الأصلي في اسم الملف.');
        }
        return false;
      }
      final longest = decoded.width > decoded.height
          ? decoded.width
          : decoded.height;
      if (longest > 2048 || sourceBytes.length > ControlAssetPolicy.maxBytes) {
        if (mounted && updateMessage) {
          setState(() => _message =
              'الملف المتحرك أكبر من حدود Asset Studio. استخدم نسخة أصغر مع نفس الامتداد.');
        }
        return false;
      }
      if (mounted) {
        setState(() {
          _bytes = sourceBytes;
          _mimeType = _mimeForExtension(extension);
          _preparedWidth = decoded.width;
          _preparedHeight = decoded.height;
          _preparedAnimated = true;
          _conversionNote =
              'تم الحفاظ على Animation الأصلية • '
              '${decoded.width}×${decoded.height} • '
              '${(sourceBytes.length / 1024).toStringAsFixed(1)} KB';
          if (updateMessage) _message = null;
        });
      }
      return true;
    }

    final prepared = _prepareDimensions(decoded);
    final encoded = _encodeForTarget(prepared, extension);
    if (encoded == null) {
      if (mounted && updateMessage) {
        setState(() => _message =
            'تعذر تجهيز ${_formatLabel(extension)} تحت حد 2.5 MB. جرّب WebP أو صورة أصغر.');
      }
      return false;
    }

    final sourceKb = sourceBytes.length / 1024;
    final outputKb = encoded.length / 1024;
    if (mounted) {
      setState(() {
        _bytes = encoded;
        _mimeType = _mimeForExtension(extension);
        _preparedWidth = prepared.width;
        _preparedHeight = prepared.height;
        _preparedAnimated = false;
        _conversionNote =
            'تجهيز تلقائي حسب اسم الملف → ${_formatLabel(extension)} • '
            '${prepared.width}×${prepared.height} • '
            '${sourceKb.toStringAsFixed(1)} KB → ${outputKb.toStringAsFixed(1)} KB';
        if (updateMessage) _message = null;
      });
    }
    return true;
  }

  Future<void> _pickImage() async {
    final file = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (file == null) return;

    setState(() {
      _busy = true;
      _message = 'جارٍ تجهيز الصورة حسب صيغة اسم الملف...';
    });

    try {
      final sourceBytes = await file.readAsBytes();
      final outputName = _defaultFileNameFromCurrent(file.name);
      setState(() {
        _sourceBytes = sourceBytes;
        _pickedName = file.name;
        _preparedAnimated = false;
        _fileName.text = outputName;
      });
      await _convertSelectedToTarget();
    } catch (e) {
      if (mounted) {
        setState(() => _message = 'تعذر تجهيز الصورة: $e');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _loadAssets() async {
    try {
      final response = await http.get(
        _endpoint,
        headers: {'authorization': 'Bearer ${await _token()}'},
      );
      final body = jsonDecode(response.body);
      if (response.statusCode == 200 && body is Map<String, dynamic>) {
        final list = body['assets'];
        final rawTemplates = body['templates'];
        final rawChannels = body['channels'];
        if (mounted) {
          final templates = rawTemplates is List
              ? rawTemplates
                  .whereType<Map>()
                  .map((e) => ControlAssetStudioTemplate.fromMap(Map<String, dynamic>.from(e)))
                  .where((e) => e.id.isNotEmpty && e.type.isNotEmpty)
                  .toList(growable: false)
              : <ControlAssetStudioTemplate>[];
          final channels = rawChannels is List
              ? rawChannels
                  .map((e) => e.toString().trim())
                  .where((e) => e.isNotEmpty)
                  .toList(growable: false)
              : _channels;
          setState(() {
            _studioVersion = (body['studioVersion'] as num?)?.toInt() ?? 1;
            _assets = list is List
                ? list.whereType<Map>().map((e) => Map<String,dynamic>.from(e)).toList()
                : const [];
            _templates = templates;
            _channels = channels;
            if (_selectedTemplate == null && templates.isNotEmpty) {
              final badge = templates.where((e) => e.id == 'badge.base.v1').toList();
              _applyTemplate(badge.isNotEmpty ? badge.first : templates.first);
            }
            _selectedChannels.removeWhere((value) => !_channels.contains(value));
            if (_selectedChannels.isEmpty && _channels.isNotEmpty) {
              _selectedChannels.add(_channels.first);
            }
          });
        }
      }
    } catch (_) {}
  }

  String? _validate() {
    if (_bytes == null || _mimeType == null) return 'اختر صورة أولاً.';
    final template = _selectedTemplate;
    if (template == null) return 'اختر Template من Asset Studio أولاً.';
    if (_selectedChannels.isEmpty) return 'اختر قناة استخدام واحدة على الأقل.';
    if (!ControlAssetPolicy.assetKeyAllowed(_assetKey.text)) {
      return 'مفتاح الاستخدام يجب أن يكون مثل vip.badge.3 وبأحرف إنجليزية صغيرة.';
    }
    if (!ControlAssetPolicy.directoryAllowed(_directory.text)) {
      return 'المسار غير مسموح. اختر واحدًا من المسارات المعتمدة.';
    }
    if (!ControlAssetPolicy.fileNameAllowed(_fileName.text)) {
      return 'اسم الملف غير صالح أو الامتداد غير مدعوم.';
    }
    final directory = ControlAssetPolicy.normalizeDirectory(_directory.text);
    if (!template.allowsDirectory(directory)) {
      return 'المسار لا يطابق Template المختار.';
    }
    final extension = _extensionOf(_fileName.text);
    if (!template.allowsExtension(extension)) {
      return 'صيغة الملف لا تطابق Template المختار.';
    }
    if (_bytes!.length > template.maxBytes) {
      return 'حجم الملف أكبر من حد Template المختار.';
    }
    final width = _preparedWidth;
    final height = _preparedHeight;
    if (width != null && height != null && !template.dimensionsMatch(width, height)) {
      return 'أبعاد الملف لا تطابق Template: ${template.dimensionsLabel}.';
    }
    if (_reason.text.trim().length < 3) return 'اكتب سببًا مختصرًا للتغيير.';
    return null;
  }

  Future<void> _upload({required bool publish}) async {
    if (_sourceBytes != null) {
      setState(() {
        _busy = true;
        _message = 'جارٍ التحقق من الصيغة النهائية وتحويل الصورة تلقائيًا...';
      });
      final converted = await _convertSelectedToTarget();
      if (!converted) {
        if (mounted) setState(() => _busy = false);
        return;
      }
    }

    final error = _validate();
    if (error != null) {
      setState(() {
        _busy = false;
        _message = error;
      });
      return;
    }
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final template = _selectedTemplate!;
      final payload = {
        'action': 'upload',
        'studioVersion': _studioVersion,
        'assetType': template.type,
        'templateId': template.id,
        'channels': _selectedChannels.toList(growable: false),
        'publish': publish,
        'assetKey': _assetKey.text.trim(),
        'directory': ControlAssetPolicy.normalizeDirectory(_directory.text),
        'fileName': _fileName.text.trim(),
        'mimeType': _mimeType,
        'contentBase64': base64Encode(_bytes!),
        'mode': _mode,
        'reason': _reason.text.trim(),
        'idempotencyKey': 'asset_${DateTime.now().microsecondsSinceEpoch}',
      };
      final response = await http.post(
        _endpoint,
        headers: {
          'authorization': 'Bearer ${await _token()}',
          'content-type': 'application/json',
        },
        body: jsonEncode(payload),
      );
      final decoded = response.body.isEmpty ? <String,dynamic>{} : jsonDecode(response.body);
      final body = decoded is Map<String,dynamic> ? decoded : <String,dynamic>{};
      if (response.statusCode >= 200 && response.statusCode < 300 && body['ok'] == true) {
        final replaced = body['replaced'] == true;
        final path = body['fullPath'] ?? '';
        final status = '${body['status'] ?? (publish ? 'published' : 'draft')}';
        setState(() => _message = status == 'published'
            ? (replaced
                ? 'تم التحقق ونشر النسخة الجديدة بنجاح: $path'
                : 'تم التحقق ونشر الأصل بنجاح: $path')
            : 'تم التحقق وحفظ الأصل كمسودة: $path');
        await _loadAssets();
      } else {
        final code = '${body['code'] ?? 'http_${response.statusCode}'}';
        setState(() => _message = switch (code) {
          'recent_auth_required' => 'يلزم تسجيل الدخول من جديد قبل رفع الأصول.',
          'forbidden' => 'هذه الصفحة والإجراء متاحان لحساب Owner فقط.',
          'github_not_configured' => 'GitHub Asset Token غير مضاف إلى Backend بعد.',
          'invalid_request' => 'تحقق من المسار والاسم والحجم ونوع الملف.',
          'invalid_asset_template' => 'النوع وTemplate غير متطابقين.',
          'invalid_asset_channels' => 'اختر قناة استخدام واحدة على الأقل.',
          'template_directory_mismatch' => 'المسار لا يطابق Template المختار.',
          'template_extension_mismatch' => 'صيغة الملف لا تطابق Template المختار.',
          'template_size_mismatch' => 'حجم الملف لا يطابق Template المختار.',
          'r2_not_configured' => 'تخزين R2 الخاص بالمسودات غير متاح حاليًا.',
          _ => 'تعذر رفع الصورة: $code',
        });
      }
    } catch (e) {
      setState(() => _message = 'تعذر رفع الصورة: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _channelLabel(String channel) => switch (channel) {
        'store' => 'المتجر',
        'agency_packages' => 'باكيجات الوكالات',
        'events' => 'الفعاليات',
        'vip' => 'VIP',
        'agency' => 'الوكالات',
        'admin_grants' => 'المنح الإدارية',
        'system' => 'النظام الرسمي',
        _ => channel,
      };

  Future<void> _publishAsset(Map<String, dynamic> asset) async {
    final key = '${asset['assetKey'] ?? ''}'.trim();
    if (_busy || key.isEmpty) return;
    setState(() {
      _busy = true;
      _message = 'جارٍ نشر المسودة...';
    });
    try {
      final response = await http.post(
        _endpoint,
        headers: {
          'authorization': 'Bearer ${await _token()}',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'publish',
          'assetKey': key,
          'reason': _reason.text.trim().length >= 3
              ? _reason.text.trim()
              : 'نشر أصل من Shadow Asset Studio',
          'idempotencyKey':
              'asset_publish_${DateTime.now().microsecondsSinceEpoch}',
        }),
      );
      final decoded =
          response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
      final body = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{};
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['ok'] == true) {
        setState(() => _message = 'تم نشر الأصل بنجاح: $key');
        await _loadAssets();
      } else {
        final code = '${body['code'] ?? 'http_${response.statusCode}'}';
        setState(() => _message = switch (code) {
              'asset_not_found' => 'المسودة غير موجودة في Registry.',
              'asset_draft_not_found' => 'لا توجد مسودة جاهزة للنشر.',
              'asset_draft_missing' => 'ملف المسودة غير موجود في R2.',
              'asset_draft_invalid' => 'ملف المسودة غير صالح.',
              'asset_draft_mismatch' => 'ملف المسودة لا يطابق النسخة المسجلة.',
              'recent_auth_required' =>
                'يلزم تسجيل الدخول من جديد قبل نشر الأصول.',
              'forbidden' => 'النشر متاح لحساب Owner فقط.',
              _ => 'تعذر نشر الأصل: $code',
            });
      }
    } catch (e) {
      if (mounted) setState(() => _message = 'تعذر نشر الأصل: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _templateGuide(ControlAssetStudioTemplate template) {
    return Card(
      color: const Color(0xFF111827),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.dashboard_customize_outlined,
                    color: Color(0xFFD7B85A)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${template.labelAr} • ${template.id}',
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              'المقاس: ${template.dimensionsLabel}  •  '
              '${template.transparencyLabel}  •  ${template.motionLabel}',
            ),
            const SizedBox(height: 4),
            Text('الصيغ: ${template.extensionsLabel}  •  '
                'الحد: ${(template.maxBytes / 1000000).toStringAsFixed(1)} MB'),
            const SizedBox(height: 10),
            const Text(
              'Prompt / الوصف الجاهز',
              style: TextStyle(
                color: Color(0xFFD7B85A),
                fontWeight: FontWeight.w800,
              ),
            ),
            const SizedBox(height: 5),
            SelectableText(
              template.prompt,
              style: const TextStyle(color: Color(0xFFCBC5D6), height: 1.45),
            ),
            if (template.noteAr.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                template.noteAr,
                style: const TextStyle(
                  color: Colors.orangeAccent,
                  fontSize: 12,
                  height: 1.4,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _ownerBody() {
    final template = _selectedTemplate;
    final validation = _bytes == null ? null : _validate();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        const Row(
          children: [
            Icon(Icons.auto_awesome_mosaic_outlined,
                color: Color(0xFFD7B85A), size: 30),
            SizedBox(width: 10),
            Expanded(
              child: Text(
                'Shadow Asset Studio',
                style: TextStyle(fontSize: 25, fontWeight: FontWeight.w900),
              ),
            ),
            Chip(label: Text('OWNER ONLY')),
          ],
        ),
        const SizedBox(height: 8),
        const Text(
          'Template → Upload → Validation → Preview → Save Draft / Publish. '
          'لا يوجد AI Generator داخل Control؛ الاستوديو يعرض Prompt ومواصفات القالب فقط، '
          'والتوليد يتم خارجه ثم يرفع الناتج هنا.',
          style: TextStyle(color: Color(0xFFCBC5D6), height: 1.5),
        ),
        const SizedBox(height: 16),
        Card(
          color: const Color(0xFF111827),
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'صورة شاشة تسجيل الدخول',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 8),
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.asset(
                    'assets/images/auth_header.png',
                    height: 150,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 8),
                const Text(
                  'auth.login.header • assets/images/auth_header.png',
                  style: TextStyle(color: Colors.white60),
                ),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: _busy ? null : _selectAuthHeaderPreset,
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('تغيير هذه الصورة من Asset Studio'),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownButtonFormField<String>(
                  value: template?.id,
                  decoration: const InputDecoration(
                    labelText: 'Asset Type / Template',
                    border: OutlineInputBorder(),
                  ),
                  items: _templates
                      .map(
                        (item) => DropdownMenuItem(
                          value: item.id,
                          child: Text('${item.labelAr} • ${item.type}'),
                        ),
                      )
                      .toList(growable: false),
                  onChanged: _busy
                      ? null
                      : (value) {
                          if (value == null) return;
                          final selected =
                              _templates.where((e) => e.id == value).toList();
                          if (selected.isEmpty) return;
                          setState(() {
                            _applyTemplate(selected.first);
                            _message = null;
                          });
                        },
                ),
                if (template != null) ...[
                  const SizedBox(height: 12),
                  _templateGuide(template),
                  const SizedBox(height: 12),
                  const Text(
                    'Channels / قنوات الاستخدام',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  const SizedBox(height: 7),
                  Wrap(
                    spacing: 7,
                    runSpacing: 7,
                    children: _channels
                        .map(
                          (channel) => FilterChip(
                            label: Text(_channelLabel(channel)),
                            selected: _selectedChannels.contains(channel),
                            onSelected: _busy
                                ? null
                                : (selected) {
                                    setState(() {
                                      if (selected) {
                                        _selectedChannels.add(channel);
                                      } else {
                                        _selectedChannels.remove(channel);
                                      }
                                    });
                                  },
                          ),
                        )
                        .toList(growable: false),
                  ),
                ],
                const SizedBox(height: 12),
                TextField(
                  controller: _directory,
                  enabled: !_busy,
                  onChanged: (_) => setState(_syncGiftFileNameFromAssetKey),
                  decoration: InputDecoration(
                    labelText: 'المسار داخل المشروع',
                    helperText: template == null || template.directories.isEmpty
                        ? 'استخدم مسارًا آمنًا تحت أحد الجذور المعتمدة.'
                        : 'الجذور المسموحة: ${template.directories.join(' • ')} — يمكن إضافة مجلدات فرعية آمنة.',
                    border: const OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _fileName,
                  onEditingComplete: () async {
                    FocusScope.of(context).unfocus();
                    if (_sourceBytes != null) {
                      setState(() {
                        _busy = true;
                        _message = 'جارٍ التحويل حسب امتداد اسم الملف...';
                      });
                      await _convertSelectedToTarget();
                      if (mounted) setState(() => _busy = false);
                    }
                  },
                  decoration: const InputDecoration(
                    labelText: 'اسم الملف',
                    hintText: 'vip_badge_1.webp',
                    helperText:
                        'الصيغة يجب أن تكون من الصيغ المسموحة في Template المختار.',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _assetKey,
                  onChanged: (_) => setState(_syncGiftFileNameFromAssetKey),
                  decoration: const InputDecoration(
                    labelText: 'Asset Key',
                    hintText: 'vip.badge.1',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _mode,
                  decoration: const InputDecoration(
                    labelText: 'طريقة الاستخدام',
                    border: OutlineInputBorder(),
                  ),
                  items: const [
                    DropdownMenuItem(
                      value: 'remote',
                      child: Text('Remote + Cached — المفضل للأصول التجميلية'),
                    ),
                    DropdownMenuItem(
                      value: 'bundled',
                      child: Text('Bundled — يدخل في Build التطبيق القادم'),
                    ),
                  ],
                  onChanged:
                      _busy ? null : (v) => setState(() => _mode = v ?? 'remote'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _reason,
                  decoration: const InputDecoration(
                    labelText: 'سبب التغيير',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),
                OutlinedButton.icon(
                  onPressed: _busy || template == null ? null : _pickImage,
                  icon: const Icon(Icons.upload_file_outlined),
                  label: Text(
                    _pickedName == null
                        ? 'اختيار ملف للقالب'
                        : 'تغيير الملف: $_pickedName',
                  ),
                ),
                if (_conversionNote != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _conversionNote!,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.greenAccent,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                if (_bytes != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    height: 220,
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: Colors.black26,
                      borderRadius: BorderRadius.circular(14),
                    ),
                    padding: const EdgeInsets.all(8),
                    child: Image.memory(_bytes!, fit: BoxFit.contain),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${_preparedAnimated ? 'Animated Preview' : 'Preview'} • '
                    '${(_bytes!.length / 1024).toStringAsFixed(1)} KB'
                    ' • ${_preparedWidth ?? '—'}×${_preparedHeight ?? '—'}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(color: Colors.white60),
                  ),
                  const SizedBox(height: 8),
                  ListTile(
                    dense: true,
                    leading: Icon(
                      validation == null
                          ? Icons.verified_outlined
                          : Icons.error_outline,
                      color: validation == null
                          ? Colors.greenAccent
                          : Colors.orangeAccent,
                    ),
                    title: Text(
                      validation == null
                          ? 'Validation ناجح — جاهز للحفظ أو النشر'
                          : validation,
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                Wrap(
                  spacing: 10,
                  runSpacing: 10,
                  alignment: WrapAlignment.center,
                  children: [
                    OutlinedButton.icon(
                      onPressed: _busy ? null : () => _upload(publish: false),
                      icon: const Icon(Icons.save_outlined),
                      label: const Text('حفظ مسودة'),
                    ),
                    FilledButton.icon(
                      onPressed: _busy ? null : () => _upload(publish: true),
                      icon: _busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.publish_outlined),
                      label: Text(_busy ? 'جارٍ التنفيذ...' : 'نشر'),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                const Text(
                  'حفظ المسودة يستخدم R2 الخاص فقط ولا يعمل Commit أو Deploy. '
                  'إذا كان الأصل منشورًا، تبقى النسخة الحية كما هي حتى تضغط «نشر».',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white54, fontSize: 12),
                ),
              ],
            ),
          ),
        ),
        if (_message != null) ...[
          const SizedBox(height: 10),
          Card(
            child: ListTile(
              leading:
                  const Icon(Icons.info_outline, color: Color(0xFFD7B85A)),
              title: Text(_message!),
            ),
          ),
        ],
        const SizedBox(height: 18),
        Row(
          children: [
            const Expanded(
              child: Text(
                'Asset Registry',
                style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
              ),
            ),
            const Text('Bounded ≤100',
                style: TextStyle(color: Colors.white54, fontSize: 11)),
            IconButton(onPressed: _busy ? null : _loadAssets, icon: const Icon(Icons.refresh)),
          ],
        ),
        if (_assets.isEmpty)
          const Card(
            child: ListTile(
              title: Text('لا توجد أصول مسجلة بعد'),
              subtitle: Text('اضغط تحديث بعد أول عملية حفظ أو نشر.'),
            ),
          )
        else
          ..._assets.map((a) {
            final published = a['published'] == true;
            final draft = a['draft'] is Map
                ? Map<String, dynamic>.from(a['draft'] as Map)
                : <String, dynamic>{};
            final hasDraft = a['hasDraft'] == true && draft.isNotEmpty;
            final source = hasDraft ? draft : a;
            final channels = source['channels'] is List
                ? (source['channels'] as List)
                    .map((e) => e.toString())
                    .join(', ')
                : '';
            final type =
                '${source['assetType'] ?? a['assetType'] ?? 'legacy'}';
            final status = '${a['status'] ??
                (published ? 'published' : (hasDraft ? 'draft' : 'unknown'))}';
            return Card(
              child: ListTile(
                leading: Icon(
                  hasDraft
                      ? Icons.edit_note_rounded
                      : (published
                          ? Icons.public_rounded
                          : Icons.drafts_outlined),
                  color: hasDraft
                      ? Colors.orangeAccent
                      : (published
                          ? Colors.greenAccent
                          : Colors.white54),
                ),
                title: Text('${a['assetKey'] ?? ''}'),
                subtitle: Text(
                  '${source['fullPath'] ?? a['fullPath'] ?? ''}\n'
                  '$type • $status • ${source['mode'] ?? a['mode'] ?? ''}'
                  '${published && hasDraft ? '\nالنسخة الحية مستمرة + مسودة جديدة جاهزة' : ''}'
                  '${channels.isEmpty ? '' : '\n$channels'}',
                ),
                isThreeLine: true,
                trailing: hasDraft
                    ? IconButton(
                        tooltip: 'نشر المسودة',
                        onPressed: _busy ? null : () => _publishAsset(a),
                        icon: const Icon(Icons.publish_outlined),
                      )
                    : (published
                        ? const Icon(
                            Icons.verified_rounded,
                            color: Colors.greenAccent,
                          )
                        : null),
              ),
            );
          }),
        const SizedBox(height: 12),
        const Card(
          child: ListTile(
            leading:
                Icon(Icons.security_outlined, color: Color(0xFFD7B85A)),
            title: Text('حماية Asset Studio'),
            subtitle: Text(
              'Owner-only + Recent Auth + Templates/Channels + Validation + '
              'R2 Drafts + Publish-only GitHub Commit + Idempotency + Firestore Registry + Audit Log. '
              'لا Polling ولا Reads على Room/Gift hot paths.',
            ),
          ),
        ),
      ],
    );
  }

  @override
  void initState() {
    super.initState();
    _loadAssets();
  }

  @override
  Widget build(BuildContext context) {
    final uid = controlAuth.currentUser?.uid;
    if (uid == null) {
      return const Scaffold(body: Center(child: Text('سجّل الدخول أولاً')));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Shadow Asset Studio')),
      body: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        future: controlFirestore.collection('users').doc(uid).get(),
        builder: (context, snapshot) {
          if (!snapshot.hasData) return const Center(child: CircularProgressIndicator());
          final data = snapshot.data?.data();
          if (data?['role'] != 'owner') {
            return const Center(
              child: Padding(
                padding: EdgeInsets.all(24),
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Icon(Icons.lock_outline, size: 58, color: Colors.orangeAccent),
                  SizedBox(height: 12),
                  Text('هذه الصفحة متاحة لحساب Owner فقط', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                ]),
              ),
            );
          }
          return _ownerBody();
        },
      ),
    );
  }
}
