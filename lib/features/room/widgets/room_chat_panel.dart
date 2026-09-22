import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../services/room_chat_service.dart';

class RoomChatPanel extends StatefulWidget {
  const RoomChatPanel({
    super.key,
    required this.roomId,
    required this.chatEnabled,
    required this.isOwner,
  });

  final String roomId;
  final bool chatEnabled;
  final bool isOwner;

  @override
  State<RoomChatPanel> createState() => _RoomChatPanelState();
}

class _RoomChatPanelState extends State<RoomChatPanel> {
  final RoomChatService _service = RoomChatService();
  final TextEditingController _controller = TextEditingController();
  final FocusNode _focusNode = FocusNode();

  RoomChatMessage? _replyingTo;
  String? _mentionUid;
  bool _sending = false;

  String get _uid => FirebaseAuth.instance.currentUser?.uid ?? '';
  bool get _canSend => widget.chatEnabled || widget.isOwner;

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    _service.close();
    super.dispose();
  }

  void _reply(RoomChatMessage message) {
    setState(() => _replyingTo = message);
    _focusNode.requestFocus();
  }

  void _mention(RoomChatMessage message) {
    if (message.senderUid.isEmpty || message.senderUid == _uid) return;
    final name = message.displayName.trim();
    if (name.isEmpty) return;
    final prefix = '@' + name.replaceAll(RegExp(r'\s+'), '_') + ' ';
    final current = _controller.text;
    if (!current.contains(prefix)) {
      _controller.text = prefix + current;
      _controller.selection = TextSelection.collapsed(
        offset: _controller.text.length,
      );
    }
    setState(() => _mentionUid = message.senderUid);
    _focusNode.requestFocus();
  }

  Future<void> _send() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending || !_canSend) return;
    setState(() => _sending = true);
    final reply = _replyingTo;
    final mention = _mentionUid;
    try {
      await _service.sendMessage(
        roomId: widget.roomId,
        text: text,
        replyTo: reply?.id,
        mentionUids: mention == null ? const [] : [mention],
      );
      if (!mounted) return;
      _controller.clear();
      setState(() {
        _replyingTo = null;
        _mentionUid = null;
      });
    } on StateError catch (error) {
      if (!mounted) return;
      final code = error.message.toString();
      final message = code == 'rate_limited'
          ? 'أرسلت رسائل بسرعة كبيرة. حاول بعد قليل.'
          : code == 'room_banned'
              ? 'لا يمكنك الكتابة في هذه الغرفة حالياً.'
              : code == 'room_chat_disabled'
                  ? 'دردشة الغرفة متوقفة حالياً.'
                  : 'تعذر إرسال الرسالة حالياً.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('تعذر إرسال الرسالة حالياً.')),
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  TextSpan _messageSpan(String text) {
    final parts = text.split(RegExp(r'(@[^\s]+)'));
    final matches =
        RegExp(r'(@[^\s]+)').allMatches(text).map((m) => m.group(0)!).toList();
    final spans = <InlineSpan>[];
    var matchIndex = 0;
    for (var index = 0; index < parts.length; index++) {
      if (parts[index].isNotEmpty) {
        spans.add(
          TextSpan(
            text: parts[index],
            style: const TextStyle(color: Colors.white),
          ),
        );
      }
      if (matchIndex < matches.length && index < parts.length - 1) {
        spans.add(
          TextSpan(
            text: matches[matchIndex++],
            style: const TextStyle(
              color: Color(0xFFBFA5FF),
              fontWeight: FontWeight.w800,
            ),
          ),
        );
      }
    }
    if (spans.isEmpty) {
      spans.add(
        TextSpan(
          text: text,
          style: const TextStyle(color: Colors.white),
        ),
      );
    }
    return TextSpan(children: spans);
  }

  Widget _bubble(RoomChatMessage message) {
    if (message.type == 'system') {
      final vipEntry =
          message.systemKind == 'room_join' && message.vipLevel > 0;
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween<double>(begin: .96, end: 1),
            duration: const Duration(milliseconds: 320),
            builder: (context, scale, child) => Transform.scale(
              scale: scale,
              child: child,
            ),
            child: Container(
              padding: EdgeInsets.symmetric(
                horizontal: vipEntry ? 14 : 10,
                vertical: vipEntry ? 7 : 5,
              ),
              decoration: BoxDecoration(
                gradient: vipEntry
                    ? const LinearGradient(
                        colors: [
                          Color(0xFF6D27D9),
                          Color(0xFFB57A18),
                        ],
                      )
                    : null,
                color: vipEntry
                    ? null
                    : Colors.white.withValues(alpha: .05),
                borderRadius: BorderRadius.circular(999),
                border: vipEntry
                    ? Border.all(
                        color: const Color(0xFFFFD54A)
                            .withValues(alpha: .55),
                      )
                    : null,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (vipEntry) ...[
                    const Icon(
                      Icons.workspace_premium_rounded,
                      color: Color(0xFFFFE08A),
                      size: 15,
                    ),
                    const SizedBox(width: 5),
                  ],
                  Flexible(
                    child: Text(
                      message.text,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color:
                            vipEntry ? Colors.white : Colors.white54,
                        fontSize: vipEntry ? 11 : 10,
                        fontWeight: vipEntry
                            ? FontWeight.w800
                            : FontWeight.w400,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      );
    }

    final mine = message.senderUid == _uid;
    final mentionedMe = message.mentionUids.contains(_uid);
    return Align(
      alignment: mine
          ? AlignmentDirectional.centerEnd
          : AlignmentDirectional.centerStart,
      child: GestureDetector(
        onLongPress: () => _reply(message),
        child: Container(
          constraints: const BoxConstraints(maxWidth: 310),
          margin: const EdgeInsets.symmetric(vertical: 4),
          padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
          decoration: BoxDecoration(
            color: mine
                ? const Color(0xFF4F1E96).withValues(alpha: .72)
                : mentionedMe
                    ? const Color(0xFF8A3DFF).withValues(alpha: .20)
                    : const Color(0xFF141A28).withValues(alpha: .92),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(
              color: mentionedMe
                  ? const Color(0xFF8A3DFF).withValues(alpha: .55)
                  : Colors.white10,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                onTap: () => _mention(message),
                child: Text(
                  message.displayName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: mine
                        ? const Color(0xFFFFD54A)
                        : const Color(0xFFBFA5FF),
                    fontSize: 10,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              if ((message.replyPreview ?? '').isNotEmpty) ...[
                const SizedBox(height: 5),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(7),
                  decoration: BoxDecoration(
                    color: Colors.black.withValues(alpha: .22),
                    borderRadius: BorderRadius.circular(8),
                    border: const BorderDirectional(
                      start: BorderSide(
                        color: Color(0xFFFFD54A),
                        width: 2,
                      ),
                    ),
                  ),
                  child: Text(
                    message.replyPreview!,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 9,
                    ),
                  ),
                ),
              ],
              const SizedBox(height: 5),
              RichText(
                text: _messageSpan(message.text),
                textDirection: TextDirection.rtl,
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (widget.roomId.trim().isEmpty) return const SizedBox.shrink();

    return Container(
      height: 260,
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFF080C14).withValues(alpha: .78),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 9, 12, 7),
            child: Row(
              children: [
                const Icon(
                  Icons.forum_rounded,
                  color: Color(0xFFBFA5FF),
                  size: 18,
                ),
                const SizedBox(width: 6),
                const Text(
                  'دردشة الغرفة',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const Spacer(),
                const Text(
                  'اضغط مطولاً للرد',
                  style: TextStyle(
                    color: Colors.white30,
                    fontSize: 9,
                  ),
                ),
              ],
            ),
          ),
          const Divider(height: 1, color: Colors.white10),
          Expanded(
            child: StreamBuilder<List<RoomChatMessage>>(
              stream: _service.watchMessages(widget.roomId),
              builder: (context, snapshot) {
                if (snapshot.hasError) {
                  return const Center(
                    child: Text(
                      'تعذر تحميل دردشة الغرفة',
                      style: TextStyle(
                        color: Colors.white38,
                        fontSize: 11,
                      ),
                    ),
                  );
                }
                if (!snapshot.hasData) {
                  return const Center(
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Color(0xFF8A3DFF),
                      ),
                    ),
                  );
                }
                final messages = snapshot.data!;
                if (messages.isEmpty) {
                  return const Center(
                    child: Text(
                      'ابدأ أول رسالة في الغرفة',
                      style: TextStyle(
                        color: Colors.white38,
                        fontSize: 11,
                      ),
                    ),
                  );
                }
                return ListView.builder(
                  reverse: true,
                  padding: const EdgeInsets.fromLTRB(9, 6, 9, 6),
                  itemCount: messages.length,
                  itemBuilder: (_, index) => _bubble(messages[index]),
                );
              },
            ),
          ),
          if (_replyingTo != null)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
              color: Colors.white.withValues(alpha: .04),
              child: Row(
                children: [
                  const Icon(
                    Icons.reply_rounded,
                    size: 15,
                    color: Color(0xFFFFD54A),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _replyingTo!.text,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: Colors.white54,
                        fontSize: 9,
                      ),
                    ),
                  ),
                  InkWell(
                    onTap: () => setState(() => _replyingTo = null),
                    child: const Icon(
                      Icons.close_rounded,
                      size: 16,
                      color: Colors.white38,
                    ),
                  ),
                ],
              ),
            ),
          if (!_canSend)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
              color: const Color(0xFF6D27D9).withValues(alpha: .10),
              child: const Row(
                children: [
                  Icon(
                    Icons.lock_rounded,
                    size: 15,
                    color: Color(0xFFFFD54A),
                  ),
                  SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      'دردشة الغرفة متوقفة من صاحب الغرفة.',
                      style: TextStyle(
                        color: Colors.white60,
                        fontSize: 10,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 6, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    enabled: _canSend,
                    controller: _controller,
                    focusNode: _focusNode,
                    minLines: 1,
                    maxLines: 3,
                    maxLength: 500,
                    buildCounter: (
                      context, {
                      required currentLength,
                      required isFocused,
                      required maxLength,
                    }) =>
                        null,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 12,
                    ),
                    decoration: InputDecoration(
                      hintText: _canSend
                          ? 'اكتب رسالة أو إيموجي…'
                          : 'الدردشة متوقفة',
                      hintStyle: const TextStyle(
                        color: Colors.white30,
                        fontSize: 11,
                      ),
                      isDense: true,
                      filled: true,
                      fillColor: Colors.white.withValues(alpha: .05),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(999),
                        borderSide: BorderSide.none,
                      ),
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 9,
                      ),
                    ),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                const SizedBox(width: 7),
                IconButton.filled(
                  onPressed: _sending || !_canSend ? null : _send,
                  style: IconButton.styleFrom(
                    backgroundColor: const Color(0xFF6D27D9),
                  ),
                  icon: _sending
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(
                          Icons.send_rounded,
                          size: 19,
                        ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
