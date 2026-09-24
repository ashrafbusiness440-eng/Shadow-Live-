import 'dart:convert';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:image_picker/image_picker.dart';

import '../../../core/assets/shadow_asset_registry.dart';
import '../../gift/services/gift_catalog_service.dart';
import '../../../services/navigation_service.dart';
import '../../main/screens/main_shell_screen.dart';
import '../../profile/services/follow_service.dart';
import '../../profile/widgets/quick_profile_sheet.dart';
import '../services/chat_safety_service.dart';

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
  String? _sendingGiftId;

  String get _uid => FirebaseAuth.instance.currentUser!.uid;
  DocumentReference<Map<String, dynamic>> get _conversation => FirebaseFirestore.instance.collection('conversations').doc(widget.conversationId);

  @override
  void initState() {
    super.initState();
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

  Future<void> _markRead() async {if (_markingRead) return;_markingRead = true;try {await _conversation.update({'unreadCounts.$_uid': 0});} catch (_) {} finally {_markingRead = false;}}

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending || text.length > 2000) return;
    setState(() => _sending = true);
    try {
      final token = await FirebaseAuth.instance.currentUser?.getIdToken();
      if (token == null || token.isEmpty) throw StateError('not_signed_in');
      final key = [_uid, DateTime.now().microsecondsSinceEpoch.toString(), 'text'].join('_');
      final response = await http.post(
        Uri.parse('$_apiBase/chat-actions'),
        headers: {'authorization': 'Bearer ' + token, 'content-type': 'application/json'},
        body: jsonEncode({
          'action': 'sendMessage',
          'receiverId': widget.otherUid,
          'conversationId': widget.conversationId,
          'text': text,
          'idempotencyKey': key,
        }),
      );
      Map<String, dynamic> body = <String, dynamic>{};
      try {
        final decoded = jsonDecode(response.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {}
      if (response.statusCode == 200 && body['ok'] == true) {
        _controller.clear();
        return;
      }
      switch (body['code']) {
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
        default:
          _snack('تعذر إرسال الرسالة حالياً.');
      }
    } catch (_) {
      _snack('تعذر إرسال الرسالة حالياً.');
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
                        await _safety.reportUser(
                          targetUserId: widget.otherUid,
                          conversationId: widget.conversationId,
                          reason: reason,
                          details: detailsController.text.trim(),
                        );
                        if (dialogContext.mounted) Navigator.pop(dialogContext);
                        _snack('تم إرسال البلاغ للمراجعة.');
                      } on StateError catch (error) {
                        if (error.message == 'rate_limited') {
                          _snack('تم إرسال عدة بلاغات مؤخرًا. حاول لاحقًا.');
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

  Future<bool> _storageReady() async {
    try {
      final response = await http.get(
        Uri.parse('$_apiBase/storage-health'),
      );
      if (response.statusCode != 200) return false;
      final body = jsonDecode(response.body);
      return body is Map<String, dynamic> && body['ok'] == true;
    } catch (_) {
      return false;
    }
  }

  Future<void> _sendImage() async {
    if (_sendingImage) return;
    final mutual = await _follow.isMutual(widget.otherUid);
    if (!mutual) {
      _snack('إرسال الصور متاح فقط عند وجود متابعة متبادلة بينكما.');
      return;
    }
    if (!await _storageReady()) {
      _snack('إرسال الصور جاهز، لكن Firebase Storage غير مفعّل على المشروع حالياً.');
      return;
    }
    final picked = await _picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1920,
      maxHeight: 1920,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    if (bytes.isEmpty || bytes.length > 8 * 1024 * 1024) {
      _snack('حجم الصورة يجب أن يكون أقل من 8MB.');
      return;
    }
    setState(() => _sendingImage = true);
    Reference? uploaded;
    try {
      final messageRef = _conversation.collection('messages').doc();
      final mime = picked.mimeType ?? 'image/jpeg';
      final ext = mime.contains('png') ? 'png' : mime.contains('webp') ? 'webp' : 'jpg';
      final path = [
        'chat_images',
        widget.conversationId,
        _uid,
        widget.otherUid,
        messageRef.id + '.' + ext,
      ].join('/');
      uploaded = FirebaseStorage.instance.ref(path);
      await uploaded.putData(
        bytes,
        SettableMetadata(
          contentType: mime,
          customMetadata: {
            'conversationId': widget.conversationId,
            'senderUid': _uid,
            'receiverUid': widget.otherUid,
          },
        ),
      );
      final imageUrl = await uploaded.getDownloadURL();
      final batch = FirebaseFirestore.instance.batch();
      batch.update(_conversation, {
        'lastMessage': '📷 صورة',
        'lastSenderId': _uid,
        'updatedAt': FieldValue.serverTimestamp(),
        'unreadCounts.' + _uid: 0,
        'unreadCounts.' + widget.otherUid: FieldValue.increment(1),
      });
      batch.set(messageRef, {
        'senderId': _uid,
        'receiverId': widget.otherUid,
        'type': 'image',
        'imageUrl': imageUrl,
        'storagePath': uploaded.fullPath,
        'createdAt': FieldValue.serverTimestamp(),
      });
      await batch.commit();
    } on FirebaseException catch (error) {
      if (uploaded != null) {
        try { await uploaded.delete(); } catch (_) {}
      }
      if (error.code == 'unauthorized' || error.code == 'permission-denied') {
        _snack('إرسال الصور يحتاج متابعة متبادلة وصلاحية التخزين.');
      } else {
        _snack('تعذر رفع الصورة حالياً.');
      }
    } catch (_) {
      if (uploaded != null) {
        try { await uploaded.delete(); } catch (_) {}
      }
      _snack('تعذر إرسال الصورة.');
    } finally {
      if (mounted) setState(() => _sendingImage = false);
    }
  }

  Future<void> _openGiftPicker() async {
    List<GiftCatalogItem> gifts;
    try {
      gifts = await GiftCatalogService.watchCatalog().first;
    } catch (_) {
      _snack('تعذر تحميل الهدايا حالياً.');
      return;
    }
    if (!mounted) return;
    var quantity = 1;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF0C101A),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(26)),
      ),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) => SafeArea(
            child: SizedBox(
              height: MediaQuery.of(context).size.height * .68,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
                child: Column(
                  children: [
                    Container(
                      width: 44,
                      height: 4,
                      decoration: BoxDecoration(
                        color: Colors.white24,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 14),
                    const Row(
                      children: [
                        Icon(
                          Icons.card_giftcard_rounded,
                          color: Color(0xFFFFD54A),
                        ),
                        SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'إرسال هدية',
                            style: TextStyle(
                              color: Colors.white,
                              fontSize: 21,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      children: [1, 7, 77, 777]
                          .map(
                            (value) => ChoiceChip(
                              label: Text('×' + value.toString()),
                              selected: quantity == value,
                              onSelected: (_) =>
                                  setSheetState(() => quantity = value),
                              selectedColor: const Color(0xFF7B2DFF),
                              labelStyle: TextStyle(
                                color: quantity == value
                                    ? Colors.white
                                    : Colors.white70,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          )
                          .toList(),
                    ),
                    const SizedBox(height: 12),
                    Expanded(
                      child: gifts.isEmpty
                          ? const Center(
                              child: Text(
                                'لا توجد هدايا مفعلة حالياً',
                                style: TextStyle(color: Colors.white54),
                              ),
                            )
                          : GridView.builder(
                              gridDelegate:
                                  const SliverGridDelegateWithFixedCrossAxisCount(
                                crossAxisCount: 3,
                                crossAxisSpacing: 10,
                                mainAxisSpacing: 10,
                                childAspectRatio: .78,
                              ),
                              itemCount: gifts.length,
                              itemBuilder: (_, index) {
                                final gift = gifts[index];
                                final busy = _sendingGiftId == gift.id;
                                return InkWell(
                                  borderRadius: BorderRadius.circular(18),
                                  onTap: busy
                                      ? null
                                      : () async {
                                          final ok = await _sendGift(
                                            giftId: gift.id,
                                            quantity: quantity,
                                          );
                                          if (ok && sheetContext.mounted) {
                                            Navigator.pop(sheetContext);
                                          }
                                        },
                                  child: Container(
                                    padding: const EdgeInsets.all(9),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF121725),
                                      borderRadius: BorderRadius.circular(18),
                                      border: Border.all(color: Colors.white10),
                                    ),
                                    child: Column(
                                      children: [
                                        Expanded(
                                          child: _giftImage(
                                            <String, dynamic>{
                                              'assetKey': gift.assetKey,
                                              'giftId': gift.id,
                                            },
                                          ),
                                        ),
                                        const SizedBox(height: 5),
                                        Text(
                                          gift.nameAr,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            color: Colors.white,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w800,
                                          ),
                                        ),
                                        const SizedBox(height: 3),
                                        Text(
                                          '🪙 ' +
                                              (gift.priceCoins * quantity)
                                                  .toString(),
                                          style: const TextStyle(
                                            color: Color(0xFFFFD54A),
                                            fontSize: 11,
                                            fontWeight: FontWeight.w900,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                );
                              },
                            ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Future<bool> _sendGift({required String giftId, required int quantity}) async {
    if (_sendingGiftId != null) return false;
    setState(() => _sendingGiftId = giftId);
    try {
      final token = await FirebaseAuth.instance.currentUser?.getIdToken();
      if (token == null || token.isEmpty) throw StateError('not_signed_in');
      final key = [_uid, DateTime.now().microsecondsSinceEpoch.toString(), giftId].join('_');
      final response = await http.post(
        Uri.parse('$_apiBase/chat-actions'),
        headers: {'authorization': 'Bearer ' + token, 'content-type': 'application/json'},
        body: jsonEncode({
          'action': 'sendGift',
          'receiverId': widget.otherUid,
          'giftId': giftId,
          'quantity': quantity,
          'conversationId': widget.conversationId,
          'idempotencyKey': key,
        }),
      );
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode == 200 && body['ok'] == true) return true;
      if (body['code'] == 'insufficient_balance') {
        _snack('رصيد العملات غير كافٍ لإرسال الهدية.');
      } else if (body['code'] == 'blocked') {
        _snack('لا يمكن إرسال هدية بينكما حالياً بسبب إعدادات الحظر.');
      } else {
        _snack('تعذر إرسال الهدية حالياً.');
      }
      return false;
    } catch (_) {
      _snack('تعذر إرسال الهدية حالياً.');
      return false;
    } finally {
      if (mounted) setState(() => _sendingGiftId = null);
    }
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

  Widget _messageBubble(Map<String, dynamic> data) {
    final mine = data['senderId'] == _uid;
    final type = (data['type'] ?? 'text').toString();
    Widget content;
    EdgeInsets padding = const EdgeInsets.symmetric(horizontal: 14, vertical: 9);
    if (type == 'image') {
      final url = (data['imageUrl'] ?? '').toString();
      padding = const EdgeInsets.all(4);
      content = GestureDetector(
        onTap: url.isEmpty ? null : () => showDialog<void>(
          context: context,
          barrierColor: Colors.black87,
          builder: (_) => Dialog(
            backgroundColor: Colors.transparent,
            insetPadding: const EdgeInsets.all(12),
            child: InteractiveViewer(child: Image.network(url, fit: BoxFit.contain)),
          ),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(15),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 240, maxHeight: 300),
            child: Image.network(
              url,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => const SizedBox(
                width: 180,
                height: 120,
                child: Center(child: Icon(Icons.broken_image_outlined, color: Colors.white54)),
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
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: const BoxConstraints(maxWidth: 300),
        margin: const EdgeInsets.only(bottom: 8),
        padding: padding,
        decoration: BoxDecoration(
          color: mine ? const Color(0xFF6D27D9) : const Color(0xFF151925),
          borderRadius: BorderRadius.circular(18),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            content,
            const SizedBox(height: 4),
            Text(_time(data['createdAt']), style: const TextStyle(color: Colors.white54, fontSize: 9)),
          ],
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
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const MainShellScreen(initialNavIndex: 4)),
      (_) => false,
    );
  }

  @override void dispose(){_controller.dispose();super.dispose();}
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
                onPressed: _sendingGiftId != null ? null : _openGiftPicker,
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
              Expanded(
                child: TextField(
                  controller: _controller,
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
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: WillPopScope(
          onWillPop: () async {
            _backToMessages();
            return false;
          },
          child: Scaffold(
            backgroundColor: const Color(0xFF05060D),
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
                  return InkWell(
                    onTap: _openProfile,
                    borderRadius: BorderRadius.circular(12),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(vertical: 5),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 19,
                            backgroundColor: const Color(0xFF25183F),
                            backgroundImage: provider,
                            child: provider == null
                                ? const Icon(Icons.person, color: Color(0xFFFFD54A), size: 21)
                                : null,
                          ),
                          const SizedBox(width: 10),
                          Expanded(
                            child: Text(
                              name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
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
                  child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                    stream: _conversation
                        .collection('messages')
                        .orderBy('createdAt', descending: true)
                        .limit(100)
                        .snapshots(),
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
                      final docs = snapshot.data!.docs;
                      if (docs.isEmpty) {
                        return const Center(
                          child: Text('ابدأ المحادثة برسالة 👋', style: TextStyle(color: Colors.white54)),
                        );
                      }
                      return ListView.builder(
                        reverse: true,
                        padding: const EdgeInsets.all(14),
                        itemCount: docs.length,
                        itemBuilder: (_, index) => _messageBubble(docs[index].data()),
                      );
                    },
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
      );
}
