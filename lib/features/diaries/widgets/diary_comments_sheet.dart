import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../profile/screens/public_profile_screen.dart';
import '../services/diary_service.dart';
import 'diary_mention_suggestions.dart';

class DiaryCommentsSheet extends StatefulWidget {
  const DiaryCommentsSheet({
    super.key,
    required this.diary,
    required this.service,
    required this.onGuestAction,
    required this.onCommentCountChanged,
  });

  final DiaryItem diary;
  final DiaryService service;
  final Future<void> Function() onGuestAction;
  final ValueChanged<int> onCommentCountChanged;

  @override
  State<DiaryCommentsSheet> createState() => _DiaryCommentsSheetState();
}

class _DiaryCommentsSheetState extends State<DiaryCommentsSheet> {
  final TextEditingController _text = TextEditingController();
  List<DiaryCommentItem> _items = const <DiaryCommentItem>[];
  String? _cursor;
  bool _hasMore = true;
  bool _loading = false;
  bool _sending = false;
  String? _deletingId;
  Object? _error;
  late int _commentCount;
  Timer? _mentionDebounce;
  List<DiaryMentionCandidate> _mentionCandidates =
      const <DiaryMentionCandidate>[];
  bool _mentionLoading = false;
  int _mentionRequest = 0;

  bool get _guest => FirebaseAuth.instance.currentUser?.isAnonymous == true;
  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';

  @override
  void initState() {
    super.initState();
    _commentCount = widget.diary.commentCount;
    _load(reset: true);
  }

  @override
  void dispose() {
    _mentionDebounce?.cancel();
    _text.dispose();
    super.dispose();
  }

  void _commentChanged(String _) {
    _mentionDebounce?.cancel();
    final query = activeDiaryMentionQuery(_text);
    if (query == null) {
      if (_mentionCandidates.isNotEmpty || _mentionLoading) {
        setState(() {
          _mentionCandidates = const <DiaryMentionCandidate>[];
          _mentionLoading = false;
        });
      }
      return;
    }

    final request = ++_mentionRequest;
    setState(() => _mentionLoading = true);
    _mentionDebounce = Timer(const Duration(milliseconds: 250), () async {
      try {
        final items = await widget.service.searchMentions(query);
        if (!mounted || request != _mentionRequest) return;
        setState(() {
          _mentionCandidates = items;
          _mentionLoading = false;
        });
      } catch (_) {
        if (!mounted || request != _mentionRequest) return;
        setState(() {
          _mentionCandidates = const <DiaryMentionCandidate>[];
          _mentionLoading = false;
        });
      }
    });
  }

  void _selectMention(DiaryMentionCandidate candidate) {
    applyDiaryMention(_text, candidate);
    _mentionDebounce?.cancel();
    _mentionRequest += 1;
    setState(() {
      _mentionCandidates = const <DiaryMentionCandidate>[];
      _mentionLoading = false;
    });
  }

  Future<void> _load({required bool reset}) async {
    if (_loading) return;
    setState(() {
      _loading = true;
      if (reset) _error = null;
    });
    try {
      final page = await widget.service.listComments(
        widget.diary.diaryId,
        cursor: reset ? null : _cursor,
      );
      if (!mounted) return;
      final map = <String, DiaryCommentItem>{
        if (!reset) for (final item in _items) item.commentId: item,
        for (final item in page.items) item.commentId: item,
      };
      final merged = map.values.toList(growable: false)
        ..sort((a, b) {
          final time = b.createdAtMs.compareTo(a.createdAtMs);
          if (time != 0) return time;
          return b.commentId.compareTo(a.commentId);
        });
      setState(() {
        _items = merged;
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _submit() async {
    if (_guest) {
      await widget.onGuestAction();
      return;
    }
    if (_sending || !widget.diary.commentsEnabled) return;
    final value = _text.text.trim();
    if (value.isEmpty) return;
    if (value.length > 200) {
      _snack('الحد الأقصى للتعليق 200 حرف.');
      return;
    }
    setState(() => _sending = true);
    try {
      final result = await widget.service.createComment(
        diaryId: widget.diary.diaryId,
        text: value,
      );
      if (!mounted) return;
      _text.clear();
      _mentionDebounce?.cancel();
      _mentionRequest += 1;
      final comment = result.comment;
      setState(() {
        _mentionCandidates = const <DiaryMentionCandidate>[];
        _mentionLoading = false;
        if (comment != null) {
          _items = <DiaryCommentItem>[
            comment,
            ..._items.where((item) => item.commentId != comment.commentId),
          ];
        }
      });
      _commentCount = result.commentCount;
      _commentCount = result.commentCount;
      widget.onCommentCountChanged(result.commentCount);
    } catch (error) {
      _snack(diaryErrorMessage(error));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  bool _canDelete(DiaryCommentItem item) {
    if (_uid.isEmpty || _guest) return false;
    return item.authorUid == _uid || widget.diary.ownerUid == _uid;
  }

  Future<void> _delete(DiaryCommentItem item) async {
    if (!_canDelete(item) || _deletingId != null) return;
    setState(() => _deletingId = item.commentId);
    try {
      final result = await widget.service.deleteComment(
        diaryId: widget.diary.diaryId,
        commentId: item.commentId,
      );
      if (!mounted) return;
      setState(() {
        _items = _items
            .where((comment) => comment.commentId != item.commentId)
            .toList(growable: false);
      });
      widget.onCommentCountChanged(result.commentCount);
    } catch (error) {
      _snack(diaryErrorMessage(error));
    } finally {
      if (mounted) setState(() => _deletingId = null);
    }
  }

  void _openProfile(DiaryCommentItem item) {
    if (item.authorUid.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PublicProfileScreen(userId: item.authorUid),
      ),
    );
  }

  ImageProvider<Object>? _avatar(DiaryCommentItem item) {
    if (item.authorProfileImageUrl.isNotEmpty) {
      return NetworkImage(item.authorProfileImageUrl);
    }
    if (item.authorProfileAvatarAsset.isNotEmpty) {
      return AssetImage(item.authorProfileAvatarAsset);
    }
    return null;
  }

  String _timeLabel(int createdAtMs) {
    if (createdAtMs <= 0) return '';
    final created = DateTime.fromMillisecondsSinceEpoch(createdAtMs);
    final diffTime = DateTime.now().difference(created);
    if (diffTime.inMinutes < 1) return 'الآن';
    if (diffTime.inMinutes < 60) return 'منذ ' + diffTime.inMinutes.toString() + ' د';
    if (diffTime.inHours < 24) return 'منذ ' + diffTime.inHours.toString() + ' س';
    if (diffTime.inDays < 7) return 'منذ ' + diffTime.inDays.toString() + ' ي';
    return created.day.toString() + '/' + created.month.toString() + '/' + created.year.toString();
  }

  void _snack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  Widget _commentTile(DiaryCommentItem item) {
    final avatar = _avatar(item);
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 7),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InkWell(
            customBorder: const CircleBorder(),
            onTap: () => _openProfile(item),
            child: CircleAvatar(
              radius: 18,
              backgroundColor: const Color(0xFF272C39),
              backgroundImage: avatar,
              child: avatar == null
                  ? const Icon(Icons.person_rounded, size: 18, color: Colors.white54)
                  : null,
            ),
          ),
          const SizedBox(width: 9),
          Expanded(
            child: Container(
              padding: const EdgeInsets.fromLTRB(11, 8, 11, 9),
              decoration: BoxDecoration(
                color: const Color(0xFF141925),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          item.authorName.isEmpty ? 'مستخدم Shadow Live' : item.authorName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontWeight: FontWeight.w800,
                            fontSize: 13,
                          ),
                        ),
                      ),
                      Text(
                        _timeLabel(item.createdAtMs),
                        style: const TextStyle(color: Colors.white38, fontSize: 10),
                      ),
                      if (_canDelete(item)) ...[
                        const SizedBox(width: 4),
                        InkWell(
                          borderRadius: BorderRadius.circular(18),
                          onTap: _deletingId == null ? () => _delete(item) : null,
                          child: Padding(
                            padding: const EdgeInsets.all(4),
                            child: _deletingId == item.commentId
                                ? const SizedBox(
                                    width: 14,
                                    height: 14,
                                    child: CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Icon(
                                    Icons.delete_outline_rounded,
                                    size: 17,
                                    color: Colors.white38,
                                  ),
                          ),
                        ),
                      ],
                    ],
                  ),
                  if (item.authorPublicId.isNotEmpty)
                    Text(
                      'ID: ' + item.authorPublicId,
                      style: const TextStyle(color: Colors.white30, fontSize: 10),
                    ),
                  const SizedBox(height: 4),
                  Text(
                    item.text,
                    style: const TextStyle(color: Colors.white70, height: 1.45),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body() {
    if (_items.isEmpty && _loading) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF8A3DFF)),
      );
    }
    if (_items.isEmpty && _error != null) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              diaryErrorMessage(_error!),
              textAlign: TextAlign.center,
              style: const TextStyle(color: Colors.white54),
            ),
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: () => _load(reset: true),
              child: const Text('إعادة المحاولة'),
            ),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return const Center(
        child: Text('ما في تعليقات لسه.', style: TextStyle(color: Colors.white54)),
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(14, 8, 14, 12),
      children: [
        for (final item in _items) _commentTile(item),
        if (_hasMore)
          Padding(
            padding: const EdgeInsets.only(top: 8),
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
      ],
    );
  }

  Widget _composer() {
    if (_guest) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 14, 16),
        child: FilledButton.icon(
          onPressed: widget.onGuestAction,
          icon: const Icon(Icons.login_rounded),
          label: const Text('سجّل الدخول للتعليق'),
        ),
      );
    }
    if (!widget.diary.commentsEnabled) {
      return const Padding(
        padding: EdgeInsets.fromLTRB(14, 8, 14, 18),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.comments_disabled_outlined, color: Colors.white38),
            SizedBox(width: 8),
            Text(
              'التعليقات متوقفة على هذه اليومية',
              style: TextStyle(color: Colors.white54),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: EdgeInsets.fromLTRB(
        12,
        8,
        12,
        12 + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                TextField(
                  controller: _text,
                  enabled: !_sending,
                  onChanged: _commentChanged,
                  maxLength: 200,
                  minLines: 1,
                  maxLines: 4,
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'اكتب تعليق...',
                    hintStyle: const TextStyle(color: Colors.white38),
                    counterStyle: const TextStyle(color: Colors.white30),
                    filled: true,
                    fillColor: const Color(0xFF101522),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
                DiaryMentionSuggestions(
                  items: _mentionCandidates,
                  loading: _mentionLoading,
                  onSelected: _selectMention,
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          IconButton.filled(
            onPressed: _sending ? null : _submit,
            icon: _sending
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Icon(Icons.send_rounded),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * .78,
          child: Column(
            children: [
              const SizedBox(height: 10),
              Container(
                width: 44,
                height: 4,
                decoration: BoxDecoration(
                  color: Colors.white24,
                  borderRadius: BorderRadius.circular(99),
                ),
              ),
              const SizedBox(height: 12),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 14),
                child: Row(
                  children: [
                    const Icon(
                      Icons.chat_bubble_outline_rounded,
                      color: Color(0xFFB794F6),
                    ),
                    const SizedBox(width: 8),
                    const Expanded(
                      child: Text(
                        'التعليقات',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 18,
                        ),
                      ),
                    ),
                    Text(
                      _commentCount.toString(),
                      style: const TextStyle(color: Colors.white54),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 6),
              Divider(color: Colors.white.withValues(alpha: .08), height: 1),
              Expanded(child: _body()),
              Divider(color: Colors.white.withValues(alpha: .08), height: 1),
              _composer(),
            ],
          ),
        ),
      ),
    );
  }
}
