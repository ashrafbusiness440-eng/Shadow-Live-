import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../../shared/widgets/shadow_global_wallpaper.dart';
import '../../../shared/widgets/confirmation_dialog.dart';
import '../../../shared/services/user_storage_service.dart';
import '../../../shared/services/report_screenshot_service.dart';
import '../../gift/widgets/direct_gift_sheet.dart';
import '../../../services/navigation_service.dart';
import '../../main/screens/main_shell_screen.dart';
import '../../profile/services/follow_service.dart';
import '../../profile/widgets/quick_profile_sheet.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../services/chat_safety_service.dart';
import '../services/animated_emoji_catalog.dart';
import '../../vip/utils/vip_cosmetic_policy.dart';
import '../../vip/widgets/vip_cosmetic_asset.dart';
import '../../vip/utils/vip_public_state.dart';

class PrivateChatScreen extends StatefulWidget {
  final String conversationId;
  final String otherUid;
  final String otherName;
  final String otherPhoto;

  const PrivateChatScreen({super.key, required this.conversationId, required this.otherUid, required this.otherName, this.otherPhoto = ''});

  @override
  State<PrivateChatScreen> createState() => _PrivateChatScreenState();
}

class _PrivateChatScreenState extends State<PrivateChatScreen> {
  static const _apiBase = String.fromEnvironment(
    'SHADOW_CLOUDFLARE_API_BASE_URL',
    defaultValue: 'https://shadow-live.ashraf-business-440.workers.dev/api',
  );
  final _controller = TextEditingController();
  final _follow = FollowService();
  final _picker = ImagePicker();
  final GlobalKey _reportSnapshotKey = GlobalKey();
  final ReportScreenshotService _reportSnapshots = ReportScreenshotService();
  final _storage = UserStorageService();
  final Map<String, Future<UserStorageObject>> _chatImageLoads = {};
  final _safety = ChatSafetyService();
  bool _sending = false;
  bool _changingBlock = false;
  bool _loadingSafety = true;
  ChatSafetyStatus _safetyStatus = const ChatSafetyStatus(
    blocked: false,
    blockedByMe: false,
    blockedByOther: false,
  );
  bool _markingRead = false;
  bool _sendingImage = false;
  bool _messageActionBusy = false;
  final Set<String> _locallyHiddenMessageIds = <String>{};
  final Set<String> _locallyDeletedMessageIds = <String>{};
  int? _selfVipLevelCache;
  String? _animatedEmojiId;
  String? _openedByUid;
  static const int _historyPageSize = 50;
  final Map<String, QueryDocumentSnapshot<Map<String, dynamic>>>
      _loadedHistory = {};
  DocumentSnapshot<Map<String, dynamic>>? _historyCursor;
  bool _historyLoading = false;
  bool _historyHasMore = true;
  bool _historyFailed = false;
  late final Stream<User?> _authChanges;
  late final Stream<QuerySnapshot<Map<String, dynamic>>> _messageChanges;

  bool _isActiveChatAccount(String? expectedUid) =>
      mounted &&
      expectedUid != null &&
      expectedUid.isNotEmpty &&
      expectedUid == _openedByUid &&
      FirebaseAuth.instance.currentUser?.uid == expectedUid;

  String get _uid => FirebaseAuth.instance.currentUser!.uid;
  DocumentReference<Map<String, dynamic>> get _conversation => FirebaseFirestore.instance.collection('conversations').doc(widget.conversationId);

  @override
  void initState() {
    super.initState();
    _authChanges = FirebaseAuth.instance.authStateChanges();
    _messageChanges = _conversation
        .collection('messages')
        .orderBy('createdAt', descending: true)
        .limit(100)
        .snapshots();
    _openedByUid = FirebaseAuth.instance.currentUser?.uid;
    if (FirebaseAuth.instance.currentUser?.isAnonymous ?? true) return;
    _markRead();
    _loadSafetyStatus();
  }

  Future<void> _loadSafetyStatus() async {
    try {
      final status = await _safety.status(widget.otherUid);
      if (mounted) {
        setState(() {
          _safetyStatus = status;
          _loadingSafety = false;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _loadingSafety = false);
    }
  }

  Future<void> _markRead() async {
    final ownerUid = _openedByUid;
    if (_markingRead || !_isActiveChatAccount(ownerUid)) return;
    _markingRead = true;
    try {
      if (!_isActiveChatAccount(ownerUid)) return;
      await _conversation.update({'unreadCounts.$ownerUid': 0});
    } catch (_) {
      // A revoked session or denied read receipt must not expose chat data.
    } finally {
      _markingRead = false;
    }
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    final sender = FirebaseAuth.instance.currentUser;
    final senderUid = sender?.uid;
    if (text.isEmpty || _sending || text.length > 2000 ||
        !_isActiveChatAccount(senderUid)) return;
    setState(() => _sending = true);
    try {
      final token = await sender!.getIdToken();
      if (!_isActiveChatAccount(senderUid)) return;
      if (token == null || token.isEmpty) throw StateError('not_signed_in');
      final key = [senderUid!, DateTime.now().microsecondsSinceEpoch.toString(), 'text'].join('_');
      final response = await http.post(
        Uri.parse('$_apiBase/chat-actions'),
        headers: {'authorization': 'Bearer ' + token, 'content-type': 'application/json'},
        body: jsonEncode({
          'action': 'sendMessage',
          'receiverId': widget.otherUid,
          'conversationId': widget.conversationId,
          'text': text,
          if (_animatedEmojiId != null)
            'animatedEmojiId': _animatedEmojiId,
          'idempotencyKey': key,
        }),
      );
      if (!_isActiveChatAccount(senderUid)) return;
      Map<String, dynamic> body = <String, dynamic>{};
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {}
      if (response.statusCode == 200 && body['ok'] == true) {
        _controller.clear();
        _animatedEmojiId = null;
        if (mounted) setState(() {});
        return;
      }
      switch (body['code']) {
        case 'content_blocked':
          _snack('هذه الرسالة تحتوي على كلمات غير مسموح بإرسالها.');
          break;
        case 'message_limit_reached':
          _snack('وصلت للحد: 3 رسائل غير مُجابة حتى تصبح المتابعة متبادلة.');
          break;
        case 'follow_required':
          _snack('يجب متابعة هذا المستخدم أولاً لإرسال رسالة.');
          break;
        case 'invalid_conversation':
          _snack('تعذر التحقق من هذه المحادثة.');
          break;
        case 'blocked':
          _snack('لا يمكن إرسال رسائل بينكما حالياً بسبب إعدادات الحظر.');
          break;
        case 'rate_limited':
          _snack('تم الإرسال بسرعة كبيرة. حاول مجددًا بعد لحظات.');
          break;
        case 'private_messages_restricted':
          _snack('الإدارة قيّدت إرسال الرسائل الخاصة مؤقتًا. راجع إشعاراتك لمعرفة السبب والمدة.');
          break;
        default:
          _snack('تعذر إرسال الرسالة حالياً.');
      }
    } catch (_) {
      if (_isActiveChatAccount(senderUid)) {
        _snack('تعذر إرسال الرسالة حالياً.');
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }


  Future<void> _setBlocked(bool blocked) async {
    if (_changingBlock) return;
    setState(() => _changingBlock = true);
    try {
      await _safety.setBlocked(targetUserId: widget.otherUid, blocked: blocked);
      final status = await _safety.status(widget.otherUid);
      if (mounted) {
        setState(() => _safetyStatus = status);
      }
      if (blocked) {
        _controller.clear();
        _snack('تم حظر المستخدم وإيقاف الرسائل والهدايا والصور بينكما.');
      } else {
        _snack('تم إلغاء الحظر.');
      }
    } catch (_) {
      _snack('تعذر تحديث الحظر حالياً.');
    } finally {
      if (mounted) setState(() => _changingBlock = false);
    }
  }

  Future<void> _confirmBlock(bool currentlyBlocked) async {
    if (currentlyBlocked) {
      await _setBlocked(false);
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: const Color(0xFF111522),
        title: const Text('حظر المستخدم', style: TextStyle(color: Colors.white)),
        content: const Text(
          'سيتم إيقاف الرسائل والهدايا والصور بينكما وإلغاء المتابعة المتبادلة.',
          style: TextStyle(color: Colors.white70),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('إلغاء'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: FilledButton.styleFrom(backgroundColor: Colors.redAccent),
            child: const Text('حظر'),
          ),
        ],
      ),
    );
    if (confirmed == true) await _setBlocked(true);
  }

  Future<void> _reportUser() async {
    final detailsController = TextEditingController();
    var reason = 'spam';
    var sending = false;
    const labels = <String, String>{
      'spam': 'رسائل مزعجة / Spam',
      'harassment': 'مضايقة أو إساءة',
      'inappropriate_content': 'محتوى غير مناسب',
      'scam': 'احتيال أو تضليل',
      'other': 'سبب آخر',
    };
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          backgroundColor: const Color(0xFF111522),
          title: const Text('الإبلاغ عن المستخدم', style: TextStyle(color: Colors.white)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DropdownButtonFormField<String>(
                value: reason,
                dropdownColor: const Color(0xFF171C2A),
                decoration: const InputDecoration(
                  labelText: 'سبب البلاغ',
                  labelStyle: TextStyle(color: Colors.white60),
                ),
                items: labels.entries
                    .map((entry) => DropdownMenuItem(
                          value: entry.key,
                          child: Text(entry.value, style: const TextStyle(color: Colors.white)),
                        ))
                    .toList(),
                onChanged: sending
                    ? null
                    : (value) {
                        if (value != null) setDialogState(() => reason = value);
                      },
              ),
              const SizedBox(height: 12),
              TextField(
                controller: detailsController,
                maxLength: 500,
                minLines: 2,
                maxLines: 4,
                enabled: !sending,
                style: const TextStyle(color: Colors.white),
                decoration: const InputDecoration(
                  hintText: 'تفاصيل إضافية (اختياري)',
                  hintStyle: TextStyle(color: Colors.white38),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: sending ? null : () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton.icon(
              onPressed: sending
                  ? null
                  : () async {
                      setDialogState(() => sending = true);
                      try {
                        final screenshot = await captureReportSnapshot(_reportSnapshotKey);
                        final reportId = await _safety.reportUser(
                          targetUserId: widget.otherUid,
                          conversationId: widget.conversationId,
                          reason: reason,
                          details: detailsController.text.trim(),
                        );
                        final attached = await _reportSnapshots.attach(
                          reportId: reportId, imageBase64: screenshot,
                        );
                        if (dialogContext.mounted) Navigator.pop(dialogContext);
                        _snack(screenshot != null && !attached
                          ? 'تم إرسال البلاغ مع الدليل الموثق، دون الصورة الاختيارية.'
                          : 'تم إرسال البلاغ للمراجعة.');
                      } on StateError catch (error) {
                        if (error.message == 'rate_limited') {
                          _snack('تم إرسال عدة بلاغات مؤخرًا. حاول لاحقًا.');
                        } else if (error.message == 'report_recent_duplicate') {
                          _snack('سبق إرسال هذا البلاغ مؤخرًا. يمكنك الإبلاغ عن واقعة مختلفة.');
                        } else {
                          _snack('تعذر إرسال البلاغ حالياً.');
                        }
                        if (dialogContext.mounted) {
                          setDialogState(() => sending = false);
                        }
                      } catch (_) {
                        _snack('تعذر إرسال البلاغ حالياً.');
                        if (dialogContext.mounted) {
                          setDialogState(() => sending = false);
                        }
                      }
                    },
              icon: sending
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.flag_outlined),
              label: const Text('إرسال البلاغ'),
            ),
          ],
        ),
      ),
    );
    detailsController.dispose();
  }

  Future<bool> _storageReady() => _storage.isReady();

  Future<UserStorageObject> _loadChatImage(String objectId) {
    // Keep a small, LRU-like memo for the visible media window only. Manual
    // history pagination must not retain every R2 image in memory indefinitely.
    final cached = _chatImageLoads.remove(objectId);
    if (cached != null) {
      _chatImageLoads[objectId] = cached;
      return cached;
    }
    final future = _storage.read(objectId);
    _chatImageLoads[objectId] = future;
    while (_chatImageLoads.length > 16) {
      _chatImageLoads.remove(_chatImageLoads.keys.first);
    }
    return future;
  }

  Future<void> _deleteUploadedObjectQuietly(String objectId) async {
    try {
      await _storage.delete(objectId);
    } catch (_) {}
  }

  Widget _r2ChatImage(String objectId) {
    return FutureBuilder<UserStorageObject>(
      future: _loadChatImage(objectId),
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return SizedBox(
            width: 180,
            height: 120,
            child: Center(
              child: TextButton.icon(
                onPressed: () {
                  if (!_isActiveChatAccount(_openedByUid)) return;
                  setState(() => _chatImageLoads.remove(objectId));
                },
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('إعادة تحميل الصورة'),
              ),
            ),
          );
        }
        final object = snapshot.data;
        if (object == null) {
          return const SizedBox(
            width: 180,
            height: 120,
            child: Center(
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          );
        }
        return GestureDetector(
          onTap: () => showDialog<void>(
            context: context,
            barrierColor: Colors.black87,
            builder: (_) => Dialog(
              backgroundColor: Colors.transparent,
              insetPadding: const EdgeInsets.all(12),
              child: InteractiveViewer(
                child: Image.memory(object.bytes, fit: BoxFit.contain),
              ),
            ),
          ),
          child: Image.memory(
            object.bytes,
            fit: BoxFit.cover,
          ),
        );
      },
    );
  }

  Future<void> _sendImage() async {
    final senderUid = FirebaseAuth.instance.currentUser?.uid;
    if (_sendingImage || !_isActiveChatAccount(senderUid)) return;
    // Acquire the lock before awaiting any permission, storage, or picker work.
    setState(() => _sendingImage = true);
    try {
      await _sendImageOnce(senderUid!);
    } catch (_) {
      if (_isActiveChatAccount(senderUid)) {
        _snack('تعذر تجهيز الصورة. حاول مرة ثانية.');
      }
    } finally {
      if (mounted) setState(() => _sendingImage = false);
    }
  }

  Future<void> _sendImageOnce(String senderUid) async {
    if (!_isActiveChatAccount(senderUid)) return;
    final mutual = await _follow.isMutual(widget.otherUid);
    if (!_isActiveChatAccount(senderUid)) return;
    if (!mutual) {
      _snack('إرسال الصور متاح فقط عند وجود متابعة متبادلة بينكما.');
      return;
    }
    final storageReady = await _storageReady();
    if (!_isActiveChatAccount(senderUid)) return;
    if (!storageReady) {
      _snack('إرسال الصور غير متاح حالياً. تحقق من اتصال التخزين وحاول مجدداً.');
      return;
    }
    final picked = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1920,
      maxHeight: 1920,
      requestFullMetadata: false,
    );
    if (!_isActiveChatAccount(senderUid) || picked == null) return;
    final bytes = await picked.readAsBytes();
    if (!_isActiveChatAccount(senderUid)) return;
    if (bytes.isEmpty || bytes.length > 8 * 1024 * 1024) {
      _snack('حجم الصورة يجب أن يكون أقل من 8MB.');
      return;
    }

    String mime;
    try {
      mime = detectSupportedImageMime(bytes);
    } catch (_) {
      _snack('صيغة الصورة غير مدعومة. استخدم JPG أو PNG أو WebP.');
      return;
    }

    if (!_isActiveChatAccount(senderUid)) return;
    String? uploadedObjectId;
    try {
      final upload = await _storage.upload(
        scope: 'chat_image',
        bytes: bytes,
        mimeType: mime,
        targetId: widget.conversationId,
      );
      uploadedObjectId = upload.objectId;
      if (!_isActiveChatAccount(senderUid)) {
        throw StateError('account_changed');
      }

      final messageRef = _conversation.collection('messages').doc();
      final batch = FirebaseFirestore.instance.batch();
      batch.update(_conversation, {
        'lastMessage': '📷 صورة',
        'lastMessageId': messageRef.id,
        'lastSenderId': senderUid,
        'updatedAt': FieldValue.serverTimestamp(),
        'unreadCounts.' + senderUid: 0,
        'unreadCounts.' + widget.otherUid: FieldValue.increment(1),
      });
      batch.set(messageRef, {
        'senderId': senderUid,
        'receiverId': widget.otherUid,
        'type': 'image',
        'storageObjectId': upload.objectId,
        // The R2 upload service may transcode and shrink the picked image.
        // Persist the confirmed object metadata, never its original bytes.
        'mimeType': upload.mimeType,
        'sizeBytes': upload.sizeBytes,
        'createdAt': FieldValue.serverTimestamp(),
      });
      await batch.commit();
      uploadedObjectId = null;
    } on UserStoragePendingModeration catch (pending) {
      // A pending object belongs to the account that initiated the upload.
      // Do not link it to a chat after sign-out, account switch, or navigation.
      if (!_isActiveChatAccount(senderUid)) {
        await _deleteUploadedObjectQuietly(pending.objectId);
        return;
      }
      // The conversation stores only an inaccessible image reference until
      // the owner approves the exact private R2 bytes and linked message.
      try {
        final messageRef = _conversation.collection('messages').doc();
        final batch = FirebaseFirestore.instance.batch();
        batch.update(_conversation, {
          'lastMessage': '📷 صورة قيد المراجعة',
          'lastMessageId': messageRef.id,
          'lastSenderId': senderUid,
          'updatedAt': FieldValue.serverTimestamp(),
          'unreadCounts.' + senderUid: 0,
          'unreadCounts.' + widget.otherUid: FieldValue.increment(1),
        });
        batch.set(messageRef, {
          'senderId': senderUid,
          'receiverId': widget.otherUid,
          'type': 'image',
          'storageObjectId': pending.objectId,
          'mimeType': pending.mimeType,
          'sizeBytes': pending.sizeBytes,
          'moderationStatus': 'pending',
          'createdAt': FieldValue.serverTimestamp(),
        });
        await batch.commit();
        _snack('أُرسلت صورة قيد المراجعة. لن تظهر حتى موافقة الإدارة.');
      } catch (_) {
        _snack('تعذر ربط الصورة بالمحادثة. لم يتم نشرها.');
      }
    } on FirebaseException catch (error) {
      if (uploadedObjectId != null) {
        await _deleteUploadedObjectQuietly(uploadedObjectId);
      }
      if (error.code == 'unauthorized' || error.code == 'permission-denied') {
        _snack('تعذّر إرسال الصورة: تحقق من المتابعة المتبادلة أو تقييد الرسائل الخاصة في إشعاراتك.');
      } else {
        _snack('تعذر حفظ الصورة في المحادثة حالياً.');
      }
    } on StateError catch (error) {
      if (uploadedObjectId != null) {
        await _deleteUploadedObjectQuietly(uploadedObjectId);
      }
      if (!_isActiveChatAccount(senderUid)) return;
      if (error.message == 'follow_required') {
        _snack('إرسال الصور يحتاج متابعة متبادلة.');
      } else if (error.message == 'image_too_large_after_compression') {
        _snack('حجم الصورة كبير حتى بعد الضغط. اختر صورة أصغر وحاول مجددًا.');
      } else {
        _snack('تعذر رفع الصورة حالياً.');
      }
    } catch (_) {
      if (uploadedObjectId != null) {
        await _deleteUploadedObjectQuietly(uploadedObjectId);
      }
      _snack('تعذر إرسال الصورة.');
    }
  }

  Future<void> _loadOlderMessages(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> recent,
  ) async {
    final ownerUid = _openedByUid;
    if (!_isActiveChatAccount(ownerUid) || _historyLoading ||
        recent.isEmpty || (_historyCursor != null && !_historyHasMore)) {
      return;
    }
    // The first cursor comes from the bounded live window. Next pages use
    // the last fetched document, so no offset, full collection scan or polling.
    final cursor = _historyCursor ?? recent.last;
    setState(() {
      _historyLoading = true;
      _historyFailed = false;
    });
    try {
      final page = await _conversation
          .collection('messages')
          .orderBy('createdAt', descending: true)
          .startAfterDocument(cursor)
          .limit(_historyPageSize)
          .get();
      if (!_isActiveChatAccount(ownerUid)) return;
      setState(() {
        // Preserve the live window that preceded the first pagination; it
        // must not disappear when >100 new messages arrive while reading.
        for (final doc in recent) {
          _loadedHistory[doc.id] = doc;
        }
        for (final doc in page.docs) {
          _loadedHistory[doc.id] = doc;
        }
        _historyCursor = page.docs.isEmpty ? cursor : page.docs.last;
        _historyHasMore = page.docs.length == _historyPageSize;
      });
    } catch (_) {
      if (_isActiveChatAccount(ownerUid)) {
        setState(() => _historyFailed = true);
      }
    } finally {
      if (mounted) setState(() => _historyLoading = false);
    }
  }

  List<QueryDocumentSnapshot<Map<String, dynamic>>> _combinedMessages(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> recent,
  ) {
    // Once history is expanded, retain the changing live window to avoid gaps
    // when a newer message pushes an older one outside the 100-item stream.
    if (_historyCursor != null) {
      for (final doc in recent) {
        _loadedHistory[doc.id] = doc;
      }
    }
    final byId = <String, QueryDocumentSnapshot<Map<String, dynamic>>>{
      for (final doc in _loadedHistory.values) doc.id: doc,
      for (final doc in recent) doc.id: doc,
    };
    final result = byId.values.toList();
    result.sort((a, b) {
      final av = a.data()['createdAt'];
      final bv = b.data()['createdAt'];
      final am = av is Timestamp ? av.millisecondsSinceEpoch : 0;
      final bm = bv is Timestamp ? bv.millisecondsSinceEpoch : 0;
      final byTime = bm.compareTo(am);
      return byTime != 0 ? byTime : b.id.compareTo(a.id);
    });
    return result.where((doc) {
      final hidden = doc.data()['hiddenForUids'];
      return !_locallyHiddenMessageIds.contains(doc.id) &&
          (hidden is! List || !hidden.contains(_openedByUid));
    }).toList();
  }

  Future<int> _selfVipLevel() async {
    final cached = _selfVipLevelCache;
    if (cached != null) return cached;
    try {
      final snap = await FirebaseFirestore.instance
          .collection('public_profiles')
          .doc(_uid)
          .get();
      final data = snap.data();
      final level = data == null ? 0 : effectivePublicVipLevel(data);
      _selfVipLevelCache = level;
      return level;
    } catch (_) {
      return 0;
    }
  }

  Future<void> _pickAnimatedEmoji() async {
    if (_sending) return;
    final vipLevel = await _selfVipLevel();
    if (!mounted) return;
    final selected = await showAnimatedEmojiPicker(
      context,
      vipLevel: vipLevel,
    );
    if (selected == null || !mounted) return;
    setState(() {
      _animatedEmojiId = selected.id;
      _controller.text = selected.fallbackGlyph;
      _controller.selection = TextSelection.collapsed(
        offset: _controller.text.length,
      );
    });
  }

  Future<void> _openGiftPicker() async {
    await showDirectGiftSheet(
      context,
      receiverId: widget.otherUid,
      receiverName: widget.otherName,
      conversationId: widget.conversationId,
    );
  }

  String _giftEmoji(String id) => switch (id) {
        'rose' => '🌹',
        'coffee' => '☕',
        'heart' => '❤️',
        'chocolate' => '🍫',
        'crown' => '👑',
        'ring' => '💍',
        'sports_car' => '🏎️',
        'yacht' => '🛥️',
        'private_jet' => '✈️',
        'castle' => '🏰',
        'golden_dragon' => '🐉',
        'galaxy' => '🌌',
        _ => '🎁',
      };

  Widget _giftImage(Map<String, dynamic> data) {
    final url = (data['imageUrl'] ?? '').toString().trim();
    final key = (data['assetKey'] ?? '').toString().trim();
    final fallback = Text(
      _giftEmoji((data['giftId'] ?? '').toString()),
      style: const TextStyle(fontSize: 40),
      textAlign: TextAlign.center,
    );
    if (url.isNotEmpty) {
      return Image.network(url, fit: BoxFit.contain, errorBuilder: (_, __, ___) => fallback);
    }
    if (key.isNotEmpty) {
      return FutureBuilder<Uri?>(
        future: ShadowAssetRegistry.remoteUrl(key),
        builder: (_, snap) => snap.data == null
            ? fallback
            : Image.network(snap.data.toString(), fit: BoxFit.contain, errorBuilder: (_, __, ___) => fallback),
      );
    }
    return fallback;
  }

  Future<void> _openRoomInvite(Map<String, dynamic> data) async {
    final roomId = (data['roomId'] ?? '').toString().trim();
    if (roomId.isEmpty) {
      _snack('دعوة الغرفة غير صالحة.');
      return;
    }
    try {
      final room = await FirebaseFirestore.instance
          .collection('rooms')
          .doc(roomId)
          .get();
      final roomData = room.data();
      if (!room.exists || roomData == null || roomData['isActive'] == false) {
        _snack('هذه الغرفة غير متاحة حالياً.');
        return;
      }
      if (!mounted) return;
      Navigator.of(context).pushNamed(
        AppRoutes.voiceChatRoom,
        arguments: {
          ...roomData,
          'roomId': roomId,
        },
      );
    } catch (_) {
      _snack('تعذر فتح الغرفة حالياً.');
    }
  }


  bool _canDeleteMessageForEveryone(Map<String, dynamic> data) {
    if (data['senderId'] != _openedByUid ||
        data['deletedForEveryone'] == true) return false;
    final createdAt = data['createdAt'];
    if (createdAt is! Timestamp) return false;
    final elapsed = DateTime.now().difference(createdAt.toDate());
    return !elapsed.isNegative &&
        elapsed <= const Duration(minutes: 5);
  }

  Future<void> _showMessageActions(
    QueryDocumentSnapshot<Map<String, dynamic>> doc,
  ) async {
    if (!_isActiveChatAccount(_openedByUid) || _messageActionBusy) return;
    final data = doc.data();
    final type = (data['type'] ?? 'text').toString();
    final copyText = (data['text'] ?? '').toString();
    final canCopy = type == 'text' && copyText.isNotEmpty;
    final canDeleteBoth = _canDeleteMessageForEveryone(data);
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF171C2A),
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (canCopy)
              ListTile(
                leading: const Icon(Icons.copy_rounded, color: Colors.white70),
                title: const Text('نسخ الرسالة',
                    style: TextStyle(color: Colors.white)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  Clipboard.setData(ClipboardData(text: copyText));
                  _snack('تم نسخ الرسالة');
                },
              ),
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded,
                  color: Colors.white70),
              title: const Text('حذف من عندي',
                  style: TextStyle(color: Colors.white)),
              onTap: () {
                Navigator.pop(sheetContext);
                _runMessageAction(doc.id, 'hideMessageForMe');
              },
            ),
            if (canDeleteBoth)
              ListTile(
                leading: const Icon(Icons.delete_forever_rounded,
                    color: Colors.redAccent),
                title: const Text('حذف من الطرفين',
                    style: TextStyle(color: Colors.redAccent)),
                subtitle: const Text('خلال 5 دقائق من الإرسال',
                    style: TextStyle(color: Colors.white54)),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _runMessageAction(doc.id, 'deleteMessageForEveryone');
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _runMessageAction(String messageId, String action) async {
    final accountUid = _openedByUid;
    if (!_isActiveChatAccount(accountUid) || _messageActionBusy) return;
    final both = action == 'deleteMessageForEveryone';
    final confirmed = await showShadowConfirmation(
      context,
      title: both ? 'حذف الرسالة من الطرفين؟' : 'حذف الرسالة من عندك؟',
      message: both
          ? 'لن تظهر الرسالة لأي منكما بعد حذفها. حذف الهدية لا يعيد الرصيد.'
          : 'ستختفي هذه الرسالة من محادثتك فقط.',
      confirmLabel: both ? 'حذف من الطرفين' : 'حذف من عندي',
      destructive: true,
    );
    if (!confirmed || !_isActiveChatAccount(accountUid) ||
        _messageActionBusy) return;
    setState(() => _messageActionBusy = true);
    try {
      final token = await FirebaseAuth.instance.currentUser!.getIdToken();
      if (!_isActiveChatAccount(accountUid)) return;
      if (token == null || token.isEmpty) {
        throw StateError('not_signed_in');
      }
      final response = await http.post(
        Uri.parse('$_apiBase/chat-actions'),
        headers: {
          'authorization': 'Bearer $token',
          'content-type': 'application/json',
        },
        body: jsonEncode({
          'action': action,
          'conversationId': widget.conversationId,
          'messageId': messageId,
        }),
      );
      if (!_isActiveChatAccount(accountUid)) return;
      final decoded = jsonDecode(response.body);
      final body = decoded is Map ? decoded : const <String, dynamic>{};
      if (response.statusCode == 200 && body['ok'] == true) {
        if (mounted) {
          setState(() {
            if (both) {
              _locallyDeletedMessageIds.add(messageId);
            } else {
              _locallyHiddenMessageIds.add(messageId);
            }
          });
        }
        _snack(both ? 'تم حذف الرسالة من الطرفين.' : 'تم حذف الرسالة من عندك.');
        return;
      }
      if (body['code'] == 'delete_window_expired') {
        _snack('انتهت مهلة حذف الرسالة من الطرفين (5 دقائق).');
      } else if (body['code'] == 'message_not_found') {
        _snack('هذه الرسالة لم تعد متاحة.');
      } else {
        _snack('تعذر حذف الرسالة حالياً. حاول مجدداً.');
      }
    } catch (_) {
      if (_isActiveChatAccount(accountUid)) {
        _snack('تعذر حذف الرسالة حالياً. حاول مجدداً.');
      }
    } finally {
      if (mounted) setState(() => _messageActionBusy = false);
    }
  }

  Widget _messageBubble(QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final data = <String, dynamic>{...doc.data()};
    if (_locallyDeletedMessageIds.contains(doc.id)) {
      data['type'] = 'deleted';
      data['deletedForEveryone'] = true;
      data.remove('text');
      data.remove('storageObjectId');
      data.remove('imageUrl');
    }
    final mine = data['senderId'] == _uid;
    final type = (data['type'] ?? 'text').toString();
    final vipLevel = type == 'image'
        ? 0
        : ((data['vipLevel'] ?? data['senderVipLevel']) as num?)?.toInt() ?? 0;
    Widget content;
    EdgeInsets padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 9);
    if (type == 'deleted' || data['deletedForEveryone'] == true) {
      content = const Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.block_rounded, color: Colors.white54, size: 15),
          SizedBox(width: 7),
          Text('تم حذف هذه الرسالة',
              style: TextStyle(color: Colors.white70)),
        ],
      );
    } else if (type == 'image') {
      final objectId = (data['storageObjectId'] ?? '').toString().trim();
      final reviewStatus = (data['moderationStatus'] ?? '').toString().trim();
      final legacyUrl = (data['imageUrl'] ?? '').toString().trim();
      padding = const EdgeInsets.all(4);
      content = ClipRRect(
        borderRadius: BorderRadius.circular(15),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 240, maxHeight: 300),
          child: reviewStatus == 'pending' || reviewStatus == 'rejected'
              ? SizedBox(
                  width: 180,
                  height: 120,
                  child: Center(
                    child: Text(
                      reviewStatus == 'pending'
                          ? 'الصورة قيد المراجعة'
                          : 'تم رفض الصورة',
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ),
                )
              : objectId.isNotEmpty
                  ? _r2ChatImage(objectId)
              : legacyUrl.isNotEmpty
                  ? GestureDetector(
                      onTap: () => showDialog<void>(
                        context: context,
                        barrierColor: Colors.black87,
                        builder: (_) => Dialog(
                          backgroundColor: Colors.transparent,
                          insetPadding: const EdgeInsets.all(12),
                          child: InteractiveViewer(
                            child: Image.network(
                              legacyUrl,
                              fit: BoxFit.contain,
                            ),
                          ),
                        ),
                      ),
                      child: Image.network(
                        legacyUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => const SizedBox(
                          width: 180,
                          height: 120,
                          child: Center(
                            child: Icon(
                              Icons.broken_image_outlined,
                              color: Colors.white54,
                            ),
                          ),
                        ),
                      ),
                    )
                  : const SizedBox(
                      width: 180,
                      height: 120,
                      child: Center(
                        child: Icon(
                          Icons.broken_image_outlined,
                          color: Colors.white54,
                        ),
                      ),
                    ),
        ),
      );
    } else if (type == 'room_invite') {
      final roomId = (data['roomId'] ?? '').toString();
      final roomName = (data['roomName'] ?? 'غرفة صوتية').toString();
      final publicId = (data['roomPublicId'] ?? '').toString();
      content = Container(
        width: 230,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: const Color(0xFF111522),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: const Color(0xFF8A3DFF).withValues(alpha: .55),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(
                  Icons.graphic_eq_rounded,
                  color: Color(0xFFFFD54A),
                ),
                SizedBox(width: 7),
                Text(
                  'دعوة إلى غرفة صوتية',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              roomName,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w900,
              ),
            ),
            if (publicId.isNotEmpty) ...[
              const SizedBox(height: 3),
              Text(
                'ID: ' + publicId,
                style: const TextStyle(
                  color: Colors.white54,
                  fontSize: 10,
                ),
              ),
            ],
            const SizedBox(height: 10),
            SizedBox(
              width: double.infinity,
              child: FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                future: roomId.isEmpty
                    ? null
                    : FirebaseFirestore.instance.collection('rooms').doc(roomId).get(),
                builder: (_, roomSnapshot) {
                  final roomData = roomSnapshot.data?.data();
                  final active = roomSnapshot.data?.exists == true &&
                      roomData != null &&
                      roomData['isActive'] != false;
                  return FilledButton.icon(
                    onPressed: active ? () => _openRoomInvite(data) : null,
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF6D27D9),
                      foregroundColor: Colors.white,
                    ),
                    icon: Icon(active ? Icons.login_rounded : Icons.block_rounded, size: 18),
                    label: Text(active ? 'دخول الغرفة' : 'الغرفة غير متاحة'),
                  );
                },
              ),
            ),
          ],
        ),
      );
    } else if (type == 'animated_emoji') {
      padding = const EdgeInsets.symmetric(horizontal: 10, vertical: 6);
      content = AnimatedEmojiVisual(
        emojiId: (data['animatedEmojiId'] ?? '').toString(),
        assetKey: (data['animatedEmojiAssetKey'] ?? '').toString(),
        size: 78,
      );
    } else if (type == 'gift') {
      content = Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(width: 48, height: 48, child: _giftImage({'imageUrl': data['imageUrl'], 'assetKey': data['assetKey'], 'giftId': data['giftId']})),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text((data['giftName'] ?? 'هدية').toString(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900)),
              Text('×' + ((data['quantity'] as num?)?.toInt() ?? 1).toString(), style: const TextStyle(color: Color(0xFFFFD54A), fontWeight: FontWeight.w900)),
            ],
          ),
        ],
      );
    } else {
      content = Text((data['text'] ?? '').toString(), style: const TextStyle(color: Colors.white, height: 1.35));
    }
    final cosmeticKey = type == 'gift'
        ? ((data['vipGiftVisualKey'] ?? '').toString().trim().isNotEmpty
            ? (data['vipGiftVisualKey'] ?? '').toString().trim()
            : VipCosmeticPolicy.giftVisualKey(vipLevel))
        : type == 'text'
            ? VipCosmeticPolicy.chatBubbleKey(vipLevel)
            : '';
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: () => _showMessageActions(doc),
        child: Container(
        constraints: const BoxConstraints(maxWidth: 300),
        margin: const EdgeInsets.only(bottom: 8),
        child: VipCosmeticSurface(
          assetKey: cosmeticKey,
          borderRadius: BorderRadius.circular(18),
          assetOpacity: type == 'gift' ? .28 : .34,
          fallbackDecoration: BoxDecoration(
            color: mine ? const Color(0xFF6D27D9) : const Color(0xFF151925),
          ),
          child: Padding(
            padding: padding,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                content,
                const SizedBox(height: 4),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (vipLevel > 0 && type != 'image') ...[
                      Icon(
                        Icons.workspace_premium_rounded,
                        size: 11,
                        color: VipCosmeticPolicy.nameColor(
                          vipLevel,
                          mine: mine,
                        ),
                      ),
                      const SizedBox(width: 4),
                    ],
                    Text(
                      _time(data['createdAt']),
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 9,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
        ),
      ),
    );
  }

  void _snack(String text) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
  }

  ImageProvider? _avatarProvider(Map<String, dynamic>? data) {
    final photo = (data?['profileImageUrl'] ?? widget.otherPhoto).toString().trim();
    final asset = (data?['profileAvatarAsset'] ?? '').toString().trim();
    if (photo.isNotEmpty) return NetworkImage(photo);
    if (asset.isNotEmpty) return AssetImage(asset);
    return null;
  }

  void _backToMessages() {
    final navigator = Navigator.of(context);
    // Preserve the page that opened the chat (and its minimized voice room).
    if (navigator.canPop()) {
      navigator.pop();
      return;
    }

    // A directly opened chat may have no previous route.
    navigator.pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => const MainShellScreen(initialNavIndex: 3),
      ),
    );
  }

  @override void dispose(){_storage.close();_chatImageLoads.clear();_controller.dispose();super.dispose();}
  String _time(dynamic value){if(value is! Timestamp)return '';final d=value.toDate();final hour=d.hour%12==0?12:d.hour%12;final minute=d.minute.toString().padLeft(2,'0');return '$hour:$minute ${d.hour>=12?'م':'ص'}';}
  void _openProfile()=>showQuickProfileSheet(context,userId:widget.otherUid);

  Widget _composer() => SafeArea(
        top: false,
        child: Container(
          padding: const EdgeInsets.fromLTRB(6, 8, 6, 10),
          decoration: const BoxDecoration(
            color: Color(0xFF0B0D16),
            border: Border(top: BorderSide(color: Colors.white10)),
          ),
          child: Row(
            children: [
              IconButton(
                tooltip: 'هدية',
                onPressed: _sending ? null : _openGiftPicker,
                color: const Color(0xFFFFD54A),
                icon: const Icon(Icons.card_giftcard_rounded),
              ),
              IconButton(
                tooltip: 'صورة',
                onPressed: _sendingImage ? null : _sendImage,
                color: const Color(0xFFB78CFF),
                icon: _sendingImage
                    ? const SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.image_outlined),
              ),
              IconButton(
                tooltip: 'إيموجي متحرك',
                onPressed: _sending ? null : _pickAnimatedEmoji,
                color: _animatedEmojiId == null
                    ? Colors.white54
                    : const Color(0xFFFFD54A),
                icon: const Icon(Icons.sentiment_satisfied_alt_rounded),
              ),
              Expanded(
                child: TextField(
                  controller: _controller,
                  textInputAction: TextInputAction.send,
                  onSubmitted: (_) => _send(),
                  minLines: 1,
                  maxLines: 5,
                  maxLength: 2000,
                  buildCounter: (_, {required currentLength, required isFocused, maxLength}) => null,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'اكتب رسالة...',
                    hintStyle: const TextStyle(color: Colors.white38),
                    filled: true,
                    fillColor: const Color(0xFF151925),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(22),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                  ),
                ),
              ),
              const SizedBox(width: 6),
              IconButton.filled(
                onPressed: _sending ? null : _send,
                style: IconButton.styleFrom(
                  backgroundColor: const Color(0xFF7B2DFF),
                  foregroundColor: Colors.white,
                ),
                icon: _sending
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.send_rounded),
              ),
            ],
          ),
        ),
      );

  Widget _blockedComposer() => SafeArea(
        top: false,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          decoration: const BoxDecoration(
            color: Color(0xFF0B0D16),
            border: Border(top: BorderSide(color: Colors.white10)),
          ),
          child: Row(
            children: [
              const Icon(Icons.block_rounded, color: Colors.redAccent),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _safetyStatus.blockedByMe
                      ? 'لقد حظرت هذا المستخدم. الإرسال متوقف.'
                      : 'لا يمكن الإرسال في هذه المحادثة حالياً.',
                  style: const TextStyle(color: Colors.white70, fontWeight: FontWeight.w700),
                ),
              ),
              if (_safetyStatus.blockedByMe)
                TextButton(
                  onPressed: _changingBlock ? null : () => _setBlocked(false),
                  child: const Text('إلغاء الحظر'),
                ),
            ],
          ),
        ),
      );

  @override
  Widget build(BuildContext context) => StreamBuilder<User?>(
      stream: _authChanges,
      initialData: FirebaseAuth.instance.currentUser,
      builder: (context, authSnapshot) =>
          (authSnapshot.data?.isAnonymous ?? true) ||
                  authSnapshot.data?.uid != _openedByUid
      ? const Directionality(
          textDirection: TextDirection.rtl,
          child: Scaffold(
            backgroundColor: Colors.transparent,
            body: SafeArea(
              child: Center(child: Text('سجّل الدخول لفتح المحادثات',
                  style: TextStyle(color: Colors.white70))),
            ),
          ),
        )
      : Directionality(
        textDirection: TextDirection.rtl,
        child: WillPopScope(
          onWillPop: () async {
            _backToMessages();
            return false;
          },
          child: Scaffold(
            backgroundColor: Colors.transparent,
            appBar: AppBar(
              automaticallyImplyLeading: false,
              backgroundColor: const Color(0xFF0B0D16),
              foregroundColor: Colors.white,
              titleSpacing: 0,
              leading: IconButton(
                tooltip: 'الرجوع إلى الرسائل',
                onPressed: _backToMessages,
                icon: const Icon(Icons.arrow_forward_rounded),
              ),
              title: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
                stream: FirebaseFirestore.instance
                    .collection('public_profiles')
                    .doc(widget.otherUid)
                    .snapshots(),
                builder: (context, snapshot) {
                  final data = snapshot.data?.data();
                  final provider = _avatarProvider(data);
                  final name = (data?['displayName'] ?? widget.otherName).toString();
                  final currentVip =
                      data == null ? 0 : effectivePublicVipLevel(data);
                  return InkWell(
                    onTap: _openProfile,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        children: [
                          ProfileAvatarWithFrame(
                            diameter: 38,
                            userId: widget.otherUid,
                            fallbackProfile:
                                data ?? const <String, dynamic>{},
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                                color: VipCosmeticPolicy.nameColor(
                                  currentVip,
                                  mine: false,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
              actions: [
                PopupMenuButton<String>(
                  enabled: !_changingBlock && !_loadingSafety,
                  icon: const Icon(Icons.more_vert_rounded),
                  color: const Color(0xFF171C2A),
                  onSelected: (value) {
                    if (value == 'block') {
                      _confirmBlock(_safetyStatus.blockedByMe);
                    } else if (value == 'report') {
                      _reportUser();
                    }
                  },
                  itemBuilder: (_) => [
                    PopupMenuItem(
                      value: 'block',
                      child: Row(
                        children: [
                          Icon(
                            _safetyStatus.blockedByMe
                                ? Icons.lock_open_rounded
                                : Icons.block_rounded,
                            color: _safetyStatus.blockedByMe
                                ? const Color(0xFF7ADFA3)
                                : Colors.redAccent,
                          ),
                          const SizedBox(width: 10),
                          Text(
                            _safetyStatus.blockedByMe
                                ? 'إلغاء الحظر'
                                : 'حظر المستخدم',
                            style: const TextStyle(color: Colors.white),
                          ),
                        ],
                      ),
                    ),
                    const PopupMenuItem(
                      value: 'report',
                      child: Row(
                        children: [
                          Icon(Icons.flag_outlined, color: Color(0xFFFFB74D)),
                          SizedBox(width: 10),
                          Text('إبلاغ عن المستخدم', style: TextStyle(color: Colors.white)),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
            body: Column(
              children: [
                Expanded(
                  child: RepaintBoundary(
                    key: _reportSnapshotKey,
                    child: ShadowGlobalWallpaper(
                    key: const ValueKey('private-chat-interior-wallpaper'),
                    assetKey: ShadowAssetKeys.chatWallpaper,
                    bundledAsset: ShadowAssetKeys.chatWallpaperBundledPath,
                    scrimColor: const Color(0x4405060D),
                    child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                    stream: _messageChanges,
                    builder: (context, snapshot) {
                      if (snapshot.hasError) {
                        return const Center(
                          child: Text('تعذر تحميل الرسائل', style: TextStyle(color: Colors.white60)),
                        );
                      }
                      if (!snapshot.hasData) {
                        return const Center(
                          child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
                        );
                      }
                      WidgetsBinding.instance.addPostFrameCallback((_) => _markRead());
                      final liveDocs = snapshot.data!.docs;
                      final docs = _combinedMessages(liveDocs);
                      if (docs.isEmpty) {
                        return const Center(
                          child: Text('ابدأ المحادثة برسالة 👋', style: TextStyle(color: Colors.white54)),
                        );
                      }
                      final canLoadOlder = _historyCursor == null
                          ? liveDocs.length == 100
                          : _historyHasMore;
                      return ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.all(14),
                        itemCount: docs.length + (canLoadOlder ? 1 : 0),
                        itemBuilder: (_, index) {
                          if (index == docs.length) {
                            return Center(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    if (_historyFailed)
                                      const Padding(
                                        padding: EdgeInsets.only(bottom: 8),
                                        child: Text(
                                          'تعذر تحميل الرسائل الأقدم. حاول مجددًا.',
                                          style: TextStyle(color: Colors.white70),
                                        ),
                                      ),
                                    OutlinedButton.icon(
                                      onPressed: _historyLoading
                                          ? null
                                          : () => _loadOlderMessages(liveDocs),
                                      icon: _historyLoading
                                          ? const SizedBox(
                                              width: 16,
                                              height: 16,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                              ),
                                            )
                                          : const Icon(Icons.history_rounded),
                                      label: Text(_historyLoading
                                          ? 'جارٍ تحميل الرسائل...'
                                          : 'عرض رسائل أقدم'),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          }
                          return _messageBubble(docs[index]);
                        },
                      );
                    },
                    ),
                  ),
                  ),
                ),
                if (_loadingSafety)
                  const SafeArea(
                    top: false,
                    child: Padding(
                      padding: EdgeInsets.symmetric(vertical: 14),
                      child: Center(
                        child: SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    ),
                  )
                else if (_safetyStatus.blocked)
                  _blockedComposer()
                else
                  _composer(),
              ],
            ),
          ),
        ),
      ),
    );
}
