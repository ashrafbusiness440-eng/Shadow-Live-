import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import 'private_chat_screen.dart';
import '../widgets/verified_room_people_strip.dart';
import '../../notifications/services/notification_service.dart';
import '../../../services/navigation_service.dart';
import '../../profile/widgets/quick_profile_sheet.dart';
import '../../profile/widgets/profile_avatar_with_frame.dart';
import '../../profile/services/profile_action_service.dart';
import '../../profile/services/profile_visual_identity_service.dart';
import '../../../shared/widgets/loading_indicator.dart';
import '../../../shared/widgets/confirmation_dialog.dart';

class ChatListScreen extends StatefulWidget {
  const ChatListScreen({super.key});

  @override
  State<ChatListScreen> createState() => _ChatListScreenState();
}

class _ChatListScreenState extends State<ChatListScreen> {
  int _readRetry = 0;
  final Set<String> _pendingConversationHides = <String>{};
  final Map<String, _ChatIdentityRead> _identityReads = {};
  StreamSubscription<String>? _identityInvalidations;
  String? _identityOwnerUid;
  final NotificationService _notificationService = NotificationService();
  String? _notificationOwnerUid;
  Stream<bool>? _unreadNotifications;

  static const int _inboxPageSize = 40;
  Stream<QuerySnapshot<Map<String, dynamic>>>? _inboxStream;
  String? _pagedOwnerUid;
  final Map<String, QueryDocumentSnapshot<Map<String, dynamic>>>
      _olderInboxDocuments = {};
  QueryDocumentSnapshot<Map<String, dynamic>>? _inboxCursor;
  bool _inboxPageLoading = false;
  bool _inboxHasMore = true;
  bool _inboxPageFailed = false;

  final Map<String, Timestamp?> _hiddenAtByConversation = {};
  final Set<String> _checkedHideIds = {};
  bool _hideReadLoading = false;
  bool _hideReadFailed = false;
  int _inboxGeneration = 0;

  bool _isActiveInboxUser(String? ownerUid) =>
      mounted && ownerUid != null && ownerUid.isNotEmpty &&
      ownerUid == _pagedOwnerUid &&
      FirebaseAuth.instance.currentUser?.uid == ownerUid;

  void _resetInboxState() {
    _inboxGeneration++;
    _inboxStream = null;
    _olderInboxDocuments.clear();
    _inboxCursor = null;
    _inboxPageLoading = false;
    _inboxHasMore = true;
    _inboxPageFailed = false;
    _hiddenAtByConversation.clear();
    _checkedHideIds.clear();
    _hideReadLoading = false;
    _hideReadFailed = false;
  }

  Stream<QuerySnapshot<Map<String, dynamic>>> _watchInbox(String ownerUid) {
    return _inboxStream ??= FirebaseFirestore.instance
        .collection('conversations')
        .where('participants', arrayContains: ownerUid)
        .orderBy('updatedAt', descending: true)
        .limit(_inboxPageSize)
        .snapshots();
  }

  List<QueryDocumentSnapshot<Map<String, dynamic>>> _combinedInbox(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> live,
  ) {
    if (_inboxCursor != null) {
      for (final doc in live) {
        _olderInboxDocuments[doc.id] = doc;
      }
    }
    final byId = <String, QueryDocumentSnapshot<Map<String, dynamic>>>{
      for (final doc in _olderInboxDocuments.values) doc.id: doc,
      for (final doc in live) doc.id: doc,
    };
    final docs = byId.values.toList()
      ..sort((a, b) {
        final at = (a.data()['updatedAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0;
        final bt = (b.data()['updatedAt'] as Timestamp?)?.millisecondsSinceEpoch ?? 0;
        final timeOrder = bt.compareTo(at);
        return timeOrder != 0 ? timeOrder : b.id.compareTo(a.id);
      });
    return docs;
  }

  Future<void> _loadOlderInbox(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> live,
  ) async {
    final ownerUid = _pagedOwnerUid;
    final generation = _inboxGeneration;
    if (!_isActiveInboxUser(ownerUid) || live.isEmpty ||
        _inboxPageLoading || !_inboxHasMore) return;
    final cursor = _inboxCursor ?? live.last;
    setState(() {
      _inboxPageLoading = true;
      _inboxPageFailed = false;
    });
    try {
      final page = await FirebaseFirestore.instance
          .collection('conversations')
          .where('participants', arrayContains: ownerUid!)
          .orderBy('updatedAt', descending: true)
          .startAfterDocument(cursor)
          .limit(_inboxPageSize)
          .get();
      if (!_isActiveInboxUser(ownerUid) || generation != _inboxGeneration) return;
      setState(() {
        for (final doc in live) {
          _olderInboxDocuments[doc.id] = doc;
        }
        for (final doc in page.docs) {
          _olderInboxDocuments[doc.id] = doc;
        }
        _inboxCursor = page.docs.isEmpty ? cursor : page.docs.last;
        _inboxHasMore = page.docs.length == _inboxPageSize;
      });
    } catch (_) {
      if (_isActiveInboxUser(ownerUid) && generation == _inboxGeneration) {
        setState(() => _inboxPageFailed = true);
      }
    } finally {
      if (_isActiveInboxUser(ownerUid) && generation == _inboxGeneration) {
        setState(() => _inboxPageLoading = false);
      }
    }
  }

  // Firestore doc-id lookups read at most 30 hide markers per request,
  // restricted to the 40 currently displayed conversations per page.
  // Unchecked rows are not shown until privacy markers are loaded.
  Future<void> _checkInboxHides(
    List<QueryDocumentSnapshot<Map<String, dynamic>>> visible,
  ) async {
    final ownerUid = _pagedOwnerUid;
    final generation = _inboxGeneration;
    if (!_isActiveInboxUser(ownerUid) || _hideReadLoading || _hideReadFailed) {
      return;
    }
    final unchecked = visible.map((doc) => doc.id)
        .where((id) => !_checkedHideIds.contains(id)).toList();
    if (unchecked.isEmpty) return;
    _hideReadLoading = true;
    try {
      final found = <String, Timestamp?>{};
      for (var start = 0; start < unchecked.length; start += 30) {
        if (!_isActiveInboxUser(ownerUid) || generation != _inboxGeneration) return;
        final end = start + 30 < unchecked.length ? start + 30 : unchecked.length;
        final chunk = unchecked.sublist(start, end);
        final result = await FirebaseFirestore.instance
            .collection('conversation_hides')
            .doc(ownerUid)
            .collection('items')
            .where(FieldPath.documentId, whereIn: chunk)
            .get();
        if (!_isActiveInboxUser(ownerUid) || generation != _inboxGeneration) return;
        for (final id in chunk) {
          found[id] = null;
        }
        for (final doc in result.docs) {
          found[doc.id] = doc.data()['hiddenAt'] as Timestamp?;
        }
      }
      if (!_isActiveInboxUser(ownerUid) || generation != _inboxGeneration) return;
      setState(() {
        _hiddenAtByConversation.addAll(found);
        _checkedHideIds.addAll(unchecked);
      });
    } catch (_) {
      if (_isActiveInboxUser(ownerUid) && generation == _inboxGeneration) {
        setState(() => _hideReadFailed = true);
      }
    } finally {
      if (_isActiveInboxUser(ownerUid) && generation == _inboxGeneration) {
        _hideReadLoading = false;
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _identityInvalidations =
        ProfileVisualIdentityService.instance.invalidations.listen((changedUid) {
      if (!mounted || !_identityReads.containsKey(changedUid)) return;
      setState(() => _identityReads.remove(changedUid));
    });
  }

  @override
  void dispose() {
    _identityInvalidations?.cancel();
    _identityReads.clear();
    super.dispose();
  }

  Future<ProfileVisualIdentity> _identityFor(String otherUid) {
    final id = otherUid.trim();
    if (id.isEmpty) return Future.value(ProfileVisualIdentity.empty(''));
    final cached = _identityReads[id];
    if (cached != null &&
        DateTime.now().difference(cached.createdAt) <
            const Duration(seconds: 45)) {
      return cached.future;
    }
    final future = ProfileVisualIdentityService.instance.load(
      id,
      requirePublicRecord: true,
    );
    _identityReads.remove(id);
    _identityReads[id] = _ChatIdentityRead(future);
    // Bound only the visible-list memo; the shared service owns batched
    // profile reads, expiry, and invalidation.
    while (_identityReads.length > 80) {
      _identityReads.remove(_identityReads.keys.first);
    }
    return future;
  }

  void _retryRead() {
    if (mounted) {
      setState(() {
        _readRetry++;
        _resetInboxState();
      });
    }
  }

  String? get uid => FirebaseAuth.instance.currentUser?.uid;

  String? _conversationId(String otherUid) {
    final me = uid;
    if (me == null || me.isEmpty) return null;
    final ids = [me, otherUid]..sort();
    return ids.join('_');
  }

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _searchUsers(String query) async {
    final q = query.trim();
    final me = uid;
    if (q.length < 2 || me == null || me.isEmpty) return [];
    final found = <String, QueryDocumentSnapshot<Map<String, dynamic>>>{};
    var successfulPaths = 0;
    Object? lastFailure;
    try {
      final idDoc = await FirebaseFirestore.instance.collection('public_ids').doc(q).get();
      final targetUid = idDoc.data()?['uid']?.toString();
      if (targetUid != null && targetUid != me) {
        final exact = await FirebaseFirestore.instance.collection('public_profiles').where(FieldPath.documentId, isEqualTo: targetUid).limit(1).get();
        for (final doc in exact.docs) {
          found[doc.id] = doc;
        }
      }
      successfulPaths++;
    } catch (error) {
      lastFailure = error;
    }
    try {
      final snap = await FirebaseFirestore.instance.collection('public_profiles').orderBy('displayName').startAt([q]).endAt(['$q\uf8ff']).limit(20).get();
      for (final doc in snap.docs) {
        if (doc.id != me) found[doc.id] = doc;
      }
      successfulPaths++;
    } catch (error) {
      lastFailure = error;
    }
    // A failed read must not be presented to the user as "no results".
    // Retain partial successful ID/name matches if either path worked.
    if (successfulPaths == 0 && lastFailure != null) throw lastFailure;
    return found.values.toList();
  }

  Future<List<QueryDocumentSnapshot<Map<String, dynamic>>>> _suggestedUsers() async {
    final me = uid;
    if (me == null || me.isEmpty) return [];
    final snap = await FirebaseFirestore.instance
        .collection('public_profiles')
        .orderBy('createdAt', descending: true)
        .limit(20)
        .get();
    return snap.docs.where((d) => d.id != me).take(12).toList();
  }

  Future<void> _openChat(BuildContext sheetContext, QueryDocumentSnapshot<Map<String, dynamic>> doc) async {
    final user = doc.data();
    final name = '${user['displayName'] ?? 'مستخدم Shadow Live'}';
    final photo = '${user['profileImageUrl'] ?? ''}';
    final navigator = Navigator.of(context);
    if (sheetContext.mounted) Navigator.pop(sheetContext);
    await ProfileActionService.openChatWithNavigator(
      navigator,
      otherUid: doc.id,
      otherName: name,
      otherPhoto: photo,
    );
  }

  Widget _userTile(BuildContext sheetContext, QueryDocumentSnapshot<Map<String, dynamic>> doc) {
    final user = doc.data();
    final name = '${user['displayName'] ?? 'مستخدم Shadow Live'}';
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: ProfileAvatarWithFrame(
        diameter: 40,
        userId: doc.id,
        fallbackProfile: user,
      ),
      title: Text(name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      subtitle: Text('ID: ${user['publicId'] ?? doc.id}', style: const TextStyle(color: Colors.white54)),
      trailing: IconButton(tooltip:'فتح بطاقة الملف',icon:const Icon(Icons.person_outline_rounded,color:Colors.white54),onPressed:(){Navigator.pop(sheetContext);showQuickProfileSheet(context,userId:doc.id);}),
      onTap: () => _openChat(sheetContext, doc),
    );
  }

  Future<void> _newChat() async {
    final controller = TextEditingController();
    var results = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    var suggestions = <QueryDocumentSnapshot<Map<String, dynamic>>>[];
    var loading = false;
    var searchError = false;
    var suggestionsLoading = true;
    var suggestionsError = false;
    var suggestionsRequested = false;
    var searchVersion = 0;
    final sessionUid = uid;
    Timer? searchDebounce;

    void queueSearch(
      String raw,
      StateSetter setSheetState,
      BuildContext sheetContext, {
      bool immediate = false,
    }) {
      searchDebounce?.cancel();
      final version = ++searchVersion;
      final query = raw.trim();
      if (!sheetContext.mounted) return;
      if (query.length < 2) {
        setSheetState(() {
          loading = false;
          searchError = false;
          results = [];
        });
        return;
      }

      setSheetState(() {
        loading = true;
        searchError = false;
        results = [];
      });
      searchDebounce = Timer(
        immediate ? Duration.zero : const Duration(milliseconds: 320),
        () async {
          if (!sheetContext.mounted || uid != sessionUid) return;
          try {
            final next = await _searchUsers(query);
            if (!sheetContext.mounted ||
                uid != sessionUid ||
                version != searchVersion) {
              return;
            }
            setSheetState(() {
              results = next;
              loading = false;
            });
          } catch (_) {
            if (!sheetContext.mounted ||
                uid != sessionUid ||
                version != searchVersion) {
              return;
            }
            setSheetState(() {
              searchError = true;
              loading = false;
            });
          }
        },
      );
    }

    Future<void> loadSuggestions(
      StateSetter setSheetState,
      BuildContext sheetContext,
    ) async {
      try {
        final next = await _suggestedUsers();
        if (!sheetContext.mounted || uid != sessionUid) return;
        setSheetState(() {
          suggestions = next;
          suggestionsLoading = false;
          suggestionsError = false;
        });
      } catch (_) {
        if (!sheetContext.mounted || uid != sessionUid) return;
        setSheetState(() {
          suggestionsLoading = false;
          suggestionsError = true;
        });
      }
    }

    try {
      await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101522),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheetContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: StatefulBuilder(
          builder: (context, setSheetState) {
            if (!suggestionsRequested) {
              suggestionsRequested = true;
              unawaited(loadSuggestions(setSheetState, sheetContext));
            }
            final searching = controller.text.trim().length >= 2;
            return Padding(
              padding: EdgeInsets.fromLTRB(16, 18, 16, MediaQuery.of(context).viewInsets.bottom + 18),
              child: SizedBox(
                height: MediaQuery.of(context).size.height * .72,
                child: Column(
                  children: [
                    const Text('محادثة جديدة', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
                    const SizedBox(height: 14),
                    TextField(
                      controller: controller,
                      autofocus: true,
                      style: const TextStyle(color: Colors.white),
                      decoration: InputDecoration(
                        prefixIcon: const Icon(Icons.search, color: Color(0xFFFFD54A)),
                        hintText: 'ابحث بالاسم أو ID',
                        hintStyle: const TextStyle(color: Colors.white38),
                        filled: true,
                        fillColor: const Color(0xFF181C29),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(18), borderSide: BorderSide.none),
                      ),
                      onChanged: (value) =>
                          queueSearch(value, setSheetState, sheetContext),
                    ),
                    const SizedBox(height: 14),
                    Expanded(
                      child: loading
                          ? const LoadingIndicator(
                              size: 28,
                              color: Color(0xFF8A3DFF),
                              message: 'جارٍ البحث عن مستخدمين...',
                            )
                          : searching
                              ? (searchError
                                  ? ShadowReadState(
                                      icon: Icons.wifi_off_rounded,
                                      message: 'تعذر البحث حالياً. تحقق من الاتصال.',
                                      onRetry: () => queueSearch(
                                        controller.text,
                                        setSheetState,
                                        sheetContext,
                                        immediate: true,
                                      ),
                                    )
                                  : results.isEmpty
                                      ? const ShadowReadState(
                                          icon: Icons.search_off_rounded,
                                          message: 'لا توجد حسابات مطابقة لبحثك.',
                                        )
                                      : ListView.builder(
                                          itemCount: results.length,
                                          itemBuilder: (_, i) =>
                                              _userTile(sheetContext, results[i]),
                                        ))
                              : Column(
                                  crossAxisAlignment: CrossAxisAlignment.stretch,
                                  children: [
                                    const Text('مقترح لك', style: TextStyle(color: Color(0xFFFFD54A), fontSize: 17, fontWeight: FontWeight.w900)),
                                    const SizedBox(height: 4),
                                    const Text('أحدث الحسابات المنضمة إلى Shadow Live', style: TextStyle(color: Colors.white38, fontSize: 12)),
                                    const SizedBox(height: 8),
                                    Expanded(
                                      child: suggestionsLoading
                                          ? const LoadingIndicator(
                                              size: 28,
                                              color: Color(0xFF8A3DFF),
                                              message: 'جارٍ تحميل الحسابات المقترحة...',
                                            )
                                          : suggestionsError
                                              ? ShadowReadState(
                                                  icon: Icons.wifi_off_rounded,
                                                  message: 'تعذر تحميل المقترحات. تحقق من الاتصال.',
                                                  onRetry: () {
                                                    if (suggestionsLoading) return;
                                                    setSheetState(() {
                                                      suggestionsLoading = true;
                                                      suggestionsError = false;
                                                    });
                                                    unawaited(loadSuggestions(
                                                      setSheetState,
                                                      sheetContext,
                                                    ));
                                                  },
                                                )
                                              : suggestions.isEmpty
                                                  ? const ShadowReadState(
                                                      icon: Icons.people_outline_rounded,
                                                      message: 'لا توجد حسابات مقترحة حالياً.',
                                                    )
                                                  : ListView.builder(
                                                      itemCount: suggestions.length,
                                                      itemBuilder: (_, i) =>
                                                          _userTile(sheetContext, suggestions[i]),
                                                    ),
                                    ),
                                  ],
                                ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
    } finally {
      searchDebounce?.cancel();
      searchVersion++;
      controller.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final me = uid;
    if (_pagedOwnerUid != me) {
      _resetInboxState();
      _pagedOwnerUid = me;
    }
    if (_identityOwnerUid != me) {
      _identityReads.clear();
      _identityOwnerUid = me;
    }
    // Memoize per account: rebuilding the conversation list must not
    // resubscribe to notification reads or leak another user's badge.
    if (_notificationOwnerUid != me) {
      _notificationOwnerUid = me;
      _unreadNotifications = me == null || me.isEmpty
          ? null
          : _notificationService.watchHasUnread(me);
    }
    if (me == null || me.isEmpty ||
        FirebaseAuth.instance.currentUser?.isAnonymous == true) {
      return const Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: Colors.transparent,
          body: SafeArea(
            child: Center(
              child: Text('سجّل الدخول لعرض الرسائل', style: TextStyle(color: Colors.white60)),
            ),
          ),
        ),
      );
    }
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 18, 18, 12),
                child: Row(
                  children: [
                    const Icon(Icons.chat_bubble_rounded, color: Color(0xFFFFD54A)),
                    const SizedBox(width: 10),
                    const Expanded(child: Text('الرسائل', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900))),
                    StreamBuilder<bool>(
                      stream: _unreadNotifications,
                      builder: (context, snapshot) => ChatNotificationBell(
                        hasUnread: snapshot.data == true,
                        onPressed: () => Navigator.of(context)
                            .pushNamed(AppRoutes.notifications),
                      ),
                    ),
                    IconButton(onPressed: _retryRead, tooltip: 'تحديث المحادثات', icon: const Icon(Icons.refresh_rounded, color: Colors.white70)),
                    IconButton(onPressed: _newChat, tooltip: 'محادثة جديدة', icon: const Icon(Icons.add_comment_rounded, color: Color(0xFFFFD54A))),
                  ],
                ),
              ),
              VerifiedRoomPeopleStrip(
                key: ValueKey('messages-room-people-$me'),
                ownerUid: me,
              ),
              Expanded(
                child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                  key: ValueKey('conversations-$_readRetry'),
                  stream: _watchInbox(me),
                  builder: (context, snapshot) {
                    if (snapshot.hasError) {
                      return ShadowReadState(
                        icon: Icons.error_outline_rounded,
                        message: 'تعذر تحميل المحادثات. تحقق من اتصال الإنترنت.',
                        onRetry: _retryRead,
                      );
                    }
                    if (!snapshot.hasData) {
                      return const LoadingIndicator(
                        size: 30,
                        color: Color(0xFF8A3DFF),
                        message: 'جارٍ تحميل المحادثات...',
                      );
                    }
                    final live = snapshot.data!.docs;
                    final allDocs = _combinedInbox(live);
                    final unchecked = allDocs.any(
                      (doc) => !_checkedHideIds.contains(doc.id),
                    );
                    if (unchecked && !_hideReadFailed) {
                      WidgetsBinding.instance.addPostFrameCallback(
                        (_) => _checkInboxHides(allDocs),
                      );
                    }
                    if (_hideReadFailed) {
                      return ShadowReadState(
                        icon: Icons.shield_outlined,
                        message: 'تعذر التأكد من خصوصية قائمة المحادثات.',
                        onRetry: _retryRead,
                      );
                    }
                    if (unchecked) {
                      return const LoadingIndicator(
                        size: 30,
                        color: Color(0xFF8A3DFF),
                        message: 'جارٍ ترتيب المحادثات...',
                      );
                    }
                    final docs = allDocs.where((doc) {
                      final hiddenAt = _hiddenAtByConversation[doc.id];
                      if (hiddenAt == null) return true;
                      final updatedAt = doc.data()['updatedAt'] as Timestamp?;
                      return updatedAt != null &&
                          updatedAt.millisecondsSinceEpoch >
                              hiddenAt.millisecondsSinceEpoch;
                    }).toList();
                    final canLoadOlder = _inboxCursor == null
                        ? live.length == _inboxPageSize
                        : _inboxHasMore;
                    if (docs.isEmpty && !canLoadOlder) {
                      return const ShadowReadState(
                        icon: Icons.forum_outlined,
                        message: 'ما عندك محادثات بعد. اضغط + لتبدأ محادثة.',
                      );
                    }
                    return ListView.separated(
                      padding: const EdgeInsets.fromLTRB(12, 4, 12, 20),
                      itemCount: docs.length + (canLoadOlder ? 1 : 0),
                      separatorBuilder: (_, __) => const SizedBox(height: 8),
                      itemBuilder: (_, index) {
                        if (index == docs.length) {
                          return Center(
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                if (_inboxPageFailed)
                                  const Text(
                                    'تعذر تحميل المحادثات الأقدم. حاول مجدداً.',
                                    style: TextStyle(color: Colors.white70),
                                  ),
                                OutlinedButton.icon(
                                  onPressed: _inboxPageLoading
                                      ? null
                                      : () => _loadOlderInbox(live),
                                  icon: _inboxPageLoading
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : const Icon(Icons.history_rounded),
                                  label: Text(_inboxPageLoading
                                      ? 'جارٍ تحميل المحادثات...'
                                      : 'عرض محادثات أقدم'),
                                ),
                              ],
                            ),
                          );
                        }
                        final doc = docs[index];
                        final data = doc.data();
                        final participants = List<String>.from(
                            data['participants'] ?? const []);
                        final other = participants.firstWhere(
                            (id) => id != me, orElse: () => '');
                        final unread =
                            ((data['unreadCounts'] as Map?)?[me] as num?)?.toInt() ?? 0;
                        return _ConversationTile(
                          id: doc.id,
                          otherUid: other,
                          identityFuture: _identityFor(other),
                          lastMessage: '${data['lastMessage'] ?? ''}',
                          unread: unread,
                          updatedAt: data['updatedAt'],
                          onDelete: () => _hideConversation(doc.id),
                        );
                      },
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _hideConversation(String conversationId) async {
    final me = uid;
    if (!mounted ||
        me == null ||
        me.isEmpty ||
        conversationId.isEmpty ||
        !_pendingConversationHides.add(conversationId)) {
      return;
    }
    try {
      final confirmed = await showShadowConfirmation(
        context,
        title: 'إخفاء المحادثة من قائمتك؟',
        message: 'ستختفي من قائمة رسائلك فقط، ولن تُحذف رسائل الطرف الآخر. إذا وصلتك رسالة جديدة ستظهر المحادثة مرة ثانية.',
        confirmLabel: 'إخفاء المحادثة',
        destructive: true,
      );
      // An auth switch or a cancelled dialog must never perform the write.
      if (!confirmed || !mounted || uid != me) return;

      final batch = FirebaseFirestore.instance.batch();
      batch.set(
        FirebaseFirestore.instance
            .collection('conversation_hides')
            .doc(me)
            .collection('items')
            .doc(conversationId),
        {'hiddenAt': FieldValue.serverTimestamp()},
      );
      batch.update(
        FirebaseFirestore.instance.collection('conversations').doc(conversationId),
        {'unreadCounts.$me': 0},
      );
      await batch.commit();

      if (!mounted || uid != me) return;
      // The write succeeded; a follow-up single-document read gets the
      // server's hiddenAt for correct reappearance after a newer message.
      Timestamp? serverHiddenAt;
      try {
        final receipt = await FirebaseFirestore.instance
            .collection('conversation_hides').doc(me)
            .collection('items').doc(conversationId).get();
        serverHiddenAt = receipt.data()?['hiddenAt'] as Timestamp?;
      } catch (_) {
        // The hide already succeeded. Keep it hidden locally until Refresh.
      }
      if (!mounted || uid != me) return;
      setState(() {
        _checkedHideIds.add(conversationId);
        _hiddenAtByConversation[conversationId] =
            serverHiddenAt ?? Timestamp.fromDate(
                DateTime.now().add(const Duration(days: 1)));
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('تم إخفاء المحادثة من قائمتك.')),
      );
    } catch (_) {
      if (!mounted || uid != me) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('تعذر إخفاء المحادثة. تحقق من الاتصال وحاول مرة ثانية.'),
        ),
      );
    } finally {
      _pendingConversationHides.remove(conversationId);
    }
  }

}

class _ConversationTile extends StatelessWidget {
  final String id;
  final String otherUid;
  final Future<ProfileVisualIdentity> identityFuture;
  final String lastMessage;
  final int unread;
  final dynamic updatedAt;
  final VoidCallback onDelete;

  const _ConversationTile({required this.id, required this.otherUid, required this.identityFuture, required this.lastMessage, required this.unread, required this.updatedAt, required this.onDelete});

  String _time(dynamic value) {
    if (value is! Timestamp) return '';
    final d = value.toDate();
    final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
    final m = d.minute.toString().padLeft(2, '0');
    return '$h:$m ${d.hour >= 12 ? 'م' : 'ص'}';
  }

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<ProfileVisualIdentity>(
      future: identityFuture,
      builder: (context, snapshot) {
        final user = snapshot.data?.toProfileMap() ?? const <String, dynamic>{};
        final accountDeleted = user['accountDeleted'] == true;
        final name = accountDeleted ? 'حساب محذوف'
            : (user['displayName'] ?? 'مستخدم Shadow Live').toString();
        final photo = accountDeleted ? ''
            : (user['profileImageUrl'] ?? '').toString();
        return Material(
          color: const Color(0xFF101522),
          borderRadius: BorderRadius.circular(18),
          child: ListTile(
            leading: accountDeleted
                ? const CircleAvatar(
                    radius: 20, child: Icon(Icons.person_off_outlined),
                  )
                : ProfileAvatarWithFrame(
                    diameter: 40,
                    userId: otherUid,
                    fallbackProfile: user,
                    snapshotOnly: true,
                  ),
            title: Text(name, style: TextStyle(color: Colors.white, fontWeight: unread > 0 ? FontWeight.w900 : FontWeight.w700)),
            subtitle: Text(lastMessage.isEmpty ? 'ابدأ المحادثة' : lastMessage, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: unread > 0 ? Colors.white70 : Colors.white54)),
            trailing: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(_time(updatedAt), style: const TextStyle(color: Colors.white38, fontSize: 10)),
                if (unread > 0) ...[
                  const SizedBox(height: 5),
                  CircleAvatar(radius: 11, backgroundColor: const Color(0xFF8A3DFF), child: Text('$unread', style: const TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold))),
                ],
              ],
            ),
            onTap: otherUid.isEmpty ? null : () => Navigator.push(context, MaterialPageRoute(builder: (_) => PrivateChatScreen(conversationId: id, otherUid: otherUid, otherName: name, otherPhoto: photo))),
            onLongPress: otherUid.isEmpty ? null : () => showModalBottomSheet<void>(
              context: context,
              backgroundColor: const Color(0xFF101522),
              shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
              builder: (sheetContext) => Directionality(
                textDirection: TextDirection.rtl,
                child: SafeArea(
                  child: Wrap(children: [
                    if (!accountDeleted) ListTile(
                      leading: const Icon(Icons.person_outline_rounded, color: Color(0xFFFFD54A)),
                      title: const Text('عرض الملف الشخصي', style: TextStyle(color: Colors.white)),
                      onTap: () {
                        Navigator.pop(sheetContext);
                        showQuickProfileSheet(context, userId: otherUid);
                      },
                    ),
                    ListTile(
                      leading: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent),
                      title: const Text('إخفاء المحادثة', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.w800)),
                      subtitle: const Text('إخفاؤها من قائمتي فقط', style: TextStyle(color: Colors.white38)),
                      onTap: () { Navigator.pop(sheetContext); onDelete(); },
                    ),
                    ListTile(
                      leading: const Icon(Icons.close_rounded, color: Colors.white54),
                      title: const Text('إغلاق', style: TextStyle(color: Colors.white70)),
                      onTap: () => Navigator.pop(sheetContext),
                    ),
                  ]),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _ChatIdentityRead {
  _ChatIdentityRead(this.future) : createdAt = DateTime.now();

  final Future<ProfileVisualIdentity> future;
  final DateTime createdAt;
}

 
/// One notification entry beside Messages, with a server-backed unread dot.
/// The notification page owns marking items read and routing to their sources.
class ChatNotificationBell extends StatelessWidget {
  const ChatNotificationBell({
    super.key,
    required this.hasUnread,
    required this.onPressed,
  });

  final bool hasUnread;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Stack(
      clipBehavior: Clip.none,
      children: [
        IconButton(
          key: const Key('messages-notifications'),
          tooltip: 'الإشعارات',
          onPressed: onPressed,
          icon: const Icon(
            Icons.notifications_none_rounded,
            color: Colors.white,
          ),
        ),
        if (hasUnread)
          PositionedDirectional(
            end: 9,
            top: 9,
            child: IgnorePointer(
              child: Container(
                key: const Key('messages-notifications-unread'),
                width: 9,
                height: 9,
                decoration: BoxDecoration(
                  color: const Color(0xFFFF455B),
                  shape: BoxShape.circle,
                  border: Border.all(color: const Color(0xFF05060D)),
                ),
              ),
            ),
          ),
      ],
    );
  }
}
