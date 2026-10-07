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
  const ControlAssetManagerPage({super.key, this.initialSearch = ''});

  final String initialSearch;

  @override
  State<ControlAssetManagerPage> createState() => _ControlAssetManagerPageState();
}

class _ControlAssetManagerPageState extends State<ControlAssetManagerPage> {
  final _assetKey = TextEditingController(text: 'vip.badge.1');
  final _directory = TextEditingController(text: 'assets/images/vip');
  final _fileName = TextEditingController(text: 'vip_1.webp');
  final _reason = TextEditingController(text: 'تحديث أصل التطبيق من Shadow Control');
  final _assetSearch = TextEditingController();
  final _assetFamilySearch = TextEditingController();
  final _assetLevelSearch = TextEditingController();

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
  bool? _preparedHasAlpha;
  int? _preparedFrameCount;
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
  String _assetFamilyFilter = '';
  String _assetLevelFilter = '';
  String _assetUpdatedWindow = 'all';
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
  String? _registryCursorUpdatedAt;
  String? _registryCursorId;
  bool _hasMoreRegistry = true;
  bool _loadingMoreRegistry = false;
  bool _registryScanLimitReached = false;
  int _registryRequestGeneration = 0;
  final Set<String> _favoriteAssetKeys = <String>{};
  final List<String> _recentAssetKeys = <String>[];
  final Set<String> _favoriteTemplateIds = <String>{};
  final List<String> _recentTemplateIds = <String>[];
  Map<String, dynamic>? _activeManifest;
  List<Map<String, dynamic>> _batchResults = const [];
  String? _batchProgressLabel;
  bool _batchBusy = false;

  @override
  void dispose() {
    _assetKey.dispose();
    _directory.dispose();
    _fileName.dispose();
    _reason.dispose();
    _assetSearch.dispose();
    _assetFamilySearch.dispose();
    _assetLevelSearch.dispose();
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

  String _effectiveAssetType(Map<String, dynamic> asset) {
    final source = _assetSource(asset);
    final key = (asset['assetKey'] ?? '').toString().trim().toLowerCase();
    final fullPath = (source['fullPath'] ?? asset['fullPath'] ?? '')
        .toString()
        .trim()
        .toLowerCase();
    final fileName = _assetFileName(asset).toLowerCase();
    if (key.endsWith('.profileframe') ||
        fileName.contains('_profile_frame.') ||
        fullPath.contains('_profile_frame.')) {
      return 'frame';
    }
    return (source['assetType'] ?? asset['assetType'] ?? '')
        .toString()
        .trim();
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

  void _recordRecentTemplate(String id) {
    final value = id.trim();
    if (value.isEmpty) return;
    _recentTemplateIds.remove(value);
    _recentTemplateIds.insert(0, value);
    if (_recentTemplateIds.length > 6) {
      _recentTemplateIds.removeRange(6, _recentTemplateIds.length);
    }
  }

  void _toggleFavoriteTemplate(String id) {
    final value = id.trim();
    if (value.isEmpty) return;
    setState(() {
      if (_favoriteTemplateIds.contains(value)) {
        _favoriteTemplateIds.remove(value);
      } else {
        _favoriteTemplateIds.add(value);
      }
    });
  }

  ControlAssetStudioTemplate? _templateById(String id) {
    for (final template in _templates) {
      if (template.id == id) return template;
    }
    return null;
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
    _preparedHasAlpha = null;
    _preparedFrameCount = null;
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
    final preferredTemplateId = _effectiveAssetType(asset) == 'frame'
        ? 'frame.base.v1'
        : templateId;
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
      if (preferredTemplateId.isNotEmpty &&
          _templates.any((template) => template.id == preferredTemplateId)) {
        _selectedTemplateId = preferredTemplateId;
        _recordRecentTemplate(preferredTemplateId);
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
      _message = 'تم نسخ إعدادات الأصل. غيّر مفتاح الأصل واسم الملف واختر صورة جديدة.';
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
              'تغيير مفتاح الأصل أو المسار أو اسم الملف قد يفصل الأصل عن الأماكن المرتبطة به. استخدمه فقط إذا كنت تقصد نقل الأصل.',
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
      'مفتاح الأصل: ${asset['assetKey'] ?? ''}',
      'Path: ${source['fullPath'] ?? asset['fullPath'] ?? ''}',
      'File: ${source['fileName'] ?? asset['fileName'] ?? ''}',
      'القالب: ${source['templateId'] ?? asset['templateId'] ?? ''}',
      'Channels: ${((source['channels'] ?? asset['channels']) as List?)?.join(', ') ?? ''}',
      'رابط النسخة المنشورة: ${asset['rawUrl'] ?? ''}',
      'بصمة النسخة: ${asset['contentSha'] ?? ''}',
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
      unawaited(_loadAssets());
    });
  }

  void _applyRegistryFilters({
    String? status,
    String? type,
    String? channel,
    String? family,
    String? level,
    String? updatedWindow,
  }) {
    setState(() {
      if (status != null) _assetFilter = status;
      if (type != null) _assetTypeFilter = type;
      if (channel != null) _assetChannelFilter = channel;
      if (family != null) _assetFamilyFilter = family.trim();
      if (level != null) _assetLevelFilter = level.trim();
      if (updatedWindow != null) _assetUpdatedWindow = updatedWindow;
      _visibleLimit = 24;
    });
    unawaited(_loadAssets());
  }

  void _clearRegistryFilters() {
    _searchDebounce?.cancel();
    _assetSearch.clear();
    _assetFamilySearch.clear();
    _assetLevelSearch.clear();
    setState(() {
      _debouncedSearch = '';
      _assetFilter = 'all';
      _assetTypeFilter = 'all';
      _assetChannelFilter = 'all';
      _assetFamilyFilter = '';
      _assetLevelFilter = '';
      _assetUpdatedWindow = 'all';
      _visibleLimit = 24;
    });
    unawaited(_loadAssets());
  }

  Future<String> _token() async {
    final token = await controlAuth.currentUser?.getIdToken(true);
    if (token == null || token.trim().isEmpty) {
      throw StateError('تعذر التحقق من جلسة الدخول.');
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
    _recordRecentTemplate(template.id);
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

  img.Image _prepareDimensions(img.Image decoded) =>
      _prepareDimensionsForDirectory(
        decoded,
        ControlAssetPolicy.normalizeDirectory(_directory.text),
      );

  img.Image _prepareDimensionsForDirectory(
    img.Image decoded,
    String directory,
  ) {
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

  bool _imageHasRealTransparency(img.Image image) {
    for (final frame in image.frames) {
      if (frame.numChannels < 4) continue;
      final maxAlpha = frame.maxChannelValue;
      if (frame.any((pixel) => pixel.a < maxAlpha)) return true;
    }
    return false;
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

  String _aspectRatioLabel(int? width, int? height) {
    if (width == null || height == null || width <= 0 || height <= 0) {
      return '—';
    }

    int gcd(int a, int b) {
      while (b != 0) {
        final next = a % b;
        a = b;
        b = next;
      }
      return a.abs();
    }

    final divisor = gcd(width, height);
    final simpleWidth = width ~/ divisor;
    final simpleHeight = height ~/ divisor;
    if (simpleWidth <= 20 && simpleHeight <= 20) {
      return '$simpleWidth:$simpleHeight';
    }
    return (width / height).toStringAsFixed(2);
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
              'الملف المتحرك أكبر من الحد المسموح في الاستديو. استخدم نسخة أصغر مع نفس الصيغة.');
        }
        return false;
      }
      if (mounted) {
        setState(() {
          _bytes = sourceBytes;
          _mimeType = _mimeForExtension(extension);
          _preparedWidth = decoded.width;
          _preparedHeight = decoded.height;
          _preparedHasAlpha = _imageHasRealTransparency(decoded);
          _preparedAnimated = true;
          _preparedFrameCount = decoded.numFrames;
          _conversionNote =
              'تم الحفاظ على الحركة الأصلية • '
              '${decoded.width}×${decoded.height} • '
              '${(sourceBytes.length / 1024).toStringAsFixed(1)} كيلوبايت';
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
            'تعذر تجهيز ${_formatLabel(extension)} تحت حد 2.5 ميغابايت. جرّب WebP أو صورة أصغر.');
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
        _preparedHasAlpha = extension == 'jpg' || extension == 'jpeg'
            ? false
            : _imageHasRealTransparency(prepared);
        _preparedAnimated = false;
        _preparedFrameCount = 1;
        _conversionNote =
            'تجهيز تلقائي حسب اسم الملف → ${_formatLabel(extension)} • '
            '${prepared.width}×${prepared.height} • '
            '${sourceKb.toStringAsFixed(1)} كيلوبايت → ${outputKb.toStringAsFixed(1)} كيلوبايت';
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
        _preparedFrameCount = null;
        _fileName.text = outputName;
        _hasUnsavedChanges = true;
        _lastSuccess = null;
        _lastFailedPublishIntent = null;
        _operationId = null;
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

  Future<void> _loadAssets({bool append = false}) async {
    if (_loadingMoreRegistry) return;
    if (append && !_hasMoreRegistry) return;

    final requestGeneration = append
        ? _registryRequestGeneration
        : ++_registryRequestGeneration;

    if (append && mounted) {
      setState(() => _loadingMoreRegistry = true);
    }

    try {
      final params = <String, String>{'limit': '60'};
      if (_debouncedSearch.isNotEmpty) {
        params['q'] = _debouncedSearch;
      }
      if (_assetFilter != 'all') params['status'] = _assetFilter;
      if (_assetTypeFilter != 'all') params['type'] = _assetTypeFilter;
      if (_assetChannelFilter != 'all') {
        params['channel'] = _assetChannelFilter;
      }
      if (_assetFamilyFilter.trim().isNotEmpty) {
        params['family'] = _assetFamilyFilter.trim().toLowerCase();
      }
      if (_assetLevelFilter.trim().isNotEmpty) {
        params['level'] = _assetLevelFilter.trim().toLowerCase();
      }
      if (_assetUpdatedWindow != 'all') {
        final days = switch (_assetUpdatedWindow) {
          '7d' => 7,
          '30d' => 30,
          '90d' => 90,
          _ => 0,
        };
        if (days > 0) {
          params['updatedAfter'] = DateTime.now()
              .toUtc()
              .subtract(Duration(days: days))
              .toIso8601String();
        }
      }
      if (append &&
          _registryCursorUpdatedAt != null &&
          _registryCursorId != null) {
        params['cursorUpdatedAt'] = _registryCursorUpdatedAt!;
        params['cursorId'] = _registryCursorId!;
      }

      final uri = _endpoint.replace(queryParameters: params);
      final response = await http.get(
        uri,
        headers: {'authorization': 'Bearer ${await _token()}'},
      );

      if (!append && requestGeneration != _registryRequestGeneration) {
        return;
      }

      final decoded =
          response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
      final body = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{};
      if (response.statusCode == 200 && body['ok'] == true) {
        final list = body['assets'];
        final rawTemplates = body['templates'];
        final rawChannels = body['channels'];
        final nextCursor = body['nextCursor'] is Map
            ? Map<String, dynamic>.from(body['nextCursor'] as Map)
            : <String, dynamic>{};

        if (mounted &&
            (append || requestGeneration == _registryRequestGeneration)) {
          final templates = rawTemplates is List
              ? rawTemplates
                  .whereType<Map>()
                  .map(
                    (e) => ControlAssetStudioTemplate.fromMap(
                      Map<String, dynamic>.from(e),
                    ),
                  )
                  .where((e) => e.id.isNotEmpty && e.type.isNotEmpty)
                  .toList(growable: false)
              : <ControlAssetStudioTemplate>[];
          final channels = rawChannels is List
              ? rawChannels
                  .map((e) => e.toString().trim())
                  .where((e) => e.isNotEmpty)
                  .toList(growable: false)
              : _channels;
          final incoming = list is List
              ? list
                  .whereType<Map>()
                  .map((e) => Map<String, dynamic>.from(e))
                  .toList(growable: false)
              : <Map<String, dynamic>>[];

          setState(() {
            _studioVersion =
                (body['studioVersion'] as num?)?.toInt() ?? _studioVersion;
            if (append) {
              final byKey = <String, Map<String, dynamic>>{
                for (final asset in _assets)
                  (asset['assetKey'] ?? '').toString(): asset,
              };
              for (final asset in incoming) {
                byKey[(asset['assetKey'] ?? '').toString()] = asset;
              }
              _assets = byKey.values.toList(growable: false);
            } else {
              _assets = incoming;
            }
            if (templates.isNotEmpty) _templates = templates;
            if (channels.isNotEmpty) _channels = channels;
            _registryCursorUpdatedAt =
                (nextCursor['updatedAt'] ?? '').toString().trim().isEmpty
                    ? null
                    : (nextCursor['updatedAt'] ?? '').toString();
            _registryCursorId =
                (nextCursor['id'] ?? '').toString().trim().isEmpty
                    ? null
                    : (nextCursor['id'] ?? '').toString();
            _hasMoreRegistry =
                _registryCursorUpdatedAt != null && _registryCursorId != null;
            _registryScanLimitReached = body['scanLimitReached'] == true;
            if (!append) _visibleLimit = 24;
            if (_selectedTemplate == null && _templates.isNotEmpty) {
              final badge = _templates
                  .where((e) => e.id == 'badge.base.v1')
                  .toList();
              _applyTemplate(
                badge.isNotEmpty ? badge.first : _templates.first,
              );
            }
            _selectedChannels.removeWhere(
              (value) => !_channels.contains(value),
            );
            if (_selectedChannels.isEmpty && _channels.isNotEmpty) {
              _selectedChannels.add(_channels.first);
            }
          });
        }
      } else if (mounted &&
          (append || requestGeneration == _registryRequestGeneration)) {
        setState(() {
          _message =
              'تعذر تحديث سجل الأصول: ${body['code'] ?? response.statusCode}';
        });
      }
    } catch (e) {
      if (mounted &&
          (append || requestGeneration == _registryRequestGeneration)) {
        setState(() => _message = 'تعذر تحديث سجل الأصول: $e');
      }
    } finally {
      if (mounted && append) {
        setState(() => _loadingMoreRegistry = false);
      }
    }
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
    if (type == 'badge' ||
        type == 'vip_cosmetic' ||
        type == 'agency_cosmetic' ||
        type == 'event_cosmetic') {
      return Container(
        height: 190,
        color: const Color(0xFF07111F),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(16),
        child: Container(
          width: 275,
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF171025),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.white12),
          ),
          child: Row(
            children: [
              SizedBox(width: 72, height: 72, child: image()),
              const SizedBox(width: 12),
              const Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      'معاينة داخل بطاقة المستوى',
                      style: TextStyle(
                        fontWeight: FontWeight.w900,
                        fontSize: 13,
                      ),
                    ),
                    SizedBox(height: 5),
                    Text(
                      'المستوى الحالي',
                      style: TextStyle(
                        color: Colors.white60,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
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
    if (type == 'entrance') {
      return Container(
        height: 190,
        color: const Color(0xFF07111F),
        alignment: Alignment.center,
        child: Stack(
          alignment: Alignment.center,
          children: [
            Positioned.fill(
              child: Opacity(
                opacity: .16,
                child: Container(color: const Color(0xFF5A3A8C)),
              ),
            ),
            SizedBox(width: 250, height: 125, child: image()),
            const Positioned(
              bottom: 14,
              child: Text(
                'معاينة تأثير الدخول إلى الغرفة',
                style: TextStyle(
                  color: Colors.white70,
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
          ],
        ),
      );
    }
    if (type == 'audio_wave' || type == 'mic_effect') {
      return Container(
        height: 190,
        color: const Color(0xFF07111F),
        alignment: Alignment.center,
        child: SizedBox(
          width: 150,
          height: 150,
          child: Stack(
            fit: StackFit.expand,
            children: [
              image(),
              const Center(
                child: CircleAvatar(
                  radius: 30,
                  backgroundColor: Color(0xFF34204F),
                  child: Icon(Icons.mic_rounded, color: Colors.white),
                ),
              ),
            ],
          ),
        ),
      );
    }
    if (type == 'name_effect') {
      return Container(
        height: 150,
        color: const Color(0xFF07111F),
        alignment: Alignment.center,
        padding: const EdgeInsets.all(22),
        child: Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(width: 260, height: 95, child: image()),
            const Text(
              'اسم المستخدم',
              style: TextStyle(
                fontWeight: FontWeight.w900,
                fontSize: 18,
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
                  tooltip: 'تحديث المعاينة من المصدر',
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
                          label: Text('داخل التطبيق'),
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
              TextButton.icon(
                onPressed: (asset['rawUrl'] ?? '').toString().trim().isEmpty
                    ? null
                    : () => _copyText(
                          (asset['rawUrl'] ?? '').toString(),
                          'رابط النسخة المنشورة',
                        ),
                icon: const Icon(Icons.link_rounded),
                label: const Text('نسخ رابط النسخة'),
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

  Future<Map<String, dynamic>> _loadManifestForAsset(
    Map<String, dynamic> asset,
  ) async {
    final key = (asset['assetKey'] ?? '').toString().trim();
    if (key.isEmpty) return <String, dynamic>{};
    final body = await _loadAssetInsight(key, 'manifest');
    final manifest = body['manifest'] is Map
        ? Map<String, dynamic>.from(body['manifest'] as Map)
        : <String, dynamic>{};
    if (mounted) {
      setState(() => _activeManifest = manifest);
    }
    return manifest;
  }

  Map<String, dynamic>? _loadedAssetByKey(String key) {
    for (final asset in _assets) {
      if ((asset['assetKey'] ?? '').toString() == key) return asset;
    }
    return null;
  }

  Future<Map<String, dynamic>?> _fetchAssetByKey(String key) async {
    final loaded = _loadedAssetByKey(key);
    if (loaded != null) return loaded;
    final uri = _endpoint.replace(queryParameters: {'assetKey': key});
    final response = await http.get(
      uri,
      headers: {'authorization': 'Bearer ${await _token()}'},
    );
    final decoded =
        response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    final body = decoded is Map<String, dynamic>
        ? decoded
        : <String, dynamic>{};
    if (response.statusCode >= 200 &&
        response.statusCode < 300 &&
        body['ok'] == true &&
        body['asset'] is Map) {
      return Map<String, dynamic>.from(body['asset'] as Map);
    }
    return null;
  }

  Future<void> _openNextManifestAsset() async {
    final editing = _editingAsset;
    if (editing == null) return;
    setState(() => _busy = true);
    try {
      final manifest =
          _activeManifest ?? await _loadManifestForAsset(editing);
      final assets = manifest['assets'] is List
          ? (manifest['assets'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .toList(growable: false)
          : <Map<String, dynamic>>[];
      final currentKey =
          (editing['assetKey'] ?? '').toString().trim();
      final index = assets.indexWhere(
        (item) => (item['assetKey'] ?? '').toString() == currentKey,
      );
      if (assets.isEmpty || index < 0) {
        if (mounted) {
          setState(() => _message =
              'تعذر تحديد الأصل التالي من سجل الدفعة الرسمي.');
        }
        return;
      }

      final ordered = <Map<String, dynamic>>[
        for (var offset = 1; offset < assets.length; offset++)
          assets[(index + offset) % assets.length],
      ];
      Map<String, dynamic>? nextSpec;
      for (final candidate in ordered) {
        final key = (candidate['assetKey'] ?? '').toString().trim();
        if (key.isEmpty) continue;
        if (candidate['published'] != true || candidate['hasDraft'] == true) {
          nextSpec = candidate;
          break;
        }
      }
      if (nextSpec == null) {
        for (final candidate in ordered) {
          if ((candidate['assetKey'] ?? '').toString().trim().isNotEmpty) {
            nextSpec = candidate;
            break;
          }
        }
      }
      if (nextSpec == null) return;
      final nextKey = (nextSpec['assetKey'] ?? '').toString().trim();
      final nextAsset = await _fetchAssetByKey(nextKey);
      if (!mounted) return;
      if (nextAsset == null) {
        setState(() => _message =
            'الأصل التالي $nextKey موجود في سجل الدفعة لكنه غير مسجل بعد.');
        return;
      }
      _beginEditAsset(nextAsset);
      setState(() {
        _activeManifest = manifest;
        _message = 'تم فتح الأصل التالي في نفس الدفعة.';
      });
    } catch (e) {
      if (mounted) {
        setState(() => _message = 'تعذر فتح الأصل التالي: $e');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<Map<String, dynamic>> _prepareBatchFile(
    XFile file,
    Map<String, dynamic> spec,
  ) async {
    final sourceBytes = await file.readAsBytes();
    final decoded = img.decodeImage(sourceBytes);
    if (decoded == null) {
      throw StateError('تعذر قراءة الصورة.');
    }

    final fileName = (spec['fileName'] ?? '').toString().trim();
    final directory = ControlAssetPolicy.normalizeDirectory(
      (spec['directory'] ?? '').toString(),
    );
    final extension = _extensionOf(fileName);
    if (!ControlAssetPolicy.allowedExtensions.contains(extension)) {
      throw StateError('امتداد الهدف غير مدعوم.');
    }

    final sourceExtension = _extensionOf(file.name);
    final animated = decoded.numFrames > 1;
    Uint8List output;
    int width;
    int height;

    if (animated) {
      if (sourceExtension != extension) {
        throw StateError(
          'الملف متحرك؛ يجب أن يطابق امتداد الهدف للحفاظ على الحركة.',
        );
      }
      if (sourceBytes.length > ControlAssetPolicy.maxBytes) {
        throw StateError('حجم الملف المتحرك أكبر من الحد.');
      }
      output = sourceBytes;
      width = decoded.width;
      height = decoded.height;
    } else {
      final prepared =
          _prepareDimensionsForDirectory(decoded, directory);
      final encoded = _encodeForTarget(prepared, extension);
      if (encoded == null) {
        throw StateError('تعذر ضغط الملف تحت الحد المسموح.');
      }
      output = encoded;
      width = prepared.width;
      height = prepared.height;
    }

    final expectedWidth = (spec['width'] as num?)?.toInt();
    final expectedHeight = (spec['height'] as num?)?.toInt();
    if (expectedWidth != null &&
        expectedHeight != null &&
        expectedWidth > 0 &&
        expectedHeight > 0 &&
        (width != expectedWidth || height != expectedHeight)) {
      throw StateError(
        'المقاس $width×$height لا يطابق المطلوب '
        '$expectedWidth×$expectedHeight.',
      );
    }

    return {
      'bytes': output,
      'mimeType': _mimeForExtension(extension),
      'width': width,
      'height': height,
      'animated': animated,
      'hasAlpha': extension == 'jpg' || extension == 'jpeg'
          ? false
          : _imageHasRealTransparency(decoded),
    };
  }

  Future<bool> _verifyRawUrl(String rawUrl) async {
    if (rawUrl.trim().isEmpty) return false;
    try {
      final separator = rawUrl.contains('?') ? '&' : '?';
      final response = await http.get(
        Uri.parse(
          '$rawUrl${separator}batchVerify=${DateTime.now().microsecondsSinceEpoch}',
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

  Future<void> _runBatchUpload(Map<String, dynamic> asset) async {
    if (_batchBusy || _busy) return;
    setState(() {
      _batchBusy = true;
      _batchProgressLabel = 'جارٍ تحميل سجل الدفعة الرسمي...';
      _batchResults = const [];
    });

    try {
      final manifest = await _loadManifestForAsset(asset);
      final specs = manifest['assets'] is List
          ? (manifest['assets'] as List)
              .whereType<Map>()
              .map((e) => Map<String, dynamic>.from(e))
              .take(40)
              .toList(growable: false)
          : <Map<String, dynamic>>[];
      if (specs.length <= 1) {
        throw StateError(
          'لم يتم العثور على دفعة متعددة الأصول لهذا الأصل.',
        );
      }

      final picked = await ImagePicker().pickMultiImage();
      if (picked.isEmpty) return;
      final files = picked.take(12).toList(growable: false);
      final byName = <String, XFile>{
        for (final file in files) file.name.toLowerCase(): file,
      };

      final initial = <Map<String, dynamic>>[];
      var matched = 0;
      for (final spec in specs) {
        final fileName = (spec['fileName'] ?? '').toString().trim();
        final file = byName[fileName.toLowerCase()];
        if (file != null) matched++;
        final existingState = spec['hasDraft'] == true
            ? 'Draft'
            : spec['published'] == true
                ? 'Published'
                : 'Missing';
        initial.add({
          ...spec,
          'batchState': file == null ? existingState : 'Ready',
          'localFile': file?.name,
        });
      }

      if (!mounted) return;
      final proceed = await showDialog<bool>(
            context: context,
            builder: (dialogContext) => AlertDialog(
              title: const Text('تأكيد رفع المجموعة'),
              content: Text(
                'الدفعة: ${manifest['batch'] ?? manifest['tier'] ?? '—'}\n'
                'المتوقع: ${specs.length} أصل\n'
                'المطابق بالاسم: $matched\n'
                'المحدد من الهاتف: ${files.length}\n\n'
                'سيتم نشر الملفات المطابقة فقط، بالتتابع ملفًا واحدًا كل مرة لتقليل الضغط.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(dialogContext, false),
                  child: const Text('إلغاء'),
                ),
                FilledButton(
                  onPressed: matched == 0
                      ? null
                      : () => Navigator.pop(dialogContext, true),
                  child: const Text('ابدأ النشر'),
                ),
              ],
            ),
          ) ??
          false;
      if (!proceed) {
        setState(() => _batchResults = initial);
        return;
      }

      final results = initial
          .map((item) => Map<String, dynamic>.from(item))
          .toList(growable: false);
      setState(() => _batchResults = results);

      var completed = 0;
      for (var i = 0; i < results.length; i++) {
        final item = results[i];
        if (item['batchState'] != 'Ready') continue;
        final fileName = (item['fileName'] ?? '').toString();
        final file = byName[fileName.toLowerCase()];
        if (file == null) continue;

        setState(() {
          item['batchState'] = 'Uploading';
          _batchProgressLabel =
              'جارٍ معالجة ${completed + 1} من $matched • $fileName';
        });

        try {
          final prepared = await _prepareBatchFile(file, item);
          final templateId = (item['templateId'] ?? '').toString().trim();
          final assetType = (item['assetType'] ?? '').toString().trim();
          final channels = item['channels'] is List
              ? (item['channels'] as List).map((e) => e.toString()).toList()
              : <String>[];
          if (templateId.isEmpty ||
              assetType.isEmpty ||
              channels.isEmpty) {
            throw StateError(
              'معلومات القالب أو أماكن الاستخدام غير مكتملة في سجل الأصول.',
            );
          }
          ControlAssetStudioTemplate? template;
          for (final candidate in _templates) {
            if (candidate.id == templateId) {
              template = candidate;
              break;
            }
          }
          if (template == null) {
            throw StateError('القالب غير متاح داخل الاستديو.');
          }
          final hasAlpha = prepared['hasAlpha'] == true;
          final animated = prepared['animated'] == true;
          if (template.transparency == 'required' && !hasAlpha) {
            throw StateError('الأصل يحتاج خلفية شفافة.');
          }
          if (template.transparency == 'forbidden' && hasAlpha) {
            throw StateError('الشفافية غير مسموحة لهذا الأصل.');
          }
          if (template.motion == 'static' && animated) {
            throw StateError('هذا الأصل يجب أن يكون ثابتًا.');
          }
          if (template.motion == 'animated' && !animated) {
            throw StateError('هذا الأصل يجب أن يكون متحركًا.');
          }

          final response = await http.post(
            _endpoint,
            headers: {
              'authorization': 'Bearer ${await _token()}',
              'content-type': 'application/json',
            },
            body: jsonEncode({
              'action': 'upload',
              'studioVersion': _studioVersion,
              'assetType': assetType,
              'templateId': templateId,
              'channels': channels,
              'publish': true,
              'assetKey': (item['assetKey'] ?? '').toString(),
              'directory': (item['directory'] ?? '').toString(),
              'fileName': fileName,
              'mimeType': prepared['mimeType'],
              'contentBase64':
                  base64Encode(prepared['bytes'] as Uint8List),
              'mode': item['mode'] == 'bundled' ? 'bundled' : 'remote',
              'reason': 'استبدال مجموعة من استديو الأصول',
              'idempotencyKey':
                  'asset_batch_${DateTime.now().microsecondsSinceEpoch}_$i',
            }),
          );
          final decoded = response.body.isEmpty
              ? <String, dynamic>{}
              : jsonDecode(response.body);
          final body = decoded is Map<String, dynamic>
              ? decoded
              : <String, dynamic>{};
          if (response.statusCode >= 200 &&
              response.statusCode < 300 &&
              body['ok'] == true) {
            final verified =
                await _verifyRawUrl((body['rawUrl'] ?? '').toString());
            setState(() {
              item['batchState'] =
                  verified ? 'Verified' : 'Published';
              item['note'] = verified
                  ? 'تم التأكد من النسخة المنشورة'
                  : 'تم النشر • التأكد النهائي لم يكتمل';
            });
          } else {
            setState(() {
              item['batchState'] = 'Failed';
              item['note'] =
                  (body['code'] ?? 'http_${response.statusCode}').toString();
            });
          }
        } catch (e) {
          if (mounted) {
            setState(() {
              item['batchState'] = 'Failed';
              item['note'] = e.toString();
            });
          }
        }

        completed++;
        await Future<void>.delayed(Duration.zero);
      }

      await _loadAssets();
      if (mounted) {
        final verified =
            results.where((item) => item['batchState'] == 'Verified').length;
        final failed =
            results.where((item) => item['batchState'] == 'Failed').length;
        setState(() {
          _batchProgressLabel =
              'انتهت الدفعة • تم التأكد من $verified • تعذر $failed';
          _message = failed == 0
              ? 'انتهى رفع المجموعة بدون أخطاء في الملفات المطابقة.'
              : 'انتهى رفع المجموعة ويوجد $failed ملف يحتاج مراجعة.';
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _batchProgressLabel = null;
          _message = 'تعذر تشغيل رفع المجموعة: $e';
        });
      }
    } finally {
      if (mounted) setState(() => _batchBusy = false);
    }
  }

  Future<Map<String, dynamic>> _loadAssetInsight(
    String assetKey,
    String include,
  ) async {
    final uri = _endpoint.replace(
      queryParameters: {
        'assetKey': assetKey,
        'include': include,
      },
    );
    final response = await http.get(
      uri,
      headers: {'authorization': 'Bearer ${await _token()}'},
    );
    final decoded =
        response.body.isEmpty ? <String, dynamic>{} : jsonDecode(response.body);
    final body = decoded is Map<String, dynamic>
        ? decoded
        : <String, dynamic>{};
    if (response.statusCode < 200 ||
        response.statusCode >= 300 ||
        body['ok'] != true) {
      throw StateError(
        'تعذر تحميل $include: ${body['code'] ?? response.statusCode}',
      );
    }
    return body;
  }

  Future<void> _rollbackPreviousVersion(
    Map<String, dynamic> asset,
    BuildContext dialogContext,
  ) async {
    final key = (asset['assetKey'] ?? '').toString().trim();
    if (key.isEmpty || _busy) return;
    final confirmed = await showDialog<bool>(
          context: dialogContext,
          builder: (confirmContext) => AlertDialog(
            title: const Text('استرجاع النسخة السابقة؟'),
            content: Text(
              'سيتم نشر النسخة السابقة من $key تحت نفس المفتاح والمسار. '
              'النسخة الحالية ستبقى محفوظة في سجل النسخ ويمكن الرجوع لها لاحقًا.',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(confirmContext, false),
                child: const Text('إلغاء'),
              ),
              FilledButton.icon(
                onPressed: () => Navigator.pop(confirmContext, true),
                icon: const Icon(Icons.history_rounded),
                label: const Text('استرجاع'),
              ),
            ],
          ),
        ) ??
        false;
    if (!confirmed) return;

    Navigator.pop(dialogContext);
    setState(() {
      _busy = true;
      _message = 'جارٍ استرجاع النسخة السابقة والتحقق منها...';
    });
    try {
      final response = await http.post(
        _endpoint,
        headers: {
          'authorization': 'Bearer ${await _token()}',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': 'rollback_previous',
          'assetKey': key,
          'reason': 'استرجاع النسخة السابقة من استديو الأصول',
          'idempotencyKey':
              'asset_rollback_${DateTime.now().microsecondsSinceEpoch}',
        }),
      );
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body);
      final body = decoded is Map<String, dynamic>
          ? decoded
          : <String, dynamic>{};
      if (response.statusCode >= 200 &&
          response.statusCode < 300 &&
          body['ok'] == true) {
        final sha = (body['contentSha'] ?? '').toString();
        final verified =
            sha.isNotEmpty ? await _verifyPublishedAsset(key, sha) : false;
        if (!mounted) return;
        setState(() {
          _message = verified
              ? 'تم استرجاع النسخة السابقة والتحقق من النسخة الحية.'
              : 'تم الاسترجاع، لكن التحقق الحي لم يكتمل.';
          _lastSuccess = {
            'assetKey': key,
            'fullPath': body['fullPath'],
            'status': 'published',
            'verified': verified,
            'replaced': true,
            'rawUrl': body['rawUrl'],
            'contentSha': body['contentSha'],
          };
        });
      } else {
        final code = (body['code'] ?? 'http_${response.statusCode}').toString();
        setState(() {
          _message = switch (code) {
            'asset_history_not_found' =>
              'لا توجد نسخة سابقة متاحة لهذا الأصل.',
            'asset_history_content_missing' =>
              'تعذر قراءة ملف النسخة السابقة من سجل النسخ.',
            'asset_not_published' =>
              'الأصل ليس منشورًا حاليًا ولا يمكن عمل Rollback.',
            _ => 'تعذر استرجاع النسخة السابقة: $code',
          };
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => _message = 'تعذر استرجاع النسخة السابقة: $e');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _healthLine(
    String label,
    bool ok, {
    required String okText,
    required String badText,
  }) {
    final color = ok ? Colors.greenAccent : Colors.orangeAccent;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            ok ? Icons.check_circle_rounded : Icons.warning_amber_rounded,
            color: color,
            size: 16,
          ),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              '$label: ${ok ? okText : badText}',
              style: TextStyle(
                color: ok ? Colors.white70 : Colors.orangeAccent,
                fontSize: 10.5,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _showAssetInsights(Map<String, dynamic> asset) async {
    final key = (asset['assetKey'] ?? '').toString().trim();
    if (key.isEmpty) return;
    setState(() => _busy = true);
    Map<String, dynamic>? historyBody;
    Map<String, dynamic>? usageBody;
    Map<String, dynamic>? healthBody;
    String? error;
    try {
      final results = await Future.wait([
        _loadAssetInsight(key, 'history'),
        _loadAssetInsight(key, 'usage'),
        _loadAssetInsight(key, 'health'),
      ]);
      historyBody = results[0];
      usageBody = results[1];
      healthBody = results[2];
    } catch (e) {
      error = e.toString();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;

    final history = historyBody?['history'] is Map
        ? Map<String, dynamic>.from(historyBody!['history'] as Map)
        : <String, dynamic>{};
    final commits = history['commits'] is List
        ? List<Map<String, dynamic>>.from(
            (history['commits'] as List).whereType<Map>().map(
                  (e) => Map<String, dynamic>.from(e),
                ),
          )
        : <Map<String, dynamic>>[];
    final audit = history['audit'] is List
        ? List<Map<String, dynamic>>.from(
            (history['audit'] as List).whereType<Map>().map(
                  (e) => Map<String, dynamic>.from(e),
                ),
          )
        : <Map<String, dynamic>>[];
    final usage = usageBody?['usage'] is Map
        ? Map<String, dynamic>.from(usageBody!['usage'] as Map)
        : <String, dynamic>{};
    final refs = usage['references'] is List
        ? List<Map<String, dynamic>>.from(
            (usage['references'] as List).whereType<Map>().map(
                  (e) => Map<String, dynamic>.from(e),
                ),
          )
        : <Map<String, dynamic>>[];
    final health = healthBody?['health'] is Map
        ? Map<String, dynamic>.from(healthBody!['health'] as Map)
        : <String, dynamic>{};
    final filesWithoutRegistry = health['filesWithoutRegistry'] is List
        ? (health['filesWithoutRegistry'] as List)
            .map((e) => e.toString())
            .toList(growable: false)
        : <String>[];
    final duplicatePathKeys = health['duplicatePathKeys'] is List
        ? (health['duplicatePathKeys'] as List)
            .map((e) => e.toString())
            .toList(growable: false)
        : <String>[];
    final duplicateFunctionKeys = health['duplicateFunctionKeys'] is List
        ? (health['duplicateFunctionKeys'] as List)
            .map((e) => e.toString())
            .toList(growable: false)
        : <String>[];

    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('استخدام الأصل وسجل النسخ'),
        content: SizedBox(
          width: 520,
          child: error != null
              ? Text(error!)
              : SingleChildScrollView(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      SelectableText(
                        key,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(11),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: .035),
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: Colors.white10),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const Text(
                              'تشخيص الأصل',
                              style: TextStyle(fontWeight: FontWeight.w900),
                            ),
                            const SizedBox(height: 7),
                            _healthLine(
                              'الملف موجود',
                              health['fileExists'] == true,
                              okText: 'نعم',
                              badText: 'لا — الملف غير موجود',
                            ),
                            _healthLine(
                              'استخدام مباشر',
                              health['unusedDirectly'] != true,
                              okText:
                                  '${health['directUsageCount'] ?? 0} مكان',
                              badText:
                                  'لا يوجد استخدام مباشر ظاهر',
                            ),
                            _healthLine(
                              'تكرار نفس المسار',
                              duplicatePathKeys.isEmpty,
                              okText: 'لا يوجد',
                              badText:
                                  duplicatePathKeys.join(' • '),
                            ),
                            _healthLine(
                              'تشابه قوي بنفس القالب والاستخدام',
                              duplicateFunctionKeys.isEmpty,
                              okText: 'لا يوجد',
                              badText:
                                  duplicateFunctionKeys.join(' • '),
                            ),
                            if (filesWithoutRegistry.isNotEmpty) ...[
                              const SizedBox(height: 8),
                              const Text(
                                'ملفات موجودة في نفس المجلد بدون تسجيل:',
                                style: TextStyle(
                                  color: Colors.orangeAccent,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 11,
                                ),
                              ),
                              const SizedBox(height: 4),
                              ...filesWithoutRegistry.take(8).map(
                                    (path) => SelectableText(
                                      path,
                                      textDirection: TextDirection.ltr,
                                      style: const TextStyle(
                                        color: Colors.white60,
                                        fontSize: 10,
                                      ),
                                    ),
                                  ),
                            ],
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        'أماكن الاستخدام الفعلية في الكود (${usage['totalReferences'] ?? refs.length})',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      const SizedBox(height: 6),
                      if (refs.isEmpty)
                        const Text(
                          'لم يُعثر على استخدام مباشر داخل الملفات. قد يكون الربط يتم تلقائيًا عبر سجل الأصول.',
                          style: TextStyle(color: Colors.white60, fontSize: 11),
                        )
                      else
                        ...refs.take(12).map(
                              (ref) => ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                leading: const Icon(
                                  Icons.code_rounded,
                                  size: 18,
                                ),
                                title: SelectableText(
                                  (ref['path'] ?? '').toString(),
                                  textDirection: TextDirection.ltr,
                                  style: const TextStyle(fontSize: 11),
                                ),
                              ),
                            ),
                      const Divider(height: 26),
                      Text(
                        'سجل النسخ (${commits.length})',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      if (commits.isEmpty)
                        const Padding(
                          padding: EdgeInsets.only(top: 6),
                          child: Text(
                            'لا يوجد سجل نسخ متاح لهذا الملف.',
                            style: TextStyle(color: Colors.white60),
                          ),
                        )
                      else
                        ...commits.take(8).toList().asMap().entries.map(
                              (entry) => ListTile(
                                dense: true,
                                contentPadding: EdgeInsets.zero,
                                leading: CircleAvatar(
                                  radius: 12,
                                  child: Text(
                                    '${entry.key + 1}',
                                    style: const TextStyle(fontSize: 9),
                                  ),
                                ),
                                title: Text(
                                  (entry.value['message'] ?? '').toString(),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(fontSize: 11),
                                ),
                                subtitle: Text(
                                  (entry.value['date'] ?? '').toString(),
                                  style: const TextStyle(fontSize: 9.5),
                                ),
                              ),
                            ),
                      const Divider(height: 20),
                      ExpansionTile(
                        tilePadding: EdgeInsets.zero,
                        title: const Text(
                          'تفاصيل متقدمة',
                          style: TextStyle(fontWeight: FontWeight.w800),
                        ),
                        children: [
                          if ((asset['contentSha'] ?? '').toString().isNotEmpty)
                            ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              title: const Text('بصمة النسخة الحالية'),
                              subtitle: SelectableText(
                                (asset['contentSha'] ?? '').toString(),
                                textDirection: TextDirection.ltr,
                                style: const TextStyle(fontSize: 9.5),
                              ),
                            ),
                          if (commits.length >= 2)
                            ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              title: const Text('النسخة السابقة في سجل الملفات'),
                              subtitle: SelectableText(
                                (commits[1]['sha'] ?? '').toString(),
                                textDirection: TextDirection.ltr,
                                style: const TextStyle(fontSize: 9.5),
                              ),
                            ),
                        ],
                      ),
                      const Divider(height: 26),
                      Text(
                        'سجل التعديلات (${audit.length})',
                        style: const TextStyle(fontWeight: FontWeight.w900),
                      ),
                      ...audit.take(8).map(
                            (item) => ListTile(
                              dense: true,
                              contentPadding: EdgeInsets.zero,
                              leading: const Icon(
                                Icons.receipt_long_outlined,
                                size: 18,
                              ),
                              title: Text(
                                (item['reason'] ?? item['action'] ?? '')
                                    .toString(),
                                style: const TextStyle(fontSize: 11),
                              ),
                              subtitle: Text(
                                '${item['createdAt'] ?? ''} • ${item['actorUid'] ?? ''}',
                                style: const TextStyle(fontSize: 9.5),
                              ),
                            ),
                          ),
                    ],
                  ),
                ),
        ),
        actions: [
          if (commits.length >= 2)
            OutlinedButton.icon(
              onPressed: _busy
                  ? null
                  : () => _rollbackPreviousVersion(asset, dialogContext),
              icon: const Icon(Icons.history_rounded),
              label: const Text('استرجاع النسخة السابقة'),
            ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إغلاق'),
          ),
        ],
      ),
    );
  }

  Future<void> _showPreparedPreview() async {
    if (_bytes == null) {
      if (_editingAsset != null) {
        await _showAssetPreview(_editingAsset!);
      } else if (mounted) {
        setState(() => _message = 'اختر صورة أولًا لعرض المعاينة.');
      }
      return;
    }
    final template = _selectedTemplate;
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('معاينة قبل النشر'),
        content: SizedBox(
          width: 430,
          child: SingleChildScrollView(
            child: Column(
              children: [
                _contextPreview(
                  '',
                  memoryBytes: _bytes,
                  assetType: template?.type,
                ),
                const SizedBox(height: 10),
                Text(
                  '${template?.labelAr ?? template?.type ?? 'أصل'} • '
                  '${_preparedWidth ?? '—'}×${_preparedHeight ?? '—'}',
                  style: const TextStyle(
                    color: Colors.white60,
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext),
            child: const Text('إغلاق'),
          ),
        ],
      ),
    );
  }

  Future<void> _showSmartPresetPicker() async {
    if (_assets.isEmpty) {
      await _loadAssets();
    }
    if (!mounted) return;
    if (_assets.isEmpty) {
      setState(() => _message = 'سجل الأصول فارغ حاليًا.');
      return;
    }

    var query = '';
    final seed = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF100B17),
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setSheetState) {
          final items = _assets.where((asset) {
            if (query.isEmpty) return true;
            final source = _assetSource(asset);
            final haystack = <String>[
              (asset['assetKey'] ?? '').toString(),
              (source['fileName'] ?? asset['fileName'] ?? '').toString(),
              (source['fullPath'] ?? asset['fullPath'] ?? '').toString(),
            ].join(' ').toLowerCase();
            return haystack.contains(query);
          }).take(60).toList(growable: false);

          return SafeArea(
            child: FractionallySizedBox(
              heightFactor: .82,
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  children: [
                    const Text(
                      'اختر مجموعة من السجل الرسمي',
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'اختر أي أصل من المجموعة، وبعدها يعرض الاستديو كل عناصر الدفعة الرسمية.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white60,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      autofocus: true,
                      onChanged: (value) => setSheetState(
                        () => query = value.trim().toLowerCase(),
                      ),
                      decoration: const InputDecoration(
                        hintText: 'مفتاح الأصل / اسم الملف / المسار',
                        prefixIcon: Icon(Icons.search_rounded),
                        border: OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Expanded(
                      child: ListView.builder(
                        itemCount: items.length,
                        itemBuilder: (_, index) {
                          final asset = items[index];
                          final source = _assetSource(asset);
                          return ListTile(
                            leading: _assetThumbnail(asset, size: 44),
                            title: Text(
                              (asset['assetKey'] ?? '').toString(),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              textDirection: TextDirection.ltr,
                            ),
                            subtitle: Text(
                              (source['fileName'] ?? asset['fileName'] ?? '')
                                  .toString(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              textDirection: TextDirection.ltr,
                            ),
                            onTap: () => Navigator.pop(sheetContext, asset),
                          );
                        },
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
    if (seed == null || !mounted) return;

    setState(() {
      _busy = true;
      _message = 'جارٍ قراءة سجل الدفعة الرسمي...';
    });

    Map<String, dynamic> manifest;
    try {
      manifest = await _loadManifestForAsset(seed);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _message = 'تعذر قراءة سجل الدفعة: $e';
        });
      }
      return;
    }
    if (!mounted) return;
    setState(() => _busy = false);

    final specs = manifest['assets'] is List
        ? (manifest['assets'] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList(growable: false)
        : <Map<String, dynamic>>[];

    Map<String, dynamic>? selectedSpec;
    if (specs.length <= 1) {
      selectedSpec = specs.isEmpty
          ? <String, dynamic>{
              'assetKey': seed['assetKey'],
              'fullPath': seed['fullPath'],
            }
          : specs.first;
    } else {
      selectedSpec =
          await showModalBottomSheet<Map<String, dynamic>>(
        context: context,
        isScrollControlled: true,
        backgroundColor: const Color(0xFF100B17),
        builder: (sheetContext) => SafeArea(
          child: FractionallySizedBox(
            heightFactor: .82,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'عناصر الدفعة ${manifest['batch'] ?? ''}',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  if ((manifest['metric'] ?? '').toString().isNotEmpty)
                    Text(
                      '${manifest['metric']} '
                      '${manifest['tier'] ?? ''}',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white60,
                        fontSize: 11,
                      ),
                    ),
                  const SizedBox(height: 10),
                  Expanded(
                    child: ListView.builder(
                      itemCount: specs.length,
                      itemBuilder: (_, index) {
                        final spec = specs[index];
                        final published = spec['published'] == true;
                        final hasDraft = spec['hasDraft'] == true;
                        final width = spec['width'];
                        final height = spec['height'];
                        final statusLabel = hasDraft
                            ? 'مسودة'
                            : published
                                ? 'منشور'
                                : 'غير مكتمل';
                        return ListTile(
                          leading: Icon(
                            published && !hasDraft
                                ? Icons.check_circle_rounded
                                : hasDraft
                                    ? Icons.edit_note_rounded
                                    : Icons.radio_button_unchecked_rounded,
                            color: published && !hasDraft
                                ? Colors.greenAccent
                                : hasDraft
                                    ? Colors.amberAccent
                                    : Colors.white38,
                          ),
                          title: Text(
                            (spec['assetKey'] ?? '').toString(),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            textDirection: TextDirection.ltr,
                          ),
                          subtitle: Text(
                            [
                              if (width != null && height != null)
                                '$width×$height',
                              statusLabel,
                              (spec['fileName'] ?? '').toString(),
                            ].where((e) => e.toString().trim().isNotEmpty).join(
                                  ' • ',
                                ),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          onTap: () =>
                              Navigator.pop(sheetContext, spec),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    if (selectedSpec == null || !mounted) return;
    final key = (selectedSpec['assetKey'] ?? '').toString().trim();
    if (key.isEmpty) return;

    setState(() {
      _busy = true;
      _message = 'جارٍ تعبئة معلومات الأصل...';
    });
    try {
      final selectedAsset = await _fetchAssetByKey(key);
      if (!mounted) return;
      if (selectedAsset == null) {
        setState(() {
          _message =
              'هذا العنصر موجود في سجل الدفعة لكنه غير مسجل بالكامل بعد. '
              'يجب تسجيله أولًا حتى لا نخمن معلومات الربط.';
        });
        return;
      }

      _beginEditAsset(selectedAsset);
      final width = selectedSpec['width'];
      final height = selectedSpec['height'];
      final template = _selectedTemplate;
      final officialPrompt =
          (selectedSpec['templatePrompt'] ?? template?.prompt ?? '')
              .toString()
              .trim();
      setState(() {
        _activeManifest = manifest;
        _message = [
          'تمت تعبئة المعلومات من سجل الدفعة الرسمي.',
          if (width != null && height != null)
            'المقاس المطلوب: $width×$height.',
          if (officialPrompt.isNotEmpty)
            'الوصف الجاهز موجود داخل مواصفات القالب.',
        ].join(' ');
      });
    } catch (e) {
      if (mounted) {
        setState(() => _message = 'تعذر فتح الأصل الجاهز: $e');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Widget _buildStickyStudioActions() {
    return Material(
      color: const Color(0xFF100B17),
      elevation: 12,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 10),
          child: Row(
            children: [
              IconButton.filledTonal(
                tooltip: 'معاينة',
                onPressed: _busy ? null : _showPreparedPreview,
                icon: const Icon(Icons.visibility_outlined),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : () => _upload(publish: false),
                  icon: const Icon(Icons.save_outlined),
                  label: const Text('حفظ مسودة'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : () => _upload(publish: true),
                  icon: _busy
                      ? const SizedBox(
                          width: 17,
                          height: 17,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.publish_outlined),
                  label: Text(_busy ? 'جارٍ...' : 'نشر'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _openLastSuccessAsset() async {
    final key = (_lastSuccess?['assetKey'] ?? '').toString().trim();
    if (key.isEmpty || _busy) return;
    setState(() => _busy = true);
    try {
      final asset = await _fetchAssetByKey(key);
      if (!mounted) return;
      if (asset == null) {
        setState(() => _message = 'تعذر فتح الأصل المنشور حاليًا.');
        return;
      }
      await _showAssetPreview(asset);
    } catch (e) {
      if (mounted) {
        setState(() => _message = 'تعذر فتح الأصل: $e');
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirmPublishImpact() async {
    if (!_isEditing) return true;
    final template = _selectedTemplate;
    var directUsageCount = 0;
    var usageTruncated = false;

    try {
      final key = _assetKey.text.trim();
      if (key.isNotEmpty) {
        final body = await _loadAssetInsight(key, 'usage');
        final usage = body['usage'] is Map
            ? Map<String, dynamic>.from(body['usage'] as Map)
            : <String, dynamic>{};
        directUsageCount =
            (usage['totalReferences'] as num?)?.toInt() ?? 0;
        usageTruncated = usage['truncated'] == true;
      }
    } catch (_) {
      // The impact lookup is advisory. Explicit approval is still required.
    }

    if (!mounted) return false;
    final channelsText = _selectedChannels.isEmpty
        ? 'غير محدد'
        : _selectedChannels.map(_channelLabel).join(' • ');
    final usageText = directUsageCount == 0
        ? 'لم يظهر استخدام مباشر داخل الملفات، وقد يكون الربط تلقائيًا.'
        : 'يعتمد عليه $directUsageCount مكان مباشر'
            '${usageTruncated ? ' أو أكثر' : ''}.';
    final currentUrl = _assetLiveUrl(_editingAsset);
    final hasNewPreview = _bytes != null;

    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: const Text('تأكيد استبدال الأصل الحالي'),
            content: SizedBox(
              width: 520,
              child: SingleChildScrollView(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Text(
                      'سيتم استبدال الأصل نفسه بدون تغيير الربط.',
                      style: TextStyle(fontWeight: FontWeight.w900),
                    ),
                    const SizedBox(height: 10),
                    if (currentUrl.isNotEmpty || hasNewPreview) ...[
                      Row(
                        children: [
                          Expanded(
                            child: Column(
                              children: [
                                const Text(
                                  'الحالي',
                                  style: TextStyle(
                                    color: Colors.white60,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Container(
                                  height: 135,
                                  decoration: BoxDecoration(
                                    color: Colors.black26,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  padding: const EdgeInsets.all(8),
                                  child: currentUrl.isEmpty
                                      ? const Center(
                                          child: Text('لا توجد معاينة'),
                                        )
                                      : Image.network(
                                          currentUrl,
                                          fit: BoxFit.contain,
                                          gaplessPlayback: true,
                                          errorBuilder: (_, __, ___) =>
                                              const Icon(
                                            Icons.broken_image_outlined,
                                            color: Colors.orangeAccent,
                                          ),
                                        ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              children: [
                                const Text(
                                  'الجديد',
                                  style: TextStyle(
                                    color: Colors.greenAccent,
                                    fontWeight: FontWeight.w800,
                                    fontSize: 11,
                                  ),
                                ),
                                const SizedBox(height: 5),
                                Container(
                                  height: 135,
                                  decoration: BoxDecoration(
                                    color: Colors.black26,
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                  padding: const EdgeInsets.all(8),
                                  child: _bytes == null
                                      ? const Center(
                                          child: Text('لا توجد معاينة'),
                                        )
                                      : Image.memory(
                                          _bytes!,
                                          fit: BoxFit.contain,
                                        ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                    ],
                    Text(
                      'مفتاح الأصل: ${_assetKey.text.trim()}',
                      textDirection: TextDirection.rtl,
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'النوع: ${template?.labelAr ?? template?.type ?? 'غير محدد'}',
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'أماكن الاستخدام المحددة: ${_selectedChannels.length}',
                    ),
                    if (_selectedChannels.isNotEmpty)
                      Text(
                        channelsText,
                        style: const TextStyle(
                          color: Colors.white60,
                          fontSize: 11,
                        ),
                      ),
                    const SizedBox(height: 4),
                    Text(usageText),
                    const SizedBox(height: 10),
                    const Text(
                      'بعد النشر، كل مكان يستخدم هذا الأصل سيظهر فيه التصميم الجديد بعد تحديث النسخة المحفوظة.',
                      style: TextStyle(
                        color: Colors.orangeAccent,
                        fontSize: 11,
                      ),
                    ),
                  ],
                ),
              ),
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
    String expectedSha, {
    int attempts = 3,
  }) async {
    final boundedAttempts = attempts.clamp(1, 3);
    for (var attempt = 1; attempt <= boundedAttempts; attempt++) {
      try {
        final uri = _endpoint.replace(
          queryParameters: {'assetKey': assetKey},
        );
        final response = await http.get(
          uri,
          headers: {'authorization': 'Bearer ${await _token()}'},
        );
        final decoded = response.body.isEmpty
            ? <String, dynamic>{}
            : jsonDecode(response.body);
        final body = decoded is Map<String, dynamic>
            ? decoded
            : <String, dynamic>{};
        final asset = body['asset'] is Map
            ? Map<String, dynamic>.from(body['asset'] as Map)
            : <String, dynamic>{};

        final registryMatches = response.statusCode >= 200 &&
            response.statusCode < 300 &&
            body['ok'] == true &&
            asset['published'] == true &&
            (asset['contentSha'] ?? '').toString() == expectedSha;

        if (registryMatches) {
          final rawUrl = (asset['rawUrl'] ?? '').toString().trim();
          if (rawUrl.isNotEmpty) {
            final separator = rawUrl.contains('?') ? '&' : '?';
            final liveResponse = await http.get(
              Uri.parse(
                '$rawUrl${separator}verify='
                '${DateTime.now().microsecondsSinceEpoch}',
              ),
              headers: const {'cache-control': 'no-cache'},
            );
            final verified = liveResponse.statusCode >= 200 &&
                liveResponse.statusCode < 300 &&
                liveResponse.bodyBytes.isNotEmpty;
            if (verified) {
              unawaited(_loadAssets());
              return true;
            }
          }
        }
      } catch (_) {
        // The new file can need a brief moment before it becomes reachable.
      }

      if (attempt < boundedAttempts) {
        await Future<void>.delayed(
          Duration(milliseconds: 650 * attempt),
        );
      }
    }
    return false;
  }

  Future<void> _reverifyLastSuccess() async {
    final success = _lastSuccess;
    if (success == null ||
        success['status'] != 'published' ||
        _busy) {
      return;
    }

    final assetKey = (success['assetKey'] ?? '').toString().trim();
    final contentSha = (success['contentSha'] ?? '').toString().trim();
    if (assetKey.isEmpty || contentSha.isEmpty) return;

    setState(() {
      _busy = true;
      _message = null;
    });

    try {
      final verified = await _verifyPublishedAsset(
        assetKey,
        contentSha,
        attempts: 3,
      );
      if (!mounted) return;
      setState(() {
        _lastSuccess = {
          ...success,
          'verified': verified,
        };
        _message = null;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _validatePreparedMedia() {
    if (_bytes == null || _mimeType == null) return 'اختر صورة أولًا.';
    final template = _selectedTemplate;
    if (template == null) return 'اختر قالبًا أولًا.';

    final extension = _extensionOf(_fileName.text);
    if (!template.allowsExtension(extension)) {
      return 'صيغة الملف لا تطابق القالب المختار.';
    }
    if (_bytes!.length > template.maxBytes) {
      return 'حجم الملف أكبر من الحد المسموح.';
    }

    final width = _preparedWidth;
    final height = _preparedHeight;
    if (width != null &&
        height != null &&
        !template.dimensionsMatch(width, height)) {
      return 'المقاس لا يطابق المطلوب: ${template.dimensionsLabel}.';
    }
    if (template.transparency == 'required' && _preparedHasAlpha != true) {
      return 'الخلفية يجب أن تكون شفافة فعلًا.';
    }
    if (template.transparency == 'forbidden' && _preparedHasAlpha == true) {
      return 'هذا الأصل يجب أن يكون بدون شفافية.';
    }
    if (template.motion == 'static' && _preparedAnimated) {
      return 'هذا الأصل يجب أن يكون ثابتًا.';
    }
    if (template.motion == 'animated' && !_preparedAnimated) {
      return 'هذا الأصل يجب أن يكون متحركًا.';
    }
    return null;
  }

  String? _validate() {
    if (_bytes == null || _mimeType == null) return 'اختر صورة أولاً.';
    final template = _selectedTemplate;
    if (template == null) return 'اختر قالبًا من الاستديو أولًا.';
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
      return 'المسار لا يطابق القالب المختار.';
    }
    final mediaError = _validatePreparedMedia();
    if (mediaError != null) return mediaError;
    if (_reason.text.trim().length < 3) {
      return 'اكتب سببًا مختصرًا للتغيير.';
    }
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
    if (publish && !await _confirmPublishImpact()) {
      if (mounted) setState(() => _busy = false);
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
        'idempotencyKey': _operationId ??=
            'asset_${DateTime.now().microsecondsSinceEpoch}',
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
        final assetKey = (body['assetKey'] ?? canonicalAssetKey).toString();
        final contentSha = (body['contentSha'] ?? '').toString();
        var verified = false;
        if (status == 'published' && contentSha.isNotEmpty) {
          if (mounted) {
            setState(() => _message = 'تم النشر، جارٍ التحقق من النسخة الحية...');
          }
          verified = await _verifyPublishedAsset(assetKey, contentSha);
        } else {
          await _loadAssets();
        }
        if (!mounted) return;
        setState(() {
          _hasUnsavedChanges = false;
          _lastFailedPublishIntent = null;
          _operationId = null;
          _lastSuccess = {
            'assetKey': assetKey,
            'fullPath': path,
            'status': status,
            'verified': verified,
            'replaced': replaced,
            'rawUrl': body['rawUrl'],
            'contentSha': contentSha,
          };
          _message = null;
          _recordRecent(assetKey);
        });
      } else {
        final code = '${body['code'] ?? 'http_${response.statusCode}'}';
        setState(() {
          _lastFailedPublishIntent = publish;
          _message = switch (code) {
          'recent_auth_required' => 'يلزم تسجيل الدخول من جديد قبل رفع الأصول.',
          'forbidden' => 'هذه الصفحة والإجراء متاحان لحساب المالك فقط.',
          'github_not_configured' => 'إعداد خدمة رفع الملفات غير مكتمل بعد.',
          'invalid_request' => 'تحقق من المسار والاسم والحجم ونوع الملف.',
          'invalid_asset_template' => 'نوع الأصل والقالب غير متطابقين.',
          'invalid_asset_channels' => 'اختر قناة استخدام واحدة على الأقل.',
          'template_directory_mismatch' => 'المسار لا يطابق القالب المختار.',
          'template_extension_mismatch' => 'صيغة الملف لا تطابق القالب المختار.',
          'template_size_mismatch' => 'حجم الملف لا يطابق القالب المختار.',
          'r2_not_configured' => 'تخزين R2 الخاص بالمسودات غير متاح حاليًا.',
          _ => 'تعذر رفع الصورة: $code',
          };
        });
      }
    } catch (e) {
      setState(() {
        _lastFailedPublishIntent = publish;
        _message = 'تعذر رفع الصورة: $e';
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _assetTypeLabel(String type) => switch (type) {
        'frame' => 'إطار صورة',
        'profile_background' => 'خلفية الملف الشخصي',
        'chat_bubble' => 'فقاعة محادثة',
        'room_background' => 'خلفية غرفة',
        'entrance' => 'دخولية',
        'audio_wave' => 'موجة صوت',
        'badge' => 'شارة',
        'name_effect' => 'تأثير الاسم',
        'mic_effect' => 'تأثير المايك',
        'sticker_pack' => 'حزمة ملصقات',
        'profile_card' => 'بطاقة ملف شخصي',
        'event_cosmetic' => 'زينة فعالية',
        'agency_cosmetic' => 'زينة وكالة',
        'vip_cosmetic' => 'زينة VIP',
        'auth_screen' => 'صورة شاشة الدخول',
        'system_cosmetic' => 'زينة رسمية',
        _ => type,
      };

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
              : 'نشر أصل من استديو الأصول',
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
              'asset_not_found' => 'المسودة غير موجودة في سجل الأصول.',
              'asset_draft_not_found' => 'لا توجد مسودة جاهزة للنشر.',
              'asset_draft_missing' => 'ملف المسودة غير موجود في R2.',
              'asset_draft_invalid' => 'ملف المسودة غير صالح.',
              'asset_draft_mismatch' => 'ملف المسودة لا يطابق النسخة المسجلة.',
              'recent_auth_required' =>
                'يلزم تسجيل الدخول من جديد قبل نشر الأصول.',
              'forbidden' => 'النشر متاح لحساب المالك فقط.',
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
                'الحد: ${(template.maxBytes / 1000000).toStringAsFixed(1)} ميغابايت'),
            const SizedBox(height: 10),
            const Text(
              'الوصف الجاهز',
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

  List<Map<String, dynamic>> get _filteredAssets {
    final query = _debouncedSearch;
    return _assets.where((asset) {
      final published = asset['published'] == true;
      final hasDraft = asset['hasDraft'] == true;
      final status = (asset['status'] ?? '').toString().toLowerCase();
      final matchesStatus = switch (_assetFilter) {
        'published' => published,
        'draft' => hasDraft,
        'review' => status.contains('review') || status.contains('pending'),
        _ => true,
      };
      if (!matchesStatus) return false;

      final source = _assetSource(asset);
      final type = _effectiveAssetType(asset);
      if (_assetTypeFilter != 'all' && type != _assetTypeFilter) {
        return false;
      }

      final rawChannels = source['channels'] ?? asset['channels'];
      final channels = rawChannels is List
          ? rawChannels.map((e) => e.toString()).toSet()
          : <String>{};
      if (_assetChannelFilter != 'all' &&
          !channels.contains(_assetChannelFilter)) {
        return false;
      }

      if (query.isEmpty) return true;
      final haystack = <String>[
        (asset['assetKey'] ?? '').toString(),
        (source['fullPath'] ?? asset['fullPath'] ?? '').toString(),
        (source['fileName'] ?? asset['fileName'] ?? '').toString(),
        type,
        (source['templateId'] ?? asset['templateId'] ?? '').toString(),
        channels.join(' '),
      ].join(' ').toLowerCase();
      return haystack.contains(query);
    }).toList(growable: false);
  }

  List<Map<String, dynamic>> get _visibleAssets =>
      _filteredAssets.take(_visibleLimit).toList(growable: false);

  List<String> get _availableAssetTypes {
    final result = <String>{
      ..._templates.map((template) => template.type.trim()),
    }..removeWhere((type) => type.isEmpty);
    for (final asset in _assets) {
      final type = _effectiveAssetType(asset);
      if (type.isNotEmpty) result.add(type);
    }
    final list = result.toList()..sort();
    return list;
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
              Expanded(
                child: Text(
                  _isEditing ? 'تعديل أصل موجود' : 'إضافة أصل جديد',
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              IconButton(
                tooltip: 'إغلاق النموذج',
                onPressed: _busy ? null : _closeStudioForm,
                icon: const Icon(Icons.close_rounded),
              ),
            ],
          ),
          Text(
            _isEditing
                ? 'البيانات الأساسية مأخوذة من الأصل المنشور. اختر الصورة الجديدة واكتب سبب التغيير.'
                : 'اختر القالب، ارفع الصورة، ثم راجع البيانات قبل الحفظ أو النشر.',
            style: const TextStyle(color: Colors.white60, height: 1.45),
          ),
          if (_isEditing) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(11),
              decoration: BoxDecoration(
                color: Colors.greenAccent.withValues(alpha: .07),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.greenAccent.withValues(alpha: .20),
                ),
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.swap_horiz_rounded,
                    color: Colors.greenAccent,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      'استبدال نفس الأصل • نفس المفتاح والمسار واسم الملف',
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        fontSize: 11.5,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
          if (_isEditing) ...[
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _batchBusy || _busy || _editingAsset == null
                        ? null
                        : () => _runBatchUpload(_editingAsset!),
                    icon: _batchBusy
                        ? const SizedBox(
                            width: 17,
                            height: 17,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.collections_outlined),
                    label: const Text('رفع مجموعة من نفس الدفعة'),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _openNextManifestAsset,
                    icon: const Icon(Icons.skip_next_rounded),
                    label: const Text('الأصل التالي'),
                  ),
                ),
              ],
            ),
          ],
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
            onChanged: _busy || (_isEditing && !_unlockIdentityFields)
                ? null
                : (value) {
                    if (value == null) return;
                    final selected =
                        _templates.where((item) => item.id == value).toList();
                    if (selected.isEmpty) return;
                    setState(() {
                      _applyTemplate(selected.first);
                      _message = null;
                      _hasUnsavedChanges = true;
                      _lastSuccess = null;
                      _operationId = null;
                    });
                  },
          ),
          if (template != null ||
              _favoriteTemplateIds.isNotEmpty ||
              _recentTemplateIds.isNotEmpty) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                if (template != null)
                  IconButton(
                    tooltip: _favoriteTemplateIds.contains(template.id)
                        ? 'إزالة القالب من المفضلة'
                        : 'إضافة القالب إلى المفضلة',
                    onPressed: _busy
                        ? null
                        : () => _toggleFavoriteTemplate(template.id),
                    icon: Icon(
                      _favoriteTemplateIds.contains(template.id)
                          ? Icons.star_rounded
                          : Icons.star_border_rounded,
                      color: _favoriteTemplateIds.contains(template.id)
                          ? const Color(0xFFFFD54A)
                          : Colors.white38,
                    ),
                  ),
                Expanded(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        ..._favoriteTemplateIds.take(4).map((id) {
                          final item = _templateById(id);
                          if (item == null) return const SizedBox.shrink();
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: ActionChip(
                              avatar: const Icon(
                                Icons.star_rounded,
                                size: 15,
                                color: Color(0xFFFFD54A),
                              ),
                              label: Text(item.labelAr),
                              onPressed: _busy
                                  ? null
                                  : () => setState(() {
                                        _applyTemplate(item);
                                        _message = null;
                                      }),
                            ),
                          );
                        }),
                        ..._recentTemplateIds
                            .where((id) => !_favoriteTemplateIds.contains(id))
                            .take(3)
                            .map((id) {
                          final item = _templateById(id);
                          if (item == null) return const SizedBox.shrink();
                          return Padding(
                            padding: const EdgeInsets.only(left: 6),
                            child: ActionChip(
                              avatar: const Icon(
                                Icons.history_rounded,
                                size: 15,
                              ),
                              label: Text(item.labelAr),
                              onPressed: _busy
                                  ? null
                                  : () => setState(() {
                                        _applyTemplate(item);
                                        _message = null;
                                      }),
                            ),
                          );
                        }),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ],
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
                                  ' ميغابايت',
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

          if (_bytes != null &&
              _preparedWidth != null &&
              _preparedHeight != null) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              alignment: WrapAlignment.center,
              children: [
                Chip(
                  avatar: const Icon(Icons.aspect_ratio_rounded, size: 16),
                  label: Text('${_preparedWidth}×${_preparedHeight}'),
                ),
                Chip(
                  avatar: const Icon(Icons.crop_rounded, size: 16),
                  label: Text(
                    'التناسب: ${_aspectRatioLabel(_preparedWidth, _preparedHeight)}',
                  ),
                ),
                Chip(
                  avatar: const Icon(Icons.data_object_rounded, size: 16),
                  label: Text(
                    _mimeType?.split('/').last.toUpperCase() ?? '—',
                  ),
                ),
                Chip(
                  avatar: Icon(
                    _preparedAnimated
                        ? Icons.animation_rounded
                        : Icons.image_outlined,
                    size: 16,
                  ),
                  label: Text(_preparedAnimated ? 'متحرك' : 'ثابت'),
                ),
                Chip(
                  avatar: const Icon(Icons.photo_library_outlined, size: 16),
                  label: Text(
                    _preparedFrameCount == null
                        ? 'الإطارات: —'
                        : 'الإطارات: $_preparedFrameCount',
                  ),
                ),
                Chip(
                  avatar: Icon(
                    _preparedHasAlpha == true
                        ? Icons.layers_outlined
                        : Icons.crop_square_rounded,
                    size: 16,
                  ),
                  label: Text(
                    _preparedHasAlpha == true
                        ? 'خلفية شفافة'
                        : 'بدون شفافية',
                  ),
                ),
                Chip(
                  avatar: const Icon(Icons.sd_storage_outlined, size: 16),
                  label: Text(
                    '${(_bytes!.length / 1024).toStringAsFixed(1)} كيلوبايت',
                  ),
                ),
                Chip(
                  avatar: Icon(
                    _validatePreparedMedia() == null
                        ? Icons.check_circle_rounded
                        : Icons.error_outline_rounded,
                    size: 16,
                    color: _validatePreparedMedia() == null
                        ? Colors.greenAccent
                        : Colors.orangeAccent,
                  ),
                  label: Text(
                    _validatePreparedMedia() == null
                        ? 'جاهز'
                        : 'يحتاج تعديل',
                  ),
                ),
              ],
            ),
          ],
          if (_bytes != null) ...[
            const SizedBox(height: 12),
            if (_isEditing && _assetLiveUrl(_editingAsset).isNotEmpty)
              Row(
                children: [
                  Expanded(
                    child: Column(
                      children: [
                        const Text(
                          'الحالي',
                          style: TextStyle(
                            color: Colors.white60,
                            fontWeight: FontWeight.w800,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(height: 5),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(15),
                          child: Container(
                            height: 150,
                            color: Colors.black26,
                            padding: const EdgeInsets.all(8),
                            child: Image.network(
                              _assetLiveUrl(_editingAsset),
                              fit: BoxFit.contain,
                              gaplessPlayback: true,
                              errorBuilder: (_, __, ___) => const Icon(
                                Icons.broken_image_outlined,
                                color: Colors.orangeAccent,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      children: [
                        const Text(
                          'الجديد',
                          style: TextStyle(
                            color: Colors.greenAccent,
                            fontWeight: FontWeight.w800,
                            fontSize: 11,
                          ),
                        ),
                        const SizedBox(height: 5),
                        ClipRRect(
                          borderRadius: BorderRadius.circular(15),
                          child: Container(
                            height: 150,
                            color: Colors.black26,
                            padding: const EdgeInsets.all(8),
                            child: Image.memory(_bytes!, fit: BoxFit.contain),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              )
            else
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
          Row(
            children: [
              const Expanded(
                child: Text(
                  'معلومات الأصل',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
                ),
              ),
              if (_isEditing)
                TextButton.icon(
                  onPressed:
                      _busy || _unlockIdentityFields ? null : _unlockIdentity,
                  icon: Icon(
                    _unlockIdentityFields
                        ? Icons.lock_open_rounded
                        : Icons.lock_rounded,
                    size: 18,
                  ),
                  label: Text(
                    _unlockIdentityFields ? 'الحقول مفتوحة' : 'فتح الحقول',
                  ),
                ),
            ],
          ),
          if (_isEditing && !_unlockIdentityFields)
            const Padding(
              padding: EdgeInsets.only(bottom: 10),
              child: Text(
                'مفتاح الأصل والمسار واسم الملف مقفلة للحماية من كسر الربط.',
                style: TextStyle(color: Colors.white54, fontSize: 10.5),
              ),
            ),
          TextField(
            controller: _directory,
            enabled: !_busy,
            readOnly: _isEditing && !_unlockIdentityFields,
            minLines: 1,
            maxLines: 2,
            textDirection: TextDirection.ltr,
            onTap: () => _selectAll(_directory),
            onChanged: (_) {
              _syncGiftFileNameFromAssetKey();
              _markDirty();
            },
            decoration: InputDecoration(
              labelText: 'المسار داخل المشروع *',
              prefixIcon: const Icon(Icons.folder_outlined),
              suffixIcon: IconButton(
                tooltip: 'نسخ المسار',
                onPressed: () => _copyText(_directory.text, 'المسار'),
                icon: const Icon(Icons.copy_rounded),
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _fileName,
            enabled: !_busy,
            readOnly: _isEditing && !_unlockIdentityFields,
            minLines: 1,
            maxLines: 2,
            textDirection: TextDirection.ltr,
            onTap: () => _selectAll(_fileName),
            onChanged: (_) => _markDirty(),
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
            decoration: InputDecoration(
              labelText: 'اسم الملف *',
              prefixIcon: const Icon(Icons.insert_drive_file_outlined),
              suffixIcon: IconButton(
                tooltip: 'نسخ اسم الملف',
                onPressed: () => _copyText(_fileName.text, 'اسم الملف'),
                icon: const Icon(Icons.copy_rounded),
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _assetKey,
            enabled: !_busy,
            readOnly: _isEditing && !_unlockIdentityFields,
            minLines: 1,
            maxLines: 2,
            textDirection: TextDirection.ltr,
            onTap: () => _selectAll(_assetKey),
            onChanged: (_) {
              _syncGiftFileNameFromAssetKey();
              _markDirty();
            },
            decoration: InputDecoration(
              labelText: 'مفتاح الأصل *',
              prefixIcon: const Icon(Icons.link_rounded),
              suffixIcon: IconButton(
                tooltip: 'نسخ مفتاح الأصل',
                onPressed: () => _copyText(_assetKey.text, 'مفتاح الأصل'),
                icon: const Icon(Icons.copy_rounded),
              ),
              border: const OutlineInputBorder(),
            ),
          ),
          const SizedBox(height: 12),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text(
              'خيارات إضافية',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: Text(
              '${_mode == 'remote' ? 'من الخادم' : 'داخل التطبيق'} • '
              '${_selectedChannels.map(_channelLabel).join(' • ')}',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 11.5),
            ),
            children: [
              const Align(
                alignment: Alignment.centerRight,
                child: Text(
                  'مكان حفظ الأصل',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 7),
              Row(
                children: [
                  Expanded(
                    child: ChoiceChip(
                      selected: _mode == 'remote',
                      label: const SizedBox(
                        width: double.infinity,
                        child: Text(
                          'من الخادم\nمع حفظ مؤقت',
                          textAlign: TextAlign.center,
                        ),
                      ),
                      onSelected: _busy ||
                              (_isEditing && !_unlockIdentityFields)
                          ? null
                          : (_) => setState(() {
                                _mode = 'remote';
                                _hasUnsavedChanges = true;
                                _lastSuccess = null;
                                _operationId = null;
                              }),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: ChoiceChip(
                      selected: _mode == 'bundled',
                      label: const SizedBox(
                        width: double.infinity,
                        child: Text(
                          'داخل التطبيق\nمع نسخة التطبيق',
                          textAlign: TextAlign.center,
                        ),
                      ),
                      onSelected: _busy ||
                              (_isEditing && !_unlockIdentityFields)
                          ? null
                          : (_) => setState(() {
                                _mode = 'bundled';
                                _hasUnsavedChanges = true;
                                _lastSuccess = null;
                                _operationId = null;
                              }),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Align(
                alignment: Alignment.centerRight,
                child: Text(
                  'أماكن استخدام الأصل',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 12,
                  ),
                ),
              ),
              const SizedBox(height: 7),
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
                          onSelected: _busy ||
                                  (_isEditing && !_unlockIdentityFields)
                              ? null
                              : (selected) {
                                  setState(() {
                                    if (selected) {
                                      _selectedChannels.add(channel);
                                    } else {
                                      _selectedChannels.remove(channel);
                                    }
                                    _hasUnsavedChanges = true;
                                    _lastSuccess = null;
                                    _operationId = null;
                                  });
                                },
                        ),
                      )
                      .toList(growable: false),
                ),
              ),
              const SizedBox(height: 8),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: _reason,
            enabled: !_busy,
            maxLength: 200,
            minLines: 1,
            maxLines: 3,
            onTap: () => _selectAll(_reason),
            onChanged: (_) => _markDirty(),
            decoration: const InputDecoration(
              labelText: 'سبب التغيير *',
              hintText: 'مثال: تحديث التصميم أو تحسين الجودة',
              prefixIcon: Icon(Icons.edit_note_rounded),
              border: OutlineInputBorder(),
            ),
          ),
          if (_lastSuccess != null) ...[
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: (_lastSuccess!['status'] == 'published' &&
                            _lastSuccess!['verified'] != true)
                    ? Colors.amberAccent.withValues(alpha: .07)
                    : Colors.greenAccent.withValues(alpha: .07),
                borderRadius: BorderRadius.circular(13),
                border: Border.all(
                  color: (_lastSuccess!['status'] == 'published' &&
                              _lastSuccess!['verified'] != true)
                      ? Colors.amberAccent.withValues(alpha: .24)
                      : Colors.greenAccent.withValues(alpha: .22),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Icon(
                        _lastSuccess!['verified'] == true
                            ? Icons.verified_rounded
                            : Icons.cloud_done_outlined,
                        color: _lastSuccess!['verified'] == true
                            ? Colors.greenAccent
                            : Colors.amberAccent,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          _lastSuccess!['status'] == 'published'
                              ? (_lastSuccess!['verified'] == true
                                  ? 'تم النشر والتأكد ✅'
                                  : 'تم النشر • بانتظار التأكد')
                              : 'تم حفظ المسودة',
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'مفتاح الأصل',
                    style: TextStyle(
                      color: Colors.white60,
                      fontSize: 10.5,
                    ),
                  ),
                  const SizedBox(height: 3),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: SelectableText(
                      (_lastSuccess!['assetKey'] ?? '').toString(),
                      textDirection: TextDirection.ltr,
                      style: const TextStyle(fontSize: 11),
                    ),
                  ),
                  if (_lastSuccess!['status'] == 'published' &&
                      _lastSuccess!['verified'] != true) ...[
                    const SizedBox(height: 7),
                    const Text(
                      'النشر تم بنجاح. بقي التأكد من ظهور النسخة الجديدة من المصدر.',
                      style: TextStyle(
                        color: Colors.amberAccent,
                        fontSize: 10.5,
                      ),
                    ),
                  ],
                  const SizedBox(height: 4),
                  SelectableText(
                    (_lastSuccess!['fullPath'] ?? '').toString(),
                    textDirection: TextDirection.ltr,
                    style: const TextStyle(
                      color: Colors.white60,
                      fontSize: 10.5,
                    ),
                  ),
                  if (_lastSuccess!['status'] == 'published') ...[
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        OutlinedButton.icon(
                          onPressed: _busy ? null : _openLastSuccessAsset,
                          icon: const Icon(Icons.visibility_outlined),
                          label: const Text('فتح الأصل'),
                        ),
                        OutlinedButton.icon(
                          onPressed: () => _copyText(
                            (_lastSuccess!['assetKey'] ?? '').toString(),
                            'مفتاح الأصل',
                          ),
                          icon: const Icon(Icons.copy_rounded),
                          label: const Text('نسخ المفتاح'),
                        ),
                        if (_lastSuccess!['verified'] != true)
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _reverifyLastSuccess,
                            icon: const Icon(Icons.refresh_rounded),
                            label: const Text('إعادة التحقق'),
                          ),
                        if (_isEditing)
                          OutlinedButton.icon(
                            onPressed: _busy ? null : _openNextManifestAsset,
                            icon: const Icon(Icons.skip_next_rounded),
                            label: const Text('الأصل التالي'),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 10),
          ],
          if (_lastFailedPublishIntent != null) ...[
            Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy
                        ? null
                        : () => _upload(
                              publish: _lastFailedPublishIntent!,
                            ),
                    icon: const Icon(Icons.refresh_rounded),
                    label: const Text('إعادة المحاولة بنفس البيانات'),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
          ],
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
          const SizedBox(height: 4),
          const Text(
            'حفظ المسودة لا يغيّر النسخة الحية. التحديث الفعلي يتم عند النشر.',
            textAlign: TextAlign.center,
            style: TextStyle(color: Colors.white54, fontSize: 10.5),
          ),
        ],
      ),
    );
  }

  List<String> get _registryWarnings {
    final warnings = <String>[];
    final pathOwners = <String, List<String>>{};
    for (final asset in _assets) {
      final key = (asset['assetKey'] ?? '').toString().trim();
      final source = _assetSource(asset);
      final path =
          (source['fullPath'] ?? asset['fullPath'] ?? '').toString().trim();
      if (asset['published'] == true) {
        if (path.isEmpty) {
          warnings.add('$key منشور بدون مسار.');
        }
        if ((asset['rawUrl'] ?? '').toString().trim().isEmpty) {
          warnings.add('$key منشور لكن رابط النسخة الحالية غير متوفر.');
        }
      }
      if (path.isNotEmpty) {
        pathOwners.putIfAbsent(path, () => <String>[]).add(key);
      }
    }
    for (final entry in pathOwners.entries) {
      if (entry.value.length > 1) {
        warnings.add(
          'المسار ${entry.key} مستخدم بواسطة أكثر من مفتاح الأصل: '
          '${entry.value.join(', ')}',
        );
      }
    }
    return warnings.take(8).toList(growable: false);
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
    final fileName =
        (source['fileName'] ?? asset['fileName'] ?? '').toString();
    final status = _assetStatusLabel(asset);
    final favorite = _favoriteAssetKeys.contains(key);
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
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            onTap: published ? () => _showAssetPreview(asset) : null,
            borderRadius: BorderRadius.circular(12),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                _assetThumbnail(asset, size: 56),
                if (published)
                  const Positioned(
                    right: -4,
                    bottom: -4,
                    child: CircleAvatar(
                      radius: 9,
                      backgroundColor: Color(0xFF15101F),
                      child: Icon(
                        Icons.zoom_in_rounded,
                        size: 14,
                        color: Color(0xFFCDB7FF),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Tooltip(
                        message: key.isEmpty ? 'أصل بدون مفتاح' : key,
                        child: Text(
                          key.isEmpty ? 'أصل بدون مفتاح' : key,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          softWrap: false,
                          textDirection: TextDirection.ltr,
                          textAlign: TextAlign.right,
                          style: const TextStyle(
                            fontWeight: FontWeight.w900,
                            fontSize: 12.5,
                          ),
                        ),
                      ),
                    ),
                    IconButton(
                      visualDensity: VisualDensity.compact,
                      tooltip: favorite
                          ? 'إزالة من المفضلة'
                          : 'إضافة إلى المفضلة',
                      onPressed: () => setState(() {
                        if (favorite) {
                          _favoriteAssetKeys.remove(key);
                        } else {
                          _favoriteAssetKeys.add(key);
                        }
                      }),
                      icon: Icon(
                        favorite
                            ? Icons.star_rounded
                            : Icons.star_border_rounded,
                        color: favorite
                            ? const Color(0xFFFFD54A)
                            : Colors.white38,
                        size: 20,
                      ),
                    ),
                  ],
                ),
                if (fileName.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    fileName,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textDirection: TextDirection.ltr,
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      color: Colors.white70,
                      fontSize: 10.5,
                    ),
                  ),
                ],
                const SizedBox(height: 3),
                Text(
                  path,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  textDirection: TextDirection.ltr,
                  textAlign: TextAlign.right,
                  style: const TextStyle(
                    color: Colors.white54,
                    fontSize: 10.5,
                  ),
                ),
                const SizedBox(height: 7),
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 5,
                      ),
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
                    const Spacer(),
                    if (hasDraft)
                      TextButton.icon(
                        onPressed:
                            _busy ? null : () => _publishAsset(asset),
                        icon: const Icon(Icons.publish_outlined, size: 17),
                        label: const Text('نشر'),
                      ),
                    PopupMenuButton<String>(
                      tooltip: 'إجراءات الأصل',
                      onSelected: (value) {
                        switch (value) {
                          case 'preview':
                            _showAssetPreview(asset);
                            break;
                          case 'edit':
                            _beginEditAsset(asset);
                            break;
                          case 'clone':
                            _cloneAsset(asset);
                            break;
                          case 'insights':
                            _showAssetInsights(asset);
                            break;
                          case 'batch':
                            _runBatchUpload(asset);
                            break;
                          case 'copy':
                            _copyAssetMetadata(asset);
                            break;
                          case 'favorite':
                            setState(() {
                              if (_favoriteAssetKeys.contains(key)) {
                                _favoriteAssetKeys.remove(key);
                              } else {
                                _favoriteAssetKeys.add(key);
                              }
                            });
                            break;
                        }
                      },
                      itemBuilder: (_) => [
                        if (published)
                          const PopupMenuItem(
                            value: 'preview',
                            child: ListTile(
                              leading: Icon(Icons.visibility_outlined),
                              title: Text('معاينة الأصل'),
                            ),
                          ),
                        const PopupMenuItem(
                          value: 'edit',
                          child: ListTile(
                            leading: Icon(Icons.edit_outlined),
                            title: Text('تعديل هذا الأصل'),
                          ),
                        ),
                        const PopupMenuItem(
                          value: 'clone',
                          child: ListTile(
                            leading: Icon(Icons.copy_all_rounded),
                            title: Text('نسخ كأصل جديد'),
                          ),
                        ),
                        const PopupMenuItem(
                          value: 'insights',
                          child: ListTile(
                            leading: Icon(Icons.account_tree_outlined),
                            title: Text('الاستخدام وسجل النسخ'),
                          ),
                        ),
                        const PopupMenuItem(
                          value: 'batch',
                          child: ListTile(
                            leading: Icon(Icons.collections_outlined),
                            title: Text('رفع مجموعة من نفس الدفعة'),
                          ),
                        ),
                        const PopupMenuItem(
                          value: 'copy',
                          child: ListTile(
                            leading: Icon(Icons.content_copy_rounded),
                            title: Text('نسخ كل البيانات'),
                          ),
                        ),
                        PopupMenuItem(
                          value: 'favorite',
                          child: ListTile(
                            leading: Icon(
                              favorite
                                  ? Icons.star_rounded
                                  : Icons.star_border_rounded,
                            ),
                            title: Text(
                              favorite
                                  ? 'إزالة من المفضلة'
                                  : 'إضافة إلى المفضلة',
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBatchProgress() {
    if (_batchResults.isEmpty && _batchProgressLabel == null) {
      return const SizedBox.shrink();
    }
    Color stateColor(String state) => switch (state) {
          'Verified' => Colors.greenAccent,
          'Published' => Colors.lightBlueAccent,
          'Draft' => Colors.amberAccent,
          'Uploading' => Colors.amberAccent,
          'Failed' => Colors.redAccent,
          'Ready' => const Color(0xFFC4A7FF),
          _ => Colors.white38,
        };
    String stateLabel(String state) => switch (state) {
          'Verified' => 'تم التأكد',
          'Published' => 'منشور',
          'Draft' => 'مسودة',
          'Uploading' => 'جارٍ الرفع',
          'Failed' => 'تعذر',
          'Ready' => 'جاهز',
          'Missing' => 'غير موجود',
          _ => state,
        };

    return _studioPanel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(
                Icons.collections_outlined,
                color: Color(0xFFD7B85A),
              ),
              const SizedBox(width: 8),
              const Expanded(
                child: Text(
                  'تقدم رفع المجموعة',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if (!_batchBusy)
                IconButton(
                  tooltip: 'إخفاء النتائج',
                  onPressed: () => setState(() {
                    _batchResults = const [];
                    _batchProgressLabel = null;
                  }),
                  icon: const Icon(Icons.close_rounded),
                ),
            ],
          ),
          if (_batchProgressLabel != null) ...[
            const SizedBox(height: 5),
            Text(
              _batchProgressLabel!,
              style: const TextStyle(color: Colors.white60, fontSize: 11.5),
            ),
          ],
          if (_batchResults.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              'تم التأكد من ${_batchResults.where((item) => item['batchState'] == 'Verified').length} من أصل ${_batchResults.length}',
              style: const TextStyle(
                color: Colors.greenAccent,
                fontSize: 10.5,
                fontWeight: FontWeight.w800,
              ),
            ),
          ],
          if (_batchBusy) ...[
            const SizedBox(height: 8),
            const LinearProgressIndicator(minHeight: 3),
          ],
          const SizedBox(height: 10),
          ..._batchResults.map((item) {
            final state = (item['batchState'] ?? 'Missing').toString();
            final color = stateColor(state);
            return Container(
              margin: const EdgeInsets.only(bottom: 7),
              padding: const EdgeInsets.all(9),
              decoration: BoxDecoration(
                color: color.withValues(alpha: .05),
                borderRadius: BorderRadius.circular(11),
                border: Border.all(color: color.withValues(alpha: .15)),
              ),
              child: Row(
                children: [
                  Icon(
                    state == 'Verified'
                        ? Icons.verified_rounded
                        : state == 'Failed'
                            ? Icons.error_outline_rounded
                            : state == 'Uploading'
                                ? Icons.sync_rounded
                                : Icons.circle_outlined,
                    color: color,
                    size: 18,
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          (item['assetKey'] ?? '').toString(),
                          textDirection: TextDirection.ltr,
                          textAlign: TextAlign.right,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 10.5,
                          ),
                        ),
                        if ((item['note'] ?? '').toString().isNotEmpty)
                          Text(
                            (item['note'] ?? '').toString(),
                            style: const TextStyle(
                              color: Colors.white54,
                              fontSize: 9.5,
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    stateLabel(state),
                    style: TextStyle(
                      color: color,
                      fontWeight: FontWeight.w900,
                      fontSize: 10,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  Widget _buildRegistry() {
    final visible = _visibleAssets;
    final filtered = _filteredAssets;
    final warnings = _registryWarnings;
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
            'ابحث بالمفتاح أو الملف أو المسار. الأرقام هنا تخص النتائج الحالية، والبحث والفلترة يفحصان السجل ضمن حد آمن.',
            style: TextStyle(color: Colors.white60, fontSize: 11.5),
          ),
          if (_recentAssetKeys.isNotEmpty ||
              _favoriteAssetKeys.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(
              spacing: 7,
              runSpacing: 7,
              children: [
                ..._favoriteAssetKeys.take(4).map(
                      (key) => ActionChip(
                        avatar: const Icon(
                          Icons.star_rounded,
                          size: 16,
                          color: Color(0xFFFFD54A),
                        ),
                        label: Text(
                          key,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onPressed: () {
                          _assetSearch.text = key;
                          setState(() {
                            _debouncedSearch = key.toLowerCase();
                            _visibleLimit = 24;
                          });
                          unawaited(_loadAssets());
                        },
                      ),
                    ),
                ..._recentAssetKeys
                    .where((key) => !_favoriteAssetKeys.contains(key))
                    .take(3)
                    .map(
                      (key) => ActionChip(
                        avatar: const Icon(Icons.history_rounded, size: 16),
                        label: Text(
                          key,
                          overflow: TextOverflow.ellipsis,
                        ),
                        onPressed: () {
                          _assetSearch.text = key;
                          setState(() {
                            _debouncedSearch = key.toLowerCase();
                            _visibleLimit = 24;
                          });
                          unawaited(_loadAssets());
                        },
                      ),
                    ),
              ],
            ),
          ],
          const SizedBox(height: 11),
          TextField(
            controller: _assetSearch,
            onChanged: _onSearchChanged,
            onTap: () => _selectAll(_assetSearch),
            decoration: InputDecoration(
              hintText: 'البحث في الأصول...',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: _assetSearch.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'مسح البحث',
                      onPressed: () {
                        _assetSearch.clear();
                        setState(() {
                          _debouncedSearch = '';
                          _visibleLimit = 24;
                        });
                        unawaited(_loadAssets());
                      },
                      icon: const Icon(Icons.close_rounded),
                    ),
              border: const OutlineInputBorder(),
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
                  onSelected: (_) => _applyRegistryFilters(status: 'all'),
                ),
                const SizedBox(width: 7),
                ChoiceChip(
                  label: const Text('منشور'),
                  selected: _assetFilter == 'published',
                  onSelected: (_) => _applyRegistryFilters(status: 'published'),
                ),
                const SizedBox(width: 7),
                ChoiceChip(
                  label: const Text('مسودة'),
                  selected: _assetFilter == 'draft',
                  onSelected: (_) => _applyRegistryFilters(status: 'draft'),
                ),
                const SizedBox(width: 7),
                ChoiceChip(
                  label: const Text('يحتاج مراجعة'),
                  selected: _assetFilter == 'review',
                  onSelected: (_) => _applyRegistryFilters(status: 'review'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 9),
          Row(
            children: [
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _assetTypeFilter,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'النوع',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  items: [
                    const DropdownMenuItem(
                      value: 'all',
                      child: Text('كل الأنواع'),
                    ),
                    ..._availableAssetTypes.map(
                      (type) => DropdownMenuItem(
                        value: type,
                        child: Text(_assetTypeLabel(type)),
                      ),
                    ),
                  ],
                  onChanged: (value) =>
                      _applyRegistryFilters(type: value ?? 'all'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonFormField<String>(
                  value: _assetChannelFilter,
                  isExpanded: true,
                  decoration: const InputDecoration(
                    labelText: 'مكان الاستخدام',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  items: [
                    const DropdownMenuItem(
                      value: 'all',
                      child: Text('كل أماكن الاستخدام'),
                    ),
                    ..._channels.map(
                      (channel) => DropdownMenuItem(
                        value: channel,
                        child: Text(_channelLabel(channel)),
                      ),
                    ),
                  ],
                  onChanged: (value) =>
                      _applyRegistryFilters(channel: value ?? 'all'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: const Text(
              'فلاتر إضافية',
              style: TextStyle(fontWeight: FontWeight.w800),
            ),
            subtitle: const Text(
              'المجموعة • المستوى • آخر تحديث',
              style: TextStyle(fontSize: 11.5),
            ),
            children: [
              TextField(
                controller: _assetFamilySearch,
                textDirection: TextDirection.ltr,
                onTap: () => _selectAll(_assetFamilySearch),
                onSubmitted: (value) =>
                    _applyRegistryFilters(family: value),
                decoration: InputDecoration(
                  labelText: 'المجموعة',
                  hintText: 'مثال: wealth أو vip أو game',
                  prefixIcon: const Icon(Icons.folder_copy_outlined),
                  suffixIcon: IconButton(
                    tooltip: 'تطبيق',
                    onPressed: () => _applyRegistryFilters(
                      family: _assetFamilySearch.text,
                    ),
                    icon: const Icon(Icons.search_rounded),
                  ),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: _assetLevelSearch,
                textDirection: TextDirection.ltr,
                onTap: () => _selectAll(_assetLevelSearch),
                onSubmitted: (value) =>
                    _applyRegistryFilters(level: value),
                decoration: InputDecoration(
                  labelText: 'المستوى أو الفئة',
                  hintText: 'مثال: lv26_30',
                  prefixIcon: const Icon(Icons.stairs_outlined),
                  suffixIcon: IconButton(
                    tooltip: 'تطبيق',
                    onPressed: () => _applyRegistryFilters(
                      level: _assetLevelSearch.text,
                    ),
                    icon: const Icon(Icons.search_rounded),
                  ),
                  border: const OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 8),
              DropdownButtonFormField<String>(
                value: _assetUpdatedWindow,
                decoration: const InputDecoration(
                  labelText: 'آخر تحديث',
                  prefixIcon: Icon(Icons.schedule_rounded),
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(
                    value: 'all',
                    child: Text('أي وقت'),
                  ),
                  DropdownMenuItem(
                    value: '7d',
                    child: Text('آخر 7 أيام'),
                  ),
                  DropdownMenuItem(
                    value: '30d',
                    child: Text('آخر 30 يوم'),
                  ),
                  DropdownMenuItem(
                    value: '90d',
                    child: Text('آخر 90 يوم'),
                  ),
                ],
                onChanged: (value) => _applyRegistryFilters(
                  updatedWindow: value ?? 'all',
                ),
              ),
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerRight,
                child: TextButton.icon(
                  onPressed: _clearRegistryFilters,
                  icon: const Icon(Icons.filter_alt_off_outlined),
                  label: const Text('مسح كل الفلاتر'),
                ),
              ),
            ],
          ),
          if (_registryScanLimitReached) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.amberAccent.withValues(alpha: .06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(
                  color: Colors.amberAccent.withValues(alpha: .18),
                ),
              ),
              child: const Text(
                'للحفاظ على سرعة الاستديو تم فحص جزء محدد من السجل. '
                'استخدم فلترًا أدق أو حمّل الصفحة التالية إذا لم تجد الأصل المطلوب.',
                style: TextStyle(
                  color: Colors.amberAccent,
                  fontSize: 10.5,
                ),
              ),
            ),
          ],
          if (warnings.isNotEmpty) ...[
            const SizedBox(height: 10),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              leading: const Icon(
                Icons.warning_amber_rounded,
                color: Colors.orangeAccent,
              ),
              title: Text(
                'ملاحظات السجل (${warnings.length})',
                style: const TextStyle(fontWeight: FontWeight.w800),
              ),
              children: warnings
                  .map(
                    (warning) => ListTile(
                      dense: true,
                      leading: const Icon(
                        Icons.error_outline_rounded,
                        size: 17,
                        color: Colors.orangeAccent,
                      ),
                      title: Text(
                        warning,
                        style: const TextStyle(fontSize: 11),
                      ),
                    ),
                  )
                  .toList(growable: false),
            ),
          ],
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
                ],
              ),
            )
          else if (filtered.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(
                child: Text(
                  'لا توجد نتائج مطابقة.',
                  style: TextStyle(color: Colors.white54),
                ),
              ),
            )
          else ...[
            Text(
              'عرض ${visible.length} من ${filtered.length}',
              style: const TextStyle(
                color: Colors.white54,
                fontSize: 10.5,
              ),
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: visible.length <= 3
                  ? (visible.length * 165.0)
                      .clamp(165.0, 495.0)
                      .toDouble()
                  : 560.0,
              child: ListView.builder(
                primary: false,
                itemCount: visible.length,
                cacheExtent: 180,
                itemBuilder: (context, index) =>
                    _registryItem(visible[index]),
              ),
            ),
            if (visible.length < filtered.length)
              OutlinedButton.icon(
                onPressed: () => setState(
                  () => _visibleLimit =
                      (_visibleLimit + 24).clamp(24, filtered.length),
                ),
                icon: const Icon(Icons.expand_more_rounded),
                label: const Text('عرض المزيد'),
              ),
            if (visible.length >= filtered.length && _hasMoreRegistry)
              OutlinedButton.icon(
                onPressed: _loadingMoreRegistry
                    ? null
                    : () => _loadAssets(append: true),
                icon: _loadingMoreRegistry
                    ? const SizedBox(
                        width: 17,
                        height: 17,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.cloud_download_outlined),
                label: const Text('تحميل صفحة إضافية من السجل'),
              ),
          ],
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
                            'إدارة أصول شادو لايف',
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
            Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(13),
                  child: SizedBox(
                    width: 74,
                    height: 74,
                    child: Image.asset(
                      'assets/images/auth_header.png',
                      fit: BoxFit.cover,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Icon(
                            Icons.star_rounded,
                            size: 17,
                            color: Color(0xFFD7B85A),
                          ),
                          SizedBox(width: 5),
                          Text(
                            'الأصل المحدد',
                            style: TextStyle(
                              color: Color(0xFFD7B85A),
                              fontSize: 11.5,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                      SizedBox(height: 5),
                      Text(
                        'صورة شاشة تسجيل الدخول',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      SizedBox(height: 3),
                      Text(
                        'auth.login.header',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.right,
                        style: TextStyle(
                          color: Colors.white60,
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: 'تعديل الأصل',
                  onPressed: _busy
                      ? null
                      : () {
                          _selectAuthHeaderPreset();
                          setState(() => _showStudioForm = true);
                        },
                  icon: const Icon(Icons.edit_outlined),
                ),
              ],
            ),
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: _busy ? null : _startNewAsset,
                  icon: const Icon(Icons.add_circle_outline_rounded),
                  label: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 13),
                    child: Text(
                      'إضافة أصل جديد',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _busy ? null : _showSmartPresetPicker,
                  icon: const Icon(Icons.auto_awesome_rounded),
                  label: const Padding(
                    padding: EdgeInsets.symmetric(vertical: 13),
                    child: Text(
                      'اختيار أصل جاهز',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _statTile(
                Icons.inventory_2_outlined,
                _assets.length.toString(),
                'النتائج الحالية',
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
          if (_batchResults.isNotEmpty ||
              _batchProgressLabel != null) ...[
            const SizedBox(height: 15),
            _buildBatchProgress(),
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
                  'للمالك فقط • قوالب وأماكن استخدام • فحص قبل النشر • '
                  'مسودات آمنة • نشر مضبوط • منع تكرار العملية • '
                  'سجل أصول وتعديلات واضح. بدون تحميل متكرر أو مراقبة مستمرة تسبب ضغطًا.',
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
    final initialSearch = widget.initialSearch.trim();
    if (initialSearch.isNotEmpty) {
      _assetSearch.text = initialSearch;
      _debouncedSearch = initialSearch.toLowerCase();
    }
    _loadAssets();
  }

  @override
  Widget build(BuildContext context) {
    final uid = controlAuth.currentUser?.uid;
    if (uid == null) {
      return const Scaffold(body: Center(child: Text('سجّل الدخول أولاً')));
    }
    return PopScope(
      canPop: !_hasUnsavedChanges,
      onPopInvokedWithResult: (didPop, _) async {
        if (didPop || !_hasUnsavedChanges) return;
        if (await _confirmDiscardChanges() && context.mounted) {
          Navigator.of(context).pop();
        }
      },
      child: Scaffold(
        appBar: AppBar(title: const Text('استديو أصول شادو لايف')),
        bottomNavigationBar:
            _showStudioForm ? _buildStickyStudioActions() : null,
        body: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
          future: controlFirestore.collection('users').doc(uid).get(),
          builder: (context, snapshot) {
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }
            final data = snapshot.data?.data();
            if (data?['role'] != 'owner') {
              return const Center(
                child: Padding(
                  padding: EdgeInsets.all(24),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.lock_outline,
                        size: 58,
                        color: Colors.orangeAccent,
                      ),
                      SizedBox(height: 12),
                      Text(
                        'هذه الصفحة متاحة لحساب المالك فقط',
                        style: TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }
            return _ownerBody();
          },
        ),
      ),
    );
  }
}
