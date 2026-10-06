import 'control_firebase.dart';
import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:image/image.dart' as img;
import 'package:image_picker/image_picker.dart';

import 'control_asset_policy.dart';
import 'control_asset_studio_template.dart';
import '../core/assets/shadow_asset_registry.dart';

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
  final _assetSearch = TextEditingController();

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
  String _assetFilter = 'all';
  String _assetTypeFilter = 'all';
  String _assetChannelFilter = 'all';
  String _debouncedSearch = '';
  Timer? _searchDebounce;
  bool _showStudioForm = false;
  Map<String, dynamic>? _editingAsset;
  bool _unlockIdentityFields = false;
  bool _hasUnsavedChanges = false;
  bool? _lastFailedPublishIntent;
  String? _operationId;
  Map<String, dynamic>? _lastSuccess;
  int _previewRefreshNonce = 0;
  int _visibleLimit = 24;
  final Set<String> _favoriteAssetKeys = <String>{};
  final List<String> _recentAssetKeys = <String>[];

  @override
  void dispose() {
    _assetKey.dispose();
    _directory.dispose();
    _fileName.dispose();
    _reason.dispose();
    _assetSearch.dispose();
    _searchDebounce?.cancel();
    super.dispose();
  }

  bool get _isEditing => _editingAsset != null;

  Map<String, dynamic> _assetSource(Map<String, dynamic> asset) {
    final draft = asset['draft'] is Map
        ? Map<String, dynamic>.from(asset['draft'] as Map)
        : <String, dynamic>{};
    return asset['hasDraft'] == true && draft.isNotEmpty ? draft : asset;
  }

  String _assetDirectory(Map<String, dynamic> asset) {
    final source = _assetSource(asset);
    final direct = (source['directory'] ?? asset['directory'] ?? '').toString().trim();
    if (direct.isNotEmpty) return ControlAssetPolicy.normalizeDirectory(direct);
    final fullPath = (source['fullPath'] ?? asset['fullPath'] ?? '').toString().trim();
    final slash = fullPath.lastIndexOf('/');
    return slash > 0 ? fullPath.substring(0, slash) : '';
  }

  String _assetFileName(Map<String, dynamic> asset) {
    final source = _assetSource(asset);
    final direct = (source['fileName'] ?? asset['fileName'] ?? '').toString().trim();
    if (direct.isNotEmpty) return direct;
    final fullPath = (source['fullPath'] ?? asset['fullPath'] ?? '').toString().trim();
    final slash = fullPath.lastIndexOf('/');
    return slash >= 0 ? fullPath.substring(slash + 1) : fullPath;
  }

  String _assetLiveUrl(Map<String, dynamic>? asset, {bool bypassCache = false}) {
    if (asset == null) return '';
    final raw = (asset['rawUrl'] ?? '').toString().trim();
    if (raw.isEmpty) return '';
    if (!bypassCache) return raw;
    final separator = raw.contains('?') ? '&' : '?';
    return '${raw}${separator}studioRefresh=$_previewRefreshNonce';
  }

  void _markDirty() {
    if (!_hasUnsavedChanges) {
      setState(() {
        _hasUnsavedChanges = true;
        _lastSuccess = null;
        _operationId = null;
      });
    }
  }

  void _selectAll(TextEditingController controller) {
    controller.selection = TextSelection(
      baseOffset: 0,
      extentOffset: controller.text.length,
    );
  }

  void _recordRecent(String key) {
    final value = key.trim();
    if (value.isEmpty) return;
    _recentAssetKeys.remove(value);
    _recentAssetKeys.insert(0, value);
    if (_recentAssetKeys.length > 8) {
      _recentAssetKeys.removeRange(8, _recentAssetKeys.length);
    }
  }

  void _resetPreparedFile() {
    _sourceBytes = null;
    _bytes = null;
    _mimeType = null;
    _pickedName = null;
    _conversionNote = null;
    _preparedAnimated = false;
    _preparedWidth = null;
    _preparedHeight = null;
  }

  void _startNewAsset() {
    setState(() {
      _editingAsset = null;
      _unlockIdentityFields = false;
      _showStudioForm = true;
      _hasUnsavedChanges = false;
      _lastFailedPublishIntent = null;
      _lastSuccess = null;
      _operationId = null;
      _message = 'وضع إضافة أصل جديد';
      _resetPreparedFile();
    });
  }

  void _beginEditAsset(Map<String, dynamic> asset) {
    final source = _assetSource(asset);
    final templateId = (source['templateId'] ?? asset['templateId'] ?? '').toString();
    final channels = (source['channels'] ?? asset['channels']);
    final key = (asset['assetKey'] ?? '').toString().trim();
    setState(() {
      _editingAsset = Map<String, dynamic>.from(asset);
      _unlockIdentityFields = false;
      _showStudioForm = true;
      _assetKey.text = key;
      _directory.text = _assetDirectory(asset);
      _fileName.text = _assetFileName(asset);
      _mode = (source['mode'] ?? asset['mode']) == 'bundled' ? 'bundled' : 'remote';
      if (templateId.isNotEmpty &&
          _templates.any((template) => template.id == templateId)) {
        _selectedTemplateId = templateId;
      }
      _selectedChannels
        ..clear()
        ..addAll(
          channels is List
              ? channels.map((e) => e.toString()).where(_channels.contains)
              : const <String>[],
        );
      if (_selectedChannels.isEmpty && _channels.contains('system')) {
        _selectedChannels.add('system');
      } else if (_selectedChannels.isEmpty && _channels.isNotEmpty) {
        _selectedChannels.add(_channels.first);
      }
      _reason.text = 'استبدال تصميم الأصل الحالي';
      _resetPreparedFile();
      _hasUnsavedChanges = false;
      _lastFailedPublishIntent = null;
      _lastSuccess = null;
      _operationId = null;
      _message = 'وضع تعديل أصل موجود: اختر الصورة الجديدة فقط ثم راجع وانشر.';
      _recordRecent(key);
    });
  }

  void _cloneAsset(Map<String, dynamic> asset) {
    final source = _assetSource(asset);
    final originalKey = (asset['assetKey'] ?? '').toString().trim();
    final originalName = _assetFileName(asset);
    final dot = originalName.lastIndexOf('.');
    final base = dot > 0 ? originalName.substring(0, dot) : originalName;
    final ext = dot > 0 ? originalName.substring(dot) : '.webp';
    setState(() {
      _editingAsset = null;
      _unlockIdentityFields = true;
      _showStudioForm = true;
      _assetKey.text = originalKey.isEmpty ? '' : '${originalKey}.copy';
      _directory.text = _assetDirectory(asset);
      _fileName.text = '${base}_copy$ext';
      _mode = (source['mode'] ?? asset['mode']) == 'bundled' ? 'bundled' : 'remote';
      final templateId = (source['templateId'] ?? asset['templateId'] ?? '').toString();
      if (templateId.isNotEmpty &&
          _templates.any((template) => template.id == templateId)) {
        _selectedTemplateId = templateId;
      }
      final channels = source['channels'] ?? asset['channels'];
      _selectedChannels
        ..clear()
        ..addAll(
          channels is List
              ? channels.map((e) => e.toString()).where(_channels.contains)
              : const <String>[],
        );
      _reason.text = 'إنشاء أصل جديد اعتمادًا على أصل موجود';
      _resetPreparedFile();
      _hasUnsavedChanges = true;
      _lastFailedPublishIntent = null;
      _lastSuccess = null;
      _operationId = null;
      _message = 'تم نسخ إعدادات الأصل. غيّر Asset Key واسم الملف واختر صورة جديدة.';
    });
  }

  Future<bool> _confirmDiscardChanges() async {
    if (!_hasUnsavedChanges) return true;
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('تغييرات غير محفوظة'),
            content: const Text(
              'لديك تغييرات لم يتم حفظها أو نشرها. هل تريد تجاهلها؟',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('متابعة التعديل'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('تجاهل'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _closeStudioForm() async {
    if (!await _confirmDiscardChanges()) return;
    if (!mounted) return;
    setState(() {
      _showStudioForm = false;
      _editingAsset = null;
      _unlockIdentityFields = false;
      _hasUnsavedChanges = false;
      _lastFailedPublishIntent = null;
      _lastSuccess = null;
      _operationId = null;
      _message = null;
      _resetPreparedFile();
    });
  }

  Future<void> _unlockIdentity() async {
    if (!_isEditing || _unlockIdentityFields) return;
    final accepted = await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('فتح الحقول الحساسة؟'),
            content: const Text(
              'تغيير Asset Key أو المسار أو اسم الملف قد يفصل الأصل عن الأماكن المرتبطة به. استخدمه فقط إذا كنت تقصد نقل الأصل.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('فتح الحقول'),
              ),
            ],
          ),
        ) ??
        false;
    if (accepted && mounted) {
      setState(() => _unlockIdentityFields = true);
    }
  }

  Future<void> _copyText(String text, String label) async {
    if (text.trim().isEmpty) return;
    await Clipboard.setData(ClipboardData(text: text));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('تم نسخ $label')),
    );
  }

  Future<void> _copyAssetMetadata(Map<String, dynamic> asset) async {
    final source = _assetSource(asset);
    final text = <String>[
      'Asset Key: ${asset['assetKey'] ?? ''}',
      'Path: ${source['fullPath'] ?? asset['fullPath'] ?? ''}',
      'File: ${source['fileName'] ?? asset['fileName'] ?? ''}',
      'Template: ${source['templateId'] ?? asset['templateId'] ?? ''}',
      'Channels: ${((source['channels'] ?? asset['channels']) as List?)?.join(', ') ?? ''}',
      'Live URL: ${asset['rawUrl'] ?? ''}',
      'Content SHA: ${asset['contentSha'] ?? ''}',
    ].join('\n');
    await _copyText(text, 'بيانات الأصل');
  }

  void _onSearchChanged(String value) {
    _searchDebounce?.cancel();
    _searchDebounce = Timer(const Duration(milliseconds: 280), () {
      if (!mounted) return;
      setState(() {
        _debouncedSearch = value.trim().toLowerCase();
        _visibleLimit = 24;
      });
    });
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

  Widget _assetThumbnail(
    Map<String, dynamic> asset, {
    double size = 52,
    bool bypassCache = false,
  }) {
    final url = _assetLiveUrl(asset, bypassCache: bypassCache);
    if (url.isEmpty) {
      return Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          color: const Color(0xFF9A6CFF).withValues(alpha: .12),
          borderRadius: BorderRadius.circular(12),
        ),
        child: const Icon(
          Icons.image_not_supported_outlined,
          color: Color(0xFFCDB7FF),
        ),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: size,
        height: size,
        color: Colors.black26,
        child: Image.network(
          url,
          fit: BoxFit.contain,
          cacheWidth: (size * 2).round(),
          cacheHeight: (size * 2).round(),
          gaplessPlayback: true,
          filterQuality: FilterQuality.medium,
          loadingBuilder: (context, child, progress) => progress == null
              ? child
              : const Center(
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
          errorBuilder: (_, __, ___) => const Icon(
            Icons.broken_image_outlined,
            color: Colors.orangeAccent,
          ),
        ),
      ),
    );
  }

  Widget _contextPreview(
    String imageUrl, {
    Uint8List? memoryBytes,
    String? assetType,
  }) {
    Widget image({BoxFit fit = BoxFit.contain}) {
      if (memoryBytes != null) {
        return Image.memory(memoryBytes, fit: fit);
      }
      return Image.network(
        imageUrl,
        fit: fit,
        gaplessPlayback: true,
        errorBuilder: (_, __, ___) => const Icon(
          Icons.broken_image_outlined,
          color: Colors.orangeAccent,
        ),
      );
    }

    final type = (assetType ?? _selectedTemplate?.type ?? '').toLowerCase();
    if (type.contains('frame')) {
      return Container(
        height: 210,
        alignment: Alignment.center,
        color: const Color(0xFF07111F),
        child: SizedBox(
          width: 155,
          height: 155,
          child: Stack(
            fit: StackFit.expand,
            children: [
              const Padding(
                padding: EdgeInsets.all(23),
                child: CircleAvatar(
                  backgroundColor: Color(0xFF39265A),
                  child: Icon(
                    Icons.person_rounded,
                    size: 55,
                    color: Colors.white70,
                  ),
                ),
              ),
              image(),
            ],
          ),
        ),
      );
    }
    if (type.contains('chat')) {
      return Container(
        height: 150,
        color: const Color(0xFF07111F),
        padding: const EdgeInsets.all(18),
        alignment: Alignment.center,
        child: Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(width: 260, height: 90, child: image(fit: BoxFit.fill)),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 35),
              child: Text(
                'معاينة رسالة داخل الغرفة',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.white, fontSize: 12),
              ),
            ),
          ],
        ),
      );
    }
    if (type.contains('background') || type.contains('room')) {
      return Container(
        height: 190,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          color: const Color(0xFF07111F),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            image(fit: BoxFit.cover),
            const Align(
              alignment: Alignment.bottomCenter,
              child: Padding(
                padding: EdgeInsets.all(12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    CircleAvatar(radius: 18, child: Icon(Icons.mic, size: 17)),
                    CircleAvatar(radius: 18, child: Icon(Icons.mic, size: 17)),
                    CircleAvatar(radius: 18, child: Icon(Icons.mic, size: 17)),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }
    return Container(
      height: 190,
      color: Colors.black26,
      alignment: Alignment.center,
      padding: const EdgeInsets.all(12),
      child: image(),
    );
  }

  Future<void> _showAssetPreview(Map<String, dynamic> asset) async {
    var refreshNonce = _previewRefreshNonce;
    var contextMode = false;
    final source = _assetSource(asset);
    final type = (source['assetType'] ?? asset['assetType'] ?? '').toString();
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          final raw = (asset['rawUrl'] ?? '').toString().trim();
          final url = raw.isEmpty
              ? ''
              : '$raw${raw.contains('?') ? '&' : '?'}studioRefresh=$refreshNonce';
          return AlertDialog(
            title: Row(
              children: [
                const Expanded(child: Text('معاينة الأصل المنشور')),
                IconButton(
                  tooltip: 'تحديث مباشر وتجاوز الكاش',
                  onPressed: raw.isEmpty
                      ? null
                      : () => setDialogState(
                            () => refreshNonce =
                                DateTime.now().microsecondsSinceEpoch,
                          ),
                  icon: const Icon(Icons.refresh_rounded),
                ),
              ],
            ),
            content: SizedBox(
              width: 430,
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (url.isEmpty)
                      const SizedBox(
                        height: 170,
                        child: Center(
                          child: Text('لا توجد نسخة منشورة للمعاينة.'),
                        ),
                      )
                    else if (contextMode)
                      _contextPreview(url, assetType: type)
                    else
                      Container(
                        constraints: const BoxConstraints(maxHeight: 360),
                        color: Colors.black26,
                        padding: const EdgeInsets.all(10),
                        child: Image.network(
                          url,
                          fit: BoxFit.contain,
                          gaplessPlayback: true,
                          errorBuilder: (_, __, ___) => const SizedBox(
                            height: 150,
                            child: Center(
                              child: Text('تعذر تحميل المعاينة الحالية.'),
                            ),
                          ),
                        ),
                      ),
                    const SizedBox(height: 10),
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(
                          value: false,
                          label: Text('الأصل'),
                          icon: Icon(Icons.image_outlined),
                        ),
                        ButtonSegment(
                          value: true,
                          label: Text('داخل السياق'),
                          icon: Icon(Icons.phone_android_rounded),
                        ),
                      ],
                      selected: {contextMode},
                      onSelectionChanged: (value) =>
                          setDialogState(() => contextMode = value.first),
                    ),
                    const SizedBox(height: 12),
                    SelectableText(
                      (asset['assetKey'] ?? '').toString(),
                      textDirection: TextDirection.ltr,
                    ),
                    const SizedBox(height: 5),
                    SelectableText(
                      (source['fullPath'] ?? asset['fullPath'] ?? '').toString(),
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(color: Colors.white60, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton.icon(
                onPressed: () => _copyAssetMetadata(asset),
                icon: const Icon(Icons.copy_all_rounded),
                label: const Text('نسخ البيانات'),
              ),
              FilledButton(
                onPressed: () {
                  Navigator.pop(dialogContext);
                  _beginEditAsset(asset);
                },
                child: const Text('تعديل هذا الأصل'),
              ),
            ],
          );
        },
      ),
    );
    if (mounted && refreshNonce != _previewRefreshNonce) {
      setState(() => _previewRefreshNonce = refreshNonce);
    }
  }

  Future<bool> _confirmPublishImpact() async {
    if (!_isEditing) return true;
    final template = _selectedTemplate;
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('تأكيد استبدال الأصل الحي'),
            content: Text(
              'سيتم استبدال الأصل تحت نفس Asset Key بدون إنشاء مفتاح جديد.\n\n'
              'Asset Key: ${_assetKey.text.trim()}\n'
              'النوع: ${template?.labelAr ?? template?.type ?? 'غير محدد'}\n'
              'قنوات الاستخدام: ${_selectedChannels.map(_channelLabel).join(' • ')}\n\n'
              'أي مكان يستخدم هذا المفتاح سيقرأ النسخة الجديدة بعد تحديث الكاش.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(dialogContext, false),
                child: const Text('إلغاء'),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(dialogContext, true),
                child: const Text('نعم، استبدل الأصل'),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<bool> _verifyPublishedAsset(
    String assetKey,
    String expectedSha,
  ) async {
    await _loadAssets();
    Map<String, dynamic>? live;
    for (final asset in _assets) {
      if ((asset['assetKey'] ?? '').toString() == assetKey) {
        live = asset;
        break;
      }
    }
    if (live == null ||
        live['published'] != true ||
        (live['contentSha'] ?? '').toString() != expectedSha) {
      return false;
    }
    final rawUrl = (live['rawUrl'] ?? '').toString().trim();
    if (rawUrl.isEmpty) return false;
    try {
      final separator = rawUrl.contains('?') ? '&' : '?';
      final response = await http.get(
        Uri.parse(
          '$rawUrl${separator}verify=${DateTime.now().microsecondsSinceEpoch}',
        ),
        headers: const {'cache-control': 'no-cache'},
      );
      return response.statusCode >= 200 &&
          response.statusCode < 300 &&
          response.bodyBytes.isNotEmpty;
    } catch (_) {
      return false;
    }
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

    final rawAssetKey = _assetKey.text.trim();
    final canonicalAssetKey =
        ShadowAssetKeys.canonicalizeVipAssetKey(rawAssetKey);
    if (canonicalAssetKey != rawAssetKey) {
      _assetKey.text = canonicalAssetKey;
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
        'assetKey': canonicalAssetKey,
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


  int get _publishedCount =>
      _assets.where((asset) => asset['published'] == true).length;

  int get _draftCount =>
      _assets.where((asset) => asset['hasDraft'] == true).length;

  List<Map<String, dynamic>> get _visibleAssets {
    final query = _assetSearch.text.trim().toLowerCase();
    return _assets.where((asset) {
      final published = asset['published'] == true;
      final hasDraft = asset['hasDraft'] == true;
      final status = (asset['status'] ?? '').toString().toLowerCase();
      final matchesFilter = switch (_assetFilter) {
        'published' => published,
        'draft' => hasDraft,
        'review' => status.contains('review') || status.contains('pending'),
        _ => true,
      };
      if (!matchesFilter) return false;
      if (query.isEmpty) return true;
      final draft = asset['draft'] is Map
          ? Map<String, dynamic>.from(asset['draft'] as Map)
          : <String, dynamic>{};
      final source = hasDraft ? draft : asset;
      final haystack = <String>[
        (asset['assetKey'] ?? '').toString(),
        (source['fullPath'] ?? asset['fullPath'] ?? '').toString(),
        (source['assetType'] ?? asset['assetType'] ?? '').toString(),
      ].join(' ').toLowerCase();
      return haystack.contains(query);
    }).toList(growable: false);
  }

  String _assetStatusLabel(Map<String, dynamic> asset) {
    if (asset['hasDraft'] == true) return 'مسودة';
    if (asset['published'] == true) return 'منشور';
    final status = (asset['status'] ?? '').toString().toLowerCase();
    if (status.contains('review') || status.contains('pending')) {
      return 'يحتاج مراجعة';
    }
    return 'غير محدد';
  }

  Widget _studioStep(
    int number,
    IconData icon,
    String label, {
    bool active = false,
  }) {
    final accent =
        active ? const Color(0xFFD7B85A) : const Color(0xFFC4A7FF);
    return SizedBox(
      width: 86,
      child: Column(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: accent.withValues(alpha: .12),
              border: Border.all(color: accent.withValues(alpha: .55)),
            ),
            child: Icon(icon, color: accent, size: 22),
          ),
          const SizedBox(height: 5),
          Text(
            number.toString(),
            style: TextStyle(
              color: accent,
              fontSize: 10,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
          ),
        ],
      ),
    );
  }

  Widget _studioPanel(Widget child, {EdgeInsetsGeometry? padding}) {
    return Container(
      padding: padding ?? const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF171222),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: const Color(0xFF8B5CF6).withValues(alpha: .22),
        ),
      ),
      child: child,
    );
  }

  Widget _statTile(
    IconData icon,
    String value,
    String label,
    Color accent,
  ) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
        decoration: BoxDecoration(
          color: accent.withValues(alpha: .08),
          borderRadius: BorderRadius.circular(15),
          border: Border.all(color: accent.withValues(alpha: .24)),
        ),
        child: Column(
          children: [
            Icon(icon, color: accent, size: 21),
            const SizedBox(height: 5),
            Text(
              value,
              style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
            ),
            const SizedBox(height: 2),
            Text(
              label,
              textAlign: TextAlign.center,
              style: TextStyle(color: accent, fontSize: 10.5),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStudioForm() {
    final template = _selectedTemplate;
    final validation = _bytes == null ? null : _validate();

    return _studioPanel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(
                Icons.add_photo_alternate_outlined,
                color: Color(0xFFD7B85A),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'إضافة أو تعديل أصل',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                ),
              ),
              IconButton(
                tooltip: 'إغلاق النموذج',
                onPressed:
                    _busy ? null : () => setState(() => _showStudioForm = false),
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          const Text(
            'اختر القالب، ارفع الصورة، ثم راجع البيانات قبل الحفظ أو النشر.',
            style: TextStyle(color: Colors.white60, height: 1.45),
          ),
          const SizedBox(height: 14),
          DropdownButtonFormField<String>(
            value: template?.id,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'نوع الأصل / القالب',
              prefixIcon: Icon(Icons.dashboard_customize_outlined),
              border: OutlineInputBorder(),
            ),
            items: _templates
                .map(
                  (item) => DropdownMenuItem(
                    value: item.id,
                    child: Text(item.labelAr),
                  ),
                )
                .toList(growable: false),
            onChanged: _busy
                ? null
                : (value) {
                    if (value == null) return;
                    final selected =
                        _templates.where((item) => item.id == value).toList();
                    if (selected.isEmpty) return;
                    setState(() {
                      _applyTemplate(selected.first);
                      _message = null;
                    });
                  },
          ),
          if (template != null) ...[
            const SizedBox(height: 8),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              title: const Text(
                'مواصفات القالب',
                style: TextStyle(fontWeight: FontWeight.w800),
              ),
              subtitle: Text(
                template.dimensionsLabel +
                    ' • ' +
                    template.extensionsLabel +
                    ' • ' +
                    template.motionLabel,
                style: const TextStyle(fontSize: 11.5),
              ),
              children: [_templateGuide(template)],
            ),
          ],
          const SizedBox(height: 10),
          InkWell(
            onTap: _busy || template == null ? null : _pickImage,
            borderRadius: BorderRadius.circular(16),
            child: Container(
              padding: const EdgeInsets.all(15),
              decoration: BoxDecoration(
                color: const Color(0xFF21172E),
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: const Color(0xFF9A6CFF).withValues(alpha: .42),
                ),
              ),
              child: Row(
                children: [
                  Container(
                    width: 50,
                    height: 50,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: const Color(0xFF9A6CFF).withValues(alpha: .15),
                    ),
                    child: const Icon(
                      Icons.cloud_upload_outlined,
                      color: Color(0xFFCDB7FF),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          _pickedName == null
                              ? 'اختر صورة الأصل'
                              : 'تغيير الملف الحالي',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          template == null
                              ? 'اختر القالب أولاً'
                              : 'الصيغ: ' +
                                  template.extensionsLabel +
                                  ' • الحد ' +
                                  (template.maxBytes / 1000000)
                                      .toStringAsFixed(1) +
                                  ' MB',
                          style: const TextStyle(
                            color: Colors.white60,
                            fontSize: 11.5,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.chevron_left_rounded, color: Colors.white54),
                ],
              ),
            ),
          ),
          if (_conversionNote != null) ...[
            const SizedBox(height: 8),
            Text(
              _conversionNote!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                color: Colors.greenAccent,
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
          if (_bytes != null) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(15),
              child: Container(
                height: 180,
                color: Colors.black26,
                padding: const EdgeInsets.all(8),
                child: Image.memory(_bytes!, fit: BoxFit.contain),
              ),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Icon(
                  validation == null
                      ? Icons.verified_rounded
                      : Icons.error_outline_rounded,
                  size: 19,
                  color: validation == null
                      ? Colors.greenAccent
                      : Colors.orangeAccent,
                ),
                const SizedBox(width: 7),
                Expanded(
                  child: Text(
                    validation == null
                        ? 'الملف جاهز للحفظ أو النشر'
                        : validation,
                    style: const TextStyle(fontSize: 11.5),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 18),
          const Text(
            'معلومات الأصل',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _directory,
            enabled: !_busy,
            onChanged: (_) => setState(_syncGiftFileNameFromAssetKey),
            decoration: const InputDecoration(
              labelText: 'المسار داخل المشروع',
              prefixIcon: Icon(Icons.folder_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _fileName,
            enabled: !_busy,
            onEditingComplete: () async {
              FocusScope.of(context).unfocus();
              if (_sourceBytes == null) return;
              setState(() {
                _busy = true;
                _message = 'جارٍ تجهيز الملف...';
              });
              await _convertSelectedToTarget();
              if (mounted) setState(() => _busy = false);
            },
            decoration: const InputDecoration(
              labelText: 'اسم الملف',
              prefixIcon: Icon(Icons.insert_drive_file_outlined),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _assetKey,
            enabled: !_busy,
            onChanged: (_) => setState(_syncGiftFileNameFromAssetKey),
            decoration: const InputDecoration(
              labelText: 'Asset Key',
              prefixIcon: Icon(Icons.link_rounded),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 16),
          const Text(
            'طريقة الاستخدام',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: ChoiceChip(
                  selected: _mode == 'remote',
                  label: const SizedBox(
                    width: double.infinity,
                    child: Text(
                      'Remote + Cached\nتحميل من الخادم مع التخزين المؤقت',
                      textAlign: TextAlign.center,
                    ),
                  ),
                  onSelected: _busy
                      ? null
                      : (_) => setState(() => _mode = 'remote'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ChoiceChip(
                  selected: _mode == 'bundled',
                  label: const SizedBox(
                    width: double.infinity,
                    child: Text(
                      'محلي\nيدخل في Build التطبيق',
                      textAlign: TextAlign.center,
                    ),
                  ),
                  onSelected: _busy
                      ? null
                      : (_) => setState(() => _mode = 'bundled'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text(
              'قنوات الاستخدام',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text(
              _selectedChannels.map(_channelLabel).join(' • '),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5),
            ),
            children: [
              Align(
                alignment: Alignment.centerRight,
                child: Wrap(
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
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _reason,
            enabled: !_busy,
            maxLength: 200,
            decoration: const InputDecoration(
              labelText: 'سبب التغيير',
              hintText: 'مثال: تحديث التصميم أو تحسين الجودة',
              prefixIcon: Icon(Icons.edit_note_rounded),
              border: OutlineInputBorder(),
            ),
          ),
          if (_message != null) ...[
            Container(
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: const Color(0xFFD7B85A).withValues(alpha: .08),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.info_outline_rounded,
                    color: Color(0xFFD7B85A),
                    size: 18,
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      _message!,
                      style: const TextStyle(fontSize: 11.5),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _upload(publish: false),
                  icon: const Icon(Icons.save_outlined),
                  label: const Text('حفظ مسودة'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : () => _upload(publish: true),
                  icon: _busy
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.publish_outlined),
                  label: Text(_busy ? 'جارٍ التنفيذ...' : 'نشر'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 7),
          const Text(
            'حفظ المسودة لا يغيّر النسخة الحية. التحديث الفعلي يتم عند النشر.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white54, fontSize: 10.5),
          ),
        ],
      ),
    );
  }

  Widget _registryItem(Map<String, dynamic> asset) {
    final published = asset['published'] == true;
    final draft = asset['draft'] is Map
        ? Map<String, dynamic>.from(asset['draft'] as Map)
        : <String, dynamic>{};
    final hasDraft = asset['hasDraft'] == true && draft.isNotEmpty;
    final source = hasDraft ? draft : asset;
    final key = (asset['assetKey'] ?? '').toString();
    final path =
        (source['fullPath'] ?? asset['fullPath'] ?? '').toString();
    final status = _assetStatusLabel(asset);
    final statusColor = status == 'منشور'
        ? Colors.greenAccent
        : status == 'مسودة'
            ? Colors.amberAccent
            : const Color(0xFFC4A7FF);

    return Container(
      margin: const EdgeInsets.only(bottom: 9),
      padding: const EdgeInsets.all(11),
      decoration: BoxDecoration(
        color: const Color(0xFF15101F),
        borderRadius: BorderRadius.circular(15),
        border: Border.all(color: Colors.white.withValues(alpha: .07)),
      ),
      child: Row(
        children: [
          Container(
            width: 46,
            height: 46,
            decoration: BoxDecoration(
              color: const Color(0xFF9A6CFF).withValues(alpha: .12),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.image_outlined,
              color: Color(0xFFCDB7FF),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  key.isEmpty ? 'أصل بدون مفتاح' : key,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 3),
                Text(
                  path,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textDirection: TextDirection.ltr,
                  textAlign: TextAlign.right,
                  style: const TextStyle(color: Colors.white54, fontSize: 10.5),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
            decoration: BoxDecoration(
              color: statusColor.withValues(alpha: .10),
              borderRadius: BorderRadius.circular(999),
            ),
            child: Text(
              status,
              style: TextStyle(
                color: statusColor,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          if (hasDraft)
            IconButton(
              tooltip: 'نشر المسودة',
              onPressed: _busy ? null : () => _publishAsset(asset),
              icon: const Icon(Icons.publish_outlined),
            )
          else if (published)
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 8),
              child: Icon(
                Icons.verified_rounded,
                color: Colors.greenAccent,
                size: 19,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildRegistry() {
    final visible = _visibleAssets;
    return _studioPanel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'سجل الأصول',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
                ),
              ),
              IconButton(
                tooltip: 'تحديث السجل',
                onPressed: _busy ? null : _loadAssets,
                icon: const Icon(Icons.refresh_rounded),
              ),
            ],
          ),
          const Text(
            'ابحث بالمفتاح أو المسار، ثم صفِّ النتائج حسب الحالة.',
            style: TextStyle(color: Colors.white60, fontSize: 11.5),
          ),
          const SizedBox(height: 11),
          TextField(
            controller: _assetSearch,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              hintText: 'البحث في الأصول...',
              prefixIcon: Icon(Icons.search_rounded),
              border: OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 9),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                ChoiceChip(
                  label: const Text('الكل'),
                  selected: _assetFilter == 'all',
                  onSelected: (_) => setState(() => _assetFilter = 'all'),
                ),
                const SizedBox(width: 7),
                ChoiceChip(
                  label: const Text('منشور'),
                  selected: _assetFilter == 'published',
                  onSelected: (_) => setState(() => _assetFilter = 'published'),
                ),
                const SizedBox(width: 7),
                ChoiceChip(
                  label: const Text('مسودة'),
                  selected: _assetFilter == 'draft',
                  onSelected: (_) => setState(() => _assetFilter = 'draft'),
                ),
                const SizedBox(width: 7),
                ChoiceChip(
                  label: const Text('يحتاج مراجعة'),
                  selected: _assetFilter == 'review',
                  onSelected: (_) => setState(() => _assetFilter = 'review'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          if (_assets.isEmpty)
            Container(
              padding: const EdgeInsets.symmetric(vertical: 22, horizontal: 12),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: .03),
                borderRadius: BorderRadius.circular(14),
              ),
              child: const Column(
                children: [
                  Icon(
                    Icons.inventory_2_outlined,
                    color: Colors.white38,
                    size: 36,
                  ),
                  SizedBox(height: 7),
                  Text(
                    'لا توجد أصول مسجلة بعد',
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                  SizedBox(height: 3),
                  Text(
                    'سيظهر الأصل هنا مباشرة بعد أول حفظ أو نشر.',
                    textAlign: TextAlign.center,
                    style: TextStyle(color: Colors.white54, fontSize: 11.5),
                  ),
                ],
              ),
            )
          else if (visible.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(
                child: Text(
                  'لا توجد نتائج مطابقة.',
                  style: TextStyle(color: Colors.white54),
                ),
              ),
            )
          else
            ...visible.map(_registryItem),
        ],
      ),
    );
  }

  Widget _ownerBody() {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _studioPanel(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      Icons.auto_awesome_mosaic_outlined,
                      color: Color(0xFFD7B85A),
                      size: 30,
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'إدارة أصول Shadow Live',
                            style: TextStyle(
                              fontSize: 23,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                          SizedBox(height: 5),
                          Text(
                            'ارفع وعدّل وانشر أصول التطبيق من مكان واحد وبخطوات واضحة.',
                            style: TextStyle(
                              color: Colors.white60,
                              height: 1.45,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 15),
                SingleChildScrollView(
                  scrollDirection: Axis.horizontal,
                  child: Row(
                    children: [
                      _studioStep(
                        1,
                        Icons.dashboard_customize_outlined,
                        'القالب',
                        active: true,
                      ),
                      _studioStep(2, Icons.cloud_upload_outlined, 'الرفع'),
                      _studioStep(3, Icons.verified_user_outlined, 'التحقق'),
                      _studioStep(4, Icons.visibility_outlined, 'المعاينة'),
                      _studioStep(5, Icons.publish_outlined, 'الحفظ أو النشر'),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          _studioPanel(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Row(
                  children: [
                    Icon(Icons.star_rounded, color: Color(0xFFD7B85A)),
                    SizedBox(width: 7),
                    Text(
                      'الأصل المحدد',
                      style: TextStyle(
                        color: Color(0xFFD7B85A),
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                ClipRRect(
                  borderRadius: BorderRadius.circular(15),
                  child: Image.asset(
                    'assets/images/auth_header.png',
                    height: 145,
                    fit: BoxFit.cover,
                  ),
                ),
                const SizedBox(height: 11),
                const Text(
                  'صورة شاشة تسجيل الدخول',
                  style: TextStyle(fontSize: 19, fontWeight: FontWeight.w900),
                ),
                const SizedBox(height: 4),
                const Text(
                  'الصورة المعروضة في أعلى شاشة تسجيل الدخول.',
                  style: TextStyle(color: Colors.white60),
                ),
                const SizedBox(height: 10),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 11, vertical: 9),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: .18),
                    borderRadius: BorderRadius.circular(11),
                  ),
                  child: const Row(
                    children: [
                      Icon(Icons.link_rounded, size: 17, color: Colors.white54),
                      SizedBox(width: 7),
                      Expanded(
                        child: Text(
                          'auth.login.header',
                          textDirection: TextDirection.ltr,
                          textAlign: TextAlign.right,
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 11),
                FilledButton.icon(
                  onPressed: _busy
                      ? null
                      : () {
                          _selectAuthHeaderPreset();
                          setState(() => _showStudioForm = true);
                        },
                  icon: const Icon(Icons.edit_outlined),
                  label: const Text('تعديل هذا الأصل'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _busy
                ? null
                : () => setState(() {
                      _showStudioForm = true;
                      _message = null;
                    }),
            icon: const Icon(Icons.add_circle_outline_rounded),
            label: const Padding(
              padding: EdgeInsets.symmetric(vertical: 13),
              child: Text(
                'إضافة أصل جديد',
                style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _statTile(
                Icons.inventory_2_outlined,
                _assets.length.toString(),
                'إجمالي الأصول',
                const Color(0xFFC4A7FF),
              ),
              const SizedBox(width: 7),
              _statTile(
                Icons.verified_rounded,
                _publishedCount.toString(),
                'منشورة',
                Colors.greenAccent,
              ),
              const SizedBox(width: 7),
              _statTile(
                Icons.schedule_rounded,
                _draftCount.toString(),
                'مسودات',
                Colors.amberAccent,
              ),
            ],
          ),
          if (_showStudioForm) ...[
            const SizedBox(height: 15),
            _buildStudioForm(),
          ],
          const SizedBox(height: 15),
          _buildRegistry(),
          const SizedBox(height: 12),
          _studioPanel(
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              leading: const Icon(
                Icons.security_outlined,
                color: Color(0xFFD7B85A),
              ),
              title: const Text(
                'معلومات الحماية',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: const Text(
                'تفاصيل تقنية — افتحها فقط عند الحاجة',
                style: TextStyle(color: Colors.white54, fontSize: 11.5),
              ),
              children: const [
                Text(
                  'Owner-only • Recent Auth • Templates/Channels • Validation • '
                  'R2 Drafts • Publish-only GitHub Commit • Idempotency • '
                  'Firestore Registry • Audit Log. لا Polling ولا Reads على Room/Gift hot paths.',
                  style: TextStyle(color: Colors.white60, height: 1.45),
                ),
              ],
            ),
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
          ),
          const SizedBox(height: 24),
        ],
      ),
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
