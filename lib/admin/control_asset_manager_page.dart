import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import 'control_asset_policy.dart';

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
  bool _busy = false;
  String _mode = 'remote';
  String? _message;
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
    final token = await FirebaseAuth.instance.currentUser?.getIdToken(true);
    if (token == null || token.trim().isEmpty) {
      throw StateError('تعذر الحصول على جلسة Firebase.');
    }
    return token;
  }

  static final Uri _endpoint = Uri.parse('https://shadow-live-six.vercel.app/api/manage-app-asset');

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

    final prepared = _prepareDimensions(decoded);
    final encoded = _encodeForTarget(prepared, extension);
    if (encoded == null) {
      if (mounted && updateMessage) {
        setState(() => _message =
            'تعذر تجهيز \${_formatLabel(extension)} تحت حد 2.5 MB. جرّب WebP أو صورة أصغر.');
      }
      return false;
    }

    final sourceKb = sourceBytes.length / 1024;
    final outputKb = encoded.length / 1024;
    if (mounted) {
      setState(() {
        _bytes = encoded;
        _mimeType = _mimeForExtension(extension);
        _conversionNote =
            'تجهيز تلقائي حسب اسم الملف → \${_formatLabel(extension)} • '
            '\${prepared.width}×\${prepared.height} • '
            '\${sourceKb.toStringAsFixed(1)} KB → \${outputKb.toStringAsFixed(1)} KB';
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
        if (list is List && mounted) {
          setState(() => _assets = list.whereType<Map>().map((e) => Map<String,dynamic>.from(e)).toList());
        }
      }
    } catch (_) {}
  }

  String? _validate() {
    if (_bytes == null || _mimeType == null) return 'اختر صورة أولاً.';
    if (!ControlAssetPolicy.assetKeyAllowed(_assetKey.text)) {
      return 'مفتاح الاستخدام يجب أن يكون مثل vip.badge.3 وبأحرف إنجليزية صغيرة.';
    }
    if (!ControlAssetPolicy.directoryAllowed(_directory.text)) {
      return 'المسار غير مسموح. اختر واحدًا من المسارات المعتمدة.';
    }
    if (!ControlAssetPolicy.fileNameAllowed(_fileName.text)) {
      return 'اسم الملف غير صالح أو الامتداد غير مدعوم.';
    }
    if (_reason.text.trim().length < 3) return 'اكتب سببًا مختصرًا للتغيير.';
    return null;
  }

  Future<void> _upload() async {
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
      final payload = {
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
        setState(() => _message = replaced
            ? 'تم استبدال الصورة القديمة بنجاح: $path'
            : 'تمت إضافة الصورة بنجاح: $path');
        await _loadAssets();
      } else {
        final code = '${body['code'] ?? 'http_${response.statusCode}'}';
        setState(() => _message = switch (code) {
          'recent_auth_required' => 'يلزم تسجيل الدخول من جديد قبل رفع الأصول.',
          'forbidden' => 'هذه الصفحة والإجراء متاحان لحساب Owner فقط.',
          'github_not_configured' => 'GitHub Asset Token غير مضاف إلى Backend بعد.',
          'invalid_request' => 'تحقق من المسار والاسم والحجم ونوع الملف.',
          _ => 'تعذر رفع الصورة: $code',
        });
      }
    } catch (e) {
      setState(() => _message = 'تعذر رفع الصورة: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _ownerBody() => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Row(children: [
            Icon(Icons.image_outlined, color: Color(0xFFD7B85A), size: 30),
            SizedBox(width: 10),
            Expanded(child: Text('إدارة أصول التطبيق', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w900))),
            Chip(label: Text('OWNER ONLY')),
          ]),
          const SizedBox(height: 8),
          const Text(
            'اختر PNG أو JPG/JPEG أو WebP أو GIF. الصيغة النهائية تُحدد تلقائيًا من امتداد اسم الملف: إذا كتبت .webp يتحول WebP، وإذا كتبت .png أو .jpg/.jpeg أو .gif يتحول للصيغة نفسها قبل الرفع. صور الهدايا تُجهّز تلقائيًا بمقاس 1024×1024.',
            style: TextStyle(color: Color(0xFFCBC5D6), height: 1.5),
          ),
          const SizedBox(height: 16),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(children: [
                DropdownButtonFormField<String>(
                  value: ControlAssetPolicy.directoryAllowed(_directory.text) ? ControlAssetPolicy.normalizeDirectory(_directory.text) : null,
                  decoration: const InputDecoration(labelText: 'المسار داخل المشروع', border: OutlineInputBorder()),
                  items: ControlAssetPolicy.allowedDirectories
                      .map((p) => DropdownMenuItem(value: p, child: Text(p)))
                      .toList(),
                  onChanged: (v) {
                    if (v != null) {
                      setState(() {
                        _directory.text = v;
                        _syncGiftFileNameFromAssetKey();
                      });
                    }
                  },
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
                    labelText: 'اسم الملف يحدد صيغة التحويل',
                    hintText: 'gift_rose.webp / banner.png / photo.jpg / animation.gif',
                    helperText: 'الامتدادات المدعومة: .webp .png .jpg .jpeg .gif',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _assetKey,
                  onChanged: (_) {
                    setState(_syncGiftFileNameFromAssetKey);
                  },
                  decoration: const InputDecoration(
                    labelText: 'مفتاح الاستخدام داخل النظام',
                    hintText: 'gifts.rose',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                DropdownButtonFormField<String>(
                  value: _mode,
                  decoration: const InputDecoration(labelText: 'طريقة الاستخدام', border: OutlineInputBorder()),
                  items: const [
                    DropdownMenuItem(value: 'remote', child: Text('Remote — رابط مباشر فورًا بعد الـCommit')),
                    DropdownMenuItem(value: 'bundled', child: Text('Bundled — يدخل في Build التطبيق القادم')),
                  ],
                  onChanged: (v) => setState(() => _mode = v ?? 'remote'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _reason,
                  decoration: const InputDecoration(labelText: 'سبب التغيير', border: OutlineInputBorder()),
                ),
                const SizedBox(height: 14),
                OutlinedButton.icon(
                  onPressed: _busy ? null : _pickImage,
                  icon: const Icon(Icons.photo_library_outlined),
                  label: Text(_pickedName == null ? 'اختيار صورة' : 'تغيير الصورة: $_pickedName'),
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
                    height: 190,
                    width: double.infinity,
                    decoration: BoxDecoration(color: Colors.black26, borderRadius: BorderRadius.circular(14)),
                    padding: const EdgeInsets.all(8),
                    child: Image.memory(_bytes!, fit: BoxFit.contain),
                  ),
                  const SizedBox(height: 8),
                  Text('${(_bytes!.length / 1024).toStringAsFixed(1)} KB', style: const TextStyle(color: Colors.white54)),
                ],
                const SizedBox(height: 14),
                FilledButton.icon(
                  onPressed: _busy ? null : _upload,
                  icon: _busy
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.cloud_upload_outlined),
                  label: Text(_busy ? 'جار الرفع...' : 'رفع / استبدال الأصل'),
                ),
              ]),
            ),
          ),
          if (_message != null) ...[
            const SizedBox(height: 10),
            Card(
              child: ListTile(
                leading: const Icon(Icons.info_outline, color: Color(0xFFD7B85A)),
                title: Text(_message!),
              ),
            ),
          ],
          const SizedBox(height: 18),
          Row(children: [
            const Expanded(child: Text('Asset Registry', style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900))),
            IconButton(onPressed: _loadAssets, icon: const Icon(Icons.refresh)),
          ]),
          if (_assets.isEmpty)
            const Card(child: ListTile(title: Text('لا توجد أصول مسجلة بعد'), subtitle: Text('اضغط تحديث بعد أول عملية رفع.')))
          else
            ..._assets.map((a) => Card(
                  child: ListTile(
                    leading: const Icon(Icons.image_outlined, color: Color(0xFFD7B85A)),
                    title: Text('${a['assetKey'] ?? ''}'),
                    subtitle: Text('${a['fullPath'] ?? ''}\n${a['mode'] ?? ''} • ${a['byteSize'] ?? 0} bytes'),
                    isThreeLine: true,
                    trailing: a['replaced'] == true ? const Icon(Icons.sync, color: Colors.greenAccent) : const Icon(Icons.check_circle_outline),
                  ),
                )),
          const SizedBox(height: 12),
          const Card(
            child: ListTile(
              leading: Icon(Icons.security_outlined, color: Color(0xFFD7B85A)),
              title: Text('حماية النظام'),
              subtitle: Text('Owner-only + Recent Auth + مسارات مقيدة + حد 2.5MB + GitHub Commit + Firestore Registry + Audit Log.'),
            ),
          ),
        ],
      );

  @override
  void initState() {
    super.initState();
    _loadAssets();
  }

  @override
  Widget build(BuildContext context) {
    final uid = FirebaseAuth.instance.currentUser?.uid;
    if (uid == null) {
      return const Scaffold(body: Center(child: Text('سجّل الدخول أولاً')));
    }
    return Scaffold(
      appBar: AppBar(title: const Text('إدارة أصول التطبيق')),
      body: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        future: FirebaseFirestore.instance.collection('users').doc(uid).get(),
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
