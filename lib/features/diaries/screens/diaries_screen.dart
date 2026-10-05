import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../../../shared/services/user_storage_service.dart';
import '../../profile/screens/public_profile_screen.dart';
import '../services/diary_service.dart';
import '../widgets/diary_comments_sheet.dart';
import '../widgets/diary_gifts_sheet.dart';

class DiariesScreen extends StatefulWidget {
  const DiariesScreen({
    super.key,
    this.title = 'يومياتي',
    this.onGuestAction,
  });

  final String title;
  final Future<void> Function()? onGuestAction;

  @override
  State<DiariesScreen> createState() => _DiariesScreenState();
}

class _PickedDiaryImage {
  const _PickedDiaryImage({
    required this.file,
    required this.bytes,
  });

  final XFile file;
  final Uint8List bytes;
}

class _DiariesScreenState extends State<DiariesScreen> {
  final DiaryService _service = DiaryService();
  final UserStorageService _storage = UserStorageService();
  final ImagePicker _picker = ImagePicker();
  final TextEditingController _text = TextEditingController();

  List<DiaryItem> _latest = const <DiaryItem>[];
  List<DiaryItem> _following = const <DiaryItem>[];
  String? _latestCursor;
  String? _followingCursor;
  bool _latestHasMore = true;
  bool _followingHasMore = true;
  bool _loadingLatest = false;
  bool _loadingFollowing = false;
  Object? _latestError;
  Object? _followingError;

  bool _showFollowing = false;
  bool _publishing = false;
  bool _commentsEnabled = true;
  List<_PickedDiaryImage> _pickedImages = const <_PickedDiaryImage>[];
  final Set<String> _likedDiaryIds = <String>{};
  final Set<String> _busyLikeIds = <String>{};
  final Set<String> _viewRecordedThisSession = <String>{};

  bool get _guest => FirebaseAuth.instance.currentUser?.isAnonymous == true;
  bool get _signedIn => FirebaseAuth.instance.currentUser != null;
  List<DiaryItem> get _items => _showFollowing ? _following : _latest;
  bool get _loading => _showFollowing ? _loadingFollowing : _loadingLatest;
  bool get _hasMore => _showFollowing ? _followingHasMore : _latestHasMore;
  Object? get _error => _showFollowing ? _followingError : _latestError;

  @override
  void initState() {
    super.initState();
    _load(reset: true, following: false);
  }

  @override
  void dispose() {
    _text.dispose();
    _service.close();
    _storage.close();
    super.dispose();
  }

  Future<void> _guestAction() async {
    if (widget.onGuestAction != null) {
      await widget.onGuestAction!();
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('سجّل الدخول لاستخدام هذه الميزة.')),
    );
  }

  Future<void> _load({
    required bool reset,
    bool? following,
  }) async {
    final targetFollowing = following ?? _showFollowing;
    if (targetFollowing && _guest) return;

    if (targetFollowing ? _loadingFollowing : _loadingLatest) return;
    setState(() {
      if (targetFollowing) {
        _loadingFollowing = true;
        if (reset) _followingError = null;
      } else {
        _loadingLatest = true;
        if (reset) _latestError = null;
      }
    });

    try {
      final cursor = reset
          ? null
          : (targetFollowing ? _followingCursor : _latestCursor);
      final page = targetFollowing
          ? await _service.listFollowing(cursor: cursor)
          : await _service.listLatest(cursor: cursor);

      if (!mounted) return;
      setState(() {
        if (targetFollowing) {
          _following = _merge(
            reset ? const <DiaryItem>[] : _following,
            page.items,
          );
          _followingCursor = page.nextCursor;
          _followingHasMore = page.hasMore;
          _followingError = null;
        } else {
          _latest = _merge(
            reset ? const <DiaryItem>[] : _latest,
            page.items,
          );
          _latestCursor = page.nextCursor;
          _latestHasMore = page.hasMore;
          _latestError = null;
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        if (targetFollowing) {
          _followingError = error;
        } else {
          _latestError = error;
        }
      });
    } finally {
      if (mounted) {
        setState(() {
          if (targetFollowing) {
            _loadingFollowing = false;
          } else {
            _loadingLatest = false;
          }
        });
      }
    }
  }

  List<DiaryItem> _merge(List<DiaryItem> current, List<DiaryItem> next) {
    final map = <String, DiaryItem>{
      for (final item in current) item.diaryId: item,
      for (final item in next) item.diaryId: item,
    };
    final merged = map.values.toList(growable: false);
    merged.sort((a, b) {
      final time = b.createdAtMs.compareTo(a.createdAtMs);
      if (time != 0) return time;
      return b.diaryId.compareTo(a.diaryId);
    });
    return merged;
  }

  Future<void> _selectFeed(bool following) async {
    if (following && _guest) {
      await _guestAction();
      return;
    }
    if (_showFollowing == following) return;
    setState(() => _showFollowing = following);
    if (following && _following.isEmpty && _followingError == null) {
      await _load(reset: true, following: true);
    }
  }

  Future<void> _pickImages() async {
    if (_guest) {
      await _guestAction();
      return;
    }
    try {
      final files = await _picker.pickMultiImage();
      if (files.isEmpty) return;
      final selected = <_PickedDiaryImage>[];
      for (final file in files.take(2)) {
        selected.add(
          _PickedDiaryImage(
            file: file,
            bytes: await file.readAsBytes(),
          ),
        );
      }
      if (!mounted) return;
      setState(() => _pickedImages = selected);
      if (files.length > 2) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('يمكن إضافة صورتين كحد أقصى.')),
        );
      }
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تعذر اختيار الصور. حاول مرة أخرى.')),
      );
    }
  }

  void _removeImage(int index) {
    if (index < 0 || index >= _pickedImages.length) return;
    final next = [..._pickedImages]..removeAt(index);
    setState(() => _pickedImages = next);
  }

  Future<void> _publish() async {
    if (_guest || !_signedIn) {
      await _guestAction();
      return;
    }
    if (_publishing) return;

    final text = _text.text.trim();
    if (text.isEmpty && _pickedImages.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('اكتب نصاً أو أضف صورة قبل النشر.')),
      );
      return;
    }
    if (text.length > 500) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('الحد الأقصى للنص 500 حرف.')),
      );
      return;
    }

    setState(() => _publishing = true);
    try {
      final objectIds = <String>[];
      for (final picked in _pickedImages) {
        final mimeType = detectSupportedImageMime(picked.bytes);
        final uploaded = await _storage.upload(
          scope: 'diary_image',
          bytes: picked.bytes,
          mimeType: mimeType,
        );
        if (uploaded.objectId.trim().isEmpty) {
          throw StateError('storage_confirm_invalid');
        }
        objectIds.add(uploaded.objectId.trim());
      }

      await _service.createDiary(
        text: text,
        imageObjectIds: objectIds,
        commentsEnabled: _commentsEnabled,
      );

      if (!mounted) return;
      _text.clear();
      setState(() {
        _pickedImages = const <_PickedDiaryImage>[];
        _commentsEnabled = true;
        _showFollowing = false;
      });
      await _load(reset: true, following: false);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم نشر اليومية.')),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(diaryErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _publishing = false);
    }
  }

  void _replaceDiary(
    String diaryId,
    DiaryItem Function(DiaryItem item) update,
  ) {
    setState(() {
      _latest = _latest
          .map((item) => item.diaryId == diaryId ? update(item) : item)
          .toList(growable: false);
      _following = _following
          .map((item) => item.diaryId == diaryId ? update(item) : item)
          .toList(growable: false);
    });
  }

  Future<void> _toggleLike(DiaryItem item) async {
    if (_guest || !_signedIn) {
      await _guestAction();
      return;
    }
    if (_busyLikeIds.contains(item.diaryId)) return;
    setState(() => _busyLikeIds.add(item.diaryId));
    try {
      final result = await _service.toggleLike(item.diaryId);
      if (!mounted) return;
      setState(() {
        if (result.liked) {
          _likedDiaryIds.add(item.diaryId);
        } else {
          _likedDiaryIds.remove(item.diaryId);
        }
      });
      _replaceDiary(
        item.diaryId,
        (current) => current.copyWith(likeCount: result.likeCount),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(diaryErrorMessage(error))),
      );
    } finally {
      if (mounted) setState(() => _busyLikeIds.remove(item.diaryId));
    }
  }

  Future<void> _recordView(DiaryItem item) async {
    if (!_signedIn || _viewRecordedThisSession.contains(item.diaryId)) return;
    _viewRecordedThisSession.add(item.diaryId);
    try {
      final result = await _service.recordView(item.diaryId);
      if (!mounted) return;
      _replaceDiary(
        item.diaryId,
        (current) => current.copyWith(viewCount: result.viewCount),
      );
    } catch (_) {
      _viewRecordedThisSession.remove(item.diaryId);
    }
  }

  Future<void> _openComments(DiaryItem item) async {
    await _recordView(item);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF080B12),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => DiaryCommentsSheet(
        diary: item,
        service: _service,
        onGuestAction: _guestAction,
        onCommentCountChanged: (count) {
          if (!mounted) return;
          _replaceDiary(
            item.diaryId,
            (current) => current.copyWith(commentCount: count),
          );
        },
      ),
    );
  }

  Future<void> _openGifts(DiaryItem item) async {
    await _recordView(item);
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF080B12),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => DiaryGiftsSheet(
        diary: item,
        service: _service,
        onGuestAction: _guestAction,
        onGiftTotalsChanged: (giftCount, giftCoins) {
          if (!mounted) return;
          _replaceDiary(
            item.diaryId,
            (current) => current.copyWith(
              giftCount: giftCount,
              giftCoins: giftCoins,
            ),
          );
        },
      ),
    );
  }

  Future<void> _openImage(
    DiaryItem item,
    DiaryImageItem image,
  ) async {
    await _recordView(item);
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      barrierColor: Colors.black.withValues(alpha: .92),
      builder: (dialogContext) => Dialog.fullscreen(
        backgroundColor: Colors.black,
        child: SafeArea(
          child: Stack(
            children: [
              Positioned.fill(
                child: InteractiveViewer(
                  minScale: .8,
                  maxScale: 4,
                  child: Center(
                    child: Image.network(
                      image.publicUrl,
                      fit: BoxFit.contain,
                      errorBuilder: (_, __, ___) => _imageError(),
                    ),
                  ),
                ),
              ),
              Positioned(
                top: 8,
                left: 8,
                child: IconButton.filledTonal(
                  onPressed: () => Navigator.pop(dialogContext),
                  icon: const Icon(Icons.close_rounded),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _timeLabel(int createdAtMs) {
    if (createdAtMs <= 0) return '';
    final now = DateTime.now();
    final created = DateTime.fromMillisecondsSinceEpoch(createdAtMs);
    final diff = now.difference(created);
    if (diff.inMinutes < 1) return 'الآن';
    if (diff.inMinutes < 60) return 'منذ ${diff.inMinutes} د';
    if (diff.inHours < 24) return 'منذ ${diff.inHours} س';
    if (diff.inDays < 7) return 'منذ ${diff.inDays} ي';
    return '${created.day}/${created.month}/${created.year}';
  }

  ImageProvider<Object>? _avatar(DiaryItem item) {
    if (item.ownerProfileImageUrl.isNotEmpty) {
      return NetworkImage(item.ownerProfileImageUrl);
    }
    if (item.ownerProfileAvatarAsset.isNotEmpty) {
      return AssetImage(item.ownerProfileAvatarAsset);
    }
    return null;
  }

  void _openProfile(DiaryItem item) {
    if (item.ownerUid.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(userId: item.ownerUid),
      ),
    );
  }

  Widget _composer() {
    if (_guest || !_signedIn) {
      return Container(
        margin: const EdgeInsets.fromLTRB(14, 12, 14, 8),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF101522),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: const Color(0xFF7B2DFF).withValues(alpha: .35),
          ),
        ),
        child: Column(
          children: [
            const Row(
              children: [
                Icon(Icons.visibility_rounded, color: Color(0xFFFFD54A)),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'يمكنك مشاهدة اليوميات العامة كضيف',
                    style: TextStyle(
                      color: Colors.white,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            const Text(
              'للنشر والتفاعل والمتابعة، أنشئ حساباً أو سجّل الدخول.',
              style: TextStyle(color: Colors.white60, height: 1.5),
            ),
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: _guestAction,
                style: FilledButton.styleFrom(
                  backgroundColor: const Color(0xFF7B2DFF),
                ),
                icon: const Icon(Icons.login_rounded),
                label: const Text('تسجيل الدخول'),
              ),
            ),
          ],
        ),
      );
    }

    return Container(
      margin: const EdgeInsets.fromLTRB(14, 12, 14, 8),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF101522),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: .08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'شو حابب تشارك اليوم؟',
            style: TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _text,
            enabled: !_publishing,
            maxLength: 500,
            minLines: 2,
            maxLines: 6,
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              hintText: 'اكتب يوميتك...',
              hintStyle: const TextStyle(color: Colors.white38),
              counterStyle: const TextStyle(color: Colors.white38),
              filled: true,
              fillColor: const Color(0xFF090C14),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          if (_pickedImages.isNotEmpty) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                for (var i = 0; i < _pickedImages.length; i++)
                  Expanded(
                    child: Padding(
                      padding: EdgeInsets.only(
                        left: i == 0 && _pickedImages.length > 1 ? 6 : 0,
                      ),
                      child: Stack(
                        children: [
                          AspectRatio(
                            aspectRatio: 1,
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(14),
                              child: Image.memory(
                                _pickedImages[i].bytes,
                                fit: BoxFit.cover,
                              ),
                            ),
                          ),
                          Positioned(
                            top: 6,
                            left: 6,
                            child: Material(
                              color: Colors.black.withValues(alpha: .7),
                              shape: const CircleBorder(),
                              child: InkWell(
                                customBorder: const CircleBorder(),
                                onTap: _publishing
                                    ? null
                                    : () => _removeImage(i),
                                child: const Padding(
                                  padding: EdgeInsets.all(5),
                                  child: Icon(
                                    Icons.close_rounded,
                                    color: Colors.white,
                                    size: 18,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          ],
          const SizedBox(height: 10),
          Row(
            children: [
              OutlinedButton.icon(
                onPressed: _publishing ? null : _pickImages,
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFFFFD54A),
                  side: BorderSide(
                    color: Colors.white.withValues(alpha: .22),
                  ),
                ),
                icon: const Icon(Icons.photo_library_outlined),
                label: Text(
                  _pickedImages.isEmpty
                      ? 'إضافة صور'
                      : '${_pickedImages.length}/2',
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: const Text(
                    'السماح بالتعليقات',
                    style: TextStyle(color: Colors.white70, fontSize: 13),
                  ),
                  value: _commentsEnabled,
                  onChanged: _publishing
                      ? null
                      : (value) => setState(() => _commentsEnabled = value),
                ),
              ),
            ],
          ),
          const Text(
            'صورتان كحد أقصى • يتم ضغط الصور تلقائياً قبل الرفع',
            style: TextStyle(color: Colors.white38, fontSize: 11),
          ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: _publishing ? null : _publish,
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF7B2DFF),
              disabledBackgroundColor: const Color(0xFF30233F),
              padding: const EdgeInsets.symmetric(vertical: 13),
            ),
            icon: _publishing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.send_rounded),
            label: Text(_publishing ? 'جاري النشر...' : 'نشر اليومية'),
          ),
        ],
      ),
    );
  }

  Widget _feedSelector() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(14, 4, 14, 8),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: const Color(0xFF0E111A),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          children: [
            Expanded(
              child: _feedButton(
                label: 'الأحدث',
                selected: !_showFollowing,
                onTap: () => _selectFeed(false),
              ),
            ),
            const SizedBox(width: 4),
            Expanded(
              child: _feedButton(
                label: 'المتابَعون',
                selected: _showFollowing,
                onTap: () => _selectFeed(true),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _feedButton({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Material(
      color: selected ? const Color(0xFF7B2DFF) : Colors.transparent,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 10),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              color: selected ? Colors.white : Colors.white60,
              fontWeight: FontWeight.w900,
            ),
          ),
        ),
      ),
    );
  }

  Widget _diaryCard(DiaryItem item) {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 0, 14, 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFF0E121C),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: .07)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: () => _openProfile(item),
            child: Row(
              children: [
                CircleAvatar(
                  radius: 22,
                  backgroundColor: const Color(0xFF272C39),
                  backgroundImage: _avatar(item),
                  child: _avatar(item) == null
                      ? const Icon(Icons.person_rounded, color: Colors.white54)
                      : null,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.ownerName.isEmpty
                            ? 'مستخدم Shadow Live'
                            : item.ownerName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Row(
                        children: [
                          if (item.ownerPublicId.isNotEmpty) ...[
                            Text(
                              'ID: ${item.ownerPublicId}',
                              style: const TextStyle(
                                color: Colors.white38,
                                fontSize: 11,
                              ),
                            ),
                            const Text(
                              ' • ',
                              style: TextStyle(color: Colors.white30),
                            ),
                          ],
                          Text(
                            _timeLabel(item.createdAtMs),
                            style: const TextStyle(
                              color: Colors.white38,
                              fontSize: 11,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          if (item.text.trim().isNotEmpty) ...[
            const SizedBox(height: 12),
            Text(
              item.text,
              style: const TextStyle(
                color: Colors.white,
                height: 1.55,
                fontSize: 15,
              ),
            ),
          ],
          if (item.images.isNotEmpty) ...[
            const SizedBox(height: 12),
            _networkImages(item),
          ],
          const SizedBox(height: 12),
          Divider(color: Colors.white.withValues(alpha: .07), height: 1),
          const SizedBox(height: 10),
          Row(
            children: [
              _metric(
                _likedDiaryIds.contains(item.diaryId)
                    ? Icons.favorite_rounded
                    : Icons.favorite_border_rounded,
                item.likeCount,
                onTap: () => _toggleLike(item),
                active: _likedDiaryIds.contains(item.diaryId),
                busy: _busyLikeIds.contains(item.diaryId),
              ),
              _metric(
                item.commentsEnabled
                    ? Icons.chat_bubble_outline_rounded
                    : Icons.comments_disabled_outlined,
                item.commentCount,
                onTap: () => _openComments(item),
              ),
              _metric(
                Icons.card_giftcard_rounded,
                item.giftCount,
                onTap: () => _openGifts(item),
              ),
              const Spacer(),
              _metric(Icons.visibility_outlined, item.viewCount),
            ],
          ),
        ],
      ),
    );
  }

  Widget _networkImages(DiaryItem item) {
    final images = item.images;
    if (images.length == 1) {
      return InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () => _openImage(item, images.first),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(16),
          child: AspectRatio(
            aspectRatio: 4 / 3,
            child: Image.network(
              images.first.publicUrl,
              fit: BoxFit.cover,
              errorBuilder: (_, __, ___) => _imageError(),
            ),
          ),
        ),
      );
    }
    return Row(
      children: [
        for (var i = 0; i < images.take(2).length; i++)
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(left: i == 0 ? 6 : 0),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: () => _openImage(item, images[i]),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(14),
                  child: AspectRatio(
                    aspectRatio: 1,
                    child: Image.network(
                      images[i].publicUrl,
                      fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => _imageError(),
                    ),
                  ),
                ),
              ),
            ),
          ),
      ],
    );
  }

  Widget _imageError() {
    return const ColoredBox(
      color: Color(0xFF191D28),
      child: Center(
        child: Icon(Icons.broken_image_outlined, color: Colors.white30),
      ),
    );
  }

  Widget _metric(
    IconData icon,
    int value, {
    VoidCallback? onTap,
    bool active = false,
    bool busy = false,
  }) {
    final content = Padding(
      padding: const EdgeInsetsDirectional.only(end: 16),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (busy)
            const SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(strokeWidth: 2),
            )
          else
            Icon(
              icon,
              size: 18,
              color: active ? const Color(0xFFFF5B73) : Colors.white38,
            ),
          const SizedBox(width: 4),
          Text(
            _compact(value),
            style: TextStyle(
              color: active ? const Color(0xFFFF8A9B) : Colors.white38,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
    if (onTap == null) return content;
    return InkWell(
      borderRadius: BorderRadius.circular(18),
      onTap: busy ? null : onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 5),
        child: content,
      ),
    );
  }

  String _compact(int value) {
    if (value >= 1000000) {
      final number = value / 1000000;
      return '${number.toStringAsFixed(number >= 10 ? 0 : 1)}M';
    }
    if (value >= 1000) {
      final number = value / 1000;
      return '${number.toStringAsFixed(number >= 10 ? 0 : 1)}K';
    }
    return value.toString();
  }

  Widget _feedBody() {
    if (_showFollowing && _guest) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Icon(
              Icons.people_alt_outlined,
              size: 48,
              color: Colors.white30,
            ),
            const SizedBox(height: 12),
            const Text(
              'سجّل الدخول لمشاهدة يوميات الأشخاص الذين تتابعهم.',
              textAlign: TextAlign.center,
              style: TextStyle(color: Colors.white60, height: 1.5),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _guestAction,
              child: const Text('تسجيل الدخول'),
            ),
          ],
        ),
      );
    }

    if (_items.isEmpty && _loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
        ),
      );
    }
    if (_items.isEmpty && _error != null) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
        child: Column(
          children: [
            const Icon(
              Icons.cloud_off_rounded,
              color: Colors.white30,
              size: 44,
            ),
            const SizedBox(height: 12),
            Text(
              diaryErrorMessage(_error!),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white60),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: () => _load(reset: true),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 48),
        child: Center(
          child: Text(
            _showFollowing
                ? 'ما في يوميات جديدة من الأشخاص اللي بتتابعهم.'
                : 'ما في يوميات منشورة لسه.',
            style: const TextStyle(color: Colors.white54),
          ),
        ),
      );
    }

    return Column(
      children: [
        for (final item in _items) _diaryCard(item),
        if (_hasMore)
          Padding(
            padding: const EdgeInsets.fromLTRB(14, 2, 14, 24),
            child: SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: _loading ? null : () => _load(reset: false),
                child: _loading
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('تحميل المزيد'),
              ),
            ),
          )
        else
          const SizedBox(height: 20),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            color: const Color(0xFF8A3DFF),
            onRefresh: () => _load(reset: true),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 2),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          widget.title,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: 'تحديث',
                        onPressed: _loading ? null : () => _load(reset: true),
                        icon: const Icon(
                          Icons.refresh_rounded,
                          color: Colors.white70,
                        ),
                      ),
                    ],
                  ),
                ),
                _composer(),
                _feedSelector(),
                _feedBody(),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
