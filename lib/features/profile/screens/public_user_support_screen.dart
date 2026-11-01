import 'dart:async';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../utils/compact_number.dart';
import '../../mysterious/widgets/mysterious_identity_widgets.dart';
import '../services/user_level_service.dart';
import '../widgets/quick_profile_sheet.dart';

typedef PublicLevelPageLoader = Future<UserLevelSupportPage> Function({
  required String uid,
  required String metric,
  String? cursor,
});

/// Visitor-only support ranking. Never fetches or renders the target user's
/// private progress, current points, remaining points, or games level.
class PublicUserSupportScreen extends StatefulWidget {
  const PublicUserSupportScreen({
    super.key,
    required this.userId,
    this.initialTabIndex = 0,
    this.loadPage,
  });

  final String userId;
  final int initialTabIndex;
  final PublicLevelPageLoader? loadPage;

  @override
  State<PublicUserSupportScreen> createState() => _PublicUserSupportScreenState();
}

class _PublicUserSupportScreenState extends State<PublicUserSupportScreen> {
  StreamSubscription<User?>? _authSubscription;
  String? _viewerUid;
  int _viewerVersion = 0;

  @override
  void initState() {
    super.initState();
    if (widget.loadPage == null) {
      _viewerUid = FirebaseAuth.instance.currentUser?.uid;
      _authSubscription = FirebaseAuth.instance.userChanges().listen((user) {
        if (!mounted || user?.uid == _viewerUid) return;
        setState(() {
          _viewerUid = user?.uid;
          _viewerVersion++;
        });
      });
    }
  }

  @override
  void dispose() {
    _authSubscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: TextDirection.rtl,
      child: DefaultTabController(
        length: 2,
        initialIndex: widget.initialTabIndex.clamp(0, 1).toInt(),
        child: Scaffold(
          backgroundColor: const Color(0xFF050814),
          appBar: AppBar(
            backgroundColor: const Color(0xFF0B1323),
            foregroundColor: Colors.white,
            title: const Text('تفاصيل الدعم'),
            bottom: const TabBar(
              labelColor: Color(0xFFFFD54A),
              unselectedLabelColor: Colors.white54,
              indicatorColor: Color(0xFFFFD54A),
              tabs: [
                Tab(text: 'الثروة'),
                Tab(text: 'الجاذبية'),
              ],
            ),
          ),
          body: TabBarView(
            children: [
              _PublicSupportTab(
                key: ValueKey('wealth-$_viewerVersion'),
                userId: widget.userId,
                metric: 'wealth',
                loader: widget.loadPage,
              ),
              _PublicSupportTab(
                key: ValueKey('attraction-$_viewerVersion'),
                userId: widget.userId,
                metric: 'attraction',
                loader: widget.loadPage,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PublicSupportTab extends StatefulWidget {
  const _PublicSupportTab({
    super.key,
    required this.userId,
    required this.metric,
    required this.loader,
  });

  final String userId;
  final String metric;
  final PublicLevelPageLoader? loader;

  @override
  State<_PublicSupportTab> createState() => _PublicSupportTabState();
}

class _PublicSupportTabState extends State<_PublicSupportTab>
    with AutomaticKeepAliveClientMixin {
  UserLevelService? _service;
  final List<UserLevelSupportItem> _items = [];
  String? _nextCursor;
  String? _error;
  bool _loading = false;
  bool _loadingMore = false;
  bool _requestInFlight = false;

  bool get _wealth => widget.metric == 'wealth';

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    if (widget.loader == null) _service = UserLevelService();
    _load(reset: true);
  }

  @override
  void dispose() {
    _service?.close();
    super.dispose();
  }

  Future<void> _load({required bool reset}) async {
    if (_requestInFlight || (!reset && _nextCursor == null)) return;
    _requestInFlight = true;
    setState(() {
      _error = null;
      if (reset) {
        _loading = true;
      } else {
        _loadingMore = true;
      }
    });
    try {
      final page = await (widget.loader?.call(
            uid: widget.userId,
            metric: widget.metric,
            cursor: reset ? null : _nextCursor,
          ) ??
          _service!.loadSupportPage(
            uid: widget.userId,
            metric: widget.metric,
            cursor: reset ? null : _nextCursor,
          ));
      if (!mounted) return;
      setState(() {
        if (reset) _items.clear();
        final seen = _items.map((item) => item.rank).toSet();
        for (final item in page.items) {
          if (item.rank > 0 && seen.add(item.rank)) _items.add(item);
        }
        _items.sort((a, b) => a.rank.compareTo(b.rank));
        _nextCursor = page.nextCursor?.isEmpty == true ? null : page.nextCursor;
      });
    } catch (error) {
      if (!mounted) return;
      final code = error.toString();
      setState(() {
        _error = code.contains('level_hidden')
            ? 'تفاصيل هذا المستوى مخفية.'
            : code.contains('not_signed_in') || code.contains('unauthorized')
                ? 'يلزم تسجيل الدخول لعرض الدعم.'
                : 'تعذر تحميل تفاصيل الدعم. أعد المحاولة.';
        if (reset) {
          _items.clear();
          _nextCursor = null;
        }
      });
    } finally {
      _requestInFlight = false;
      if (mounted) {
        setState(() {
          _loading = false;
          _loadingMore = false;
        });
      }
    }
  }

  Future<void> _openIdentity(UserLevelSupportItem item) async {
    if (item.accountDeleted || !mounted) return;
    if (item.mysteriousMode) {
      await showMysteriousIdentitySheet(
        context,
        mysteriousId: item.mysteriousId.isNotEmpty
            ? item.mysteriousId
            : item.publicId,
        rank: item.rank,
        support: item.points,
      );
      return;
    }
    if (item.uid.isNotEmpty) {
      await showQuickProfileSheet(context, userId: item.uid);
    }
  }

  Widget _portrait(UserLevelSupportItem item, {double size = 42}) {
    if (item.mysteriousMode) {
      return MysteriousIdentityAvatar(diameter: size);
    }
    return CircleAvatar(
      radius: size / 2,
      backgroundColor: const Color(0xFF1F1832),
      foregroundImage: item.profileImageUrl.isEmpty
          ? null
          : NetworkImage(item.profileImageUrl),
      child: item.profileImageUrl.isEmpty
          ? const Icon(Icons.person_rounded, color: Colors.white70)
          : null,
    );
  }

  Widget _podium(List<UserLevelSupportItem> top) {
    final byRank = {for (final item in top) item.rank: item};
    // The source API already returns rank. Present podium physically 3-1-2.
    return Directionality(
      textDirection: TextDirection.ltr,
      child: Row(
        key: const Key('public-support-top3'),
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final rank in const [3, 1, 2])
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: _podiumCard(rank, byRank[rank]),
              ),
            ),
        ],
      ),
    );
  }

  Widget _podiumCard(int rank, UserLevelSupportItem? item) {
    final isFirst = rank == 1;
    return Container(
      key: Key('public-support-rank-$rank'),
      height: isFirst ? 168 : 142,
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 12),
      decoration: BoxDecoration(
        color: isFirst ? const Color(0xFF281F3B) : const Color(0xFF101B2E),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: isFirst ? const Color(0xFFFFD54A) : Colors.white12,
        ),
      ),
      child: item == null
          ? Center(
              child: Text(
                '#$rank',
                style: const TextStyle(color: Colors.white38),
              ),
            )
          : InkWell(
              onTap: item.accountDeleted ? null : () => _openIdentity(item),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    '#$rank',
                    style: const TextStyle(
                      fontWeight: FontWeight.w900,
                      color: Color(0xFFFFD54A),
                    ),
                  ),
                  const SizedBox(height: 5),
                  _portrait(item, size: isFirst ? 49 : 40),
                  const SizedBox(height: 5),
                  Text(
                    item.displayName,
                    textDirection: TextDirection.rtl,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                    ),
                  ),
                  Text(
                    formatCompactAmount(item.points),
                    style: const TextStyle(
                      fontSize: 11,
                      color: Color(0xFFFFD54A),
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _supportRow(UserLevelSupportItem item) {
    return ListTile(
      key: Key('public-support-item-${item.rank}'),
      onTap: item.accountDeleted ? null : () => _openIdentity(item),
      leading: Text(
        '#${item.rank}',
        textDirection: TextDirection.ltr,
        style: const TextStyle(
          color: Color(0xFFFFD54A),
          fontWeight: FontWeight.w900,
        ),
      ),
      title: Text(
        item.displayName,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(color: Colors.white),
      ),
      subtitle: Text(
        '${item.giftCount} هدية',
        style: const TextStyle(color: Colors.white54, fontSize: 11),
      ),
      trailing: Text(
        formatCompactAmount(item.points),
        style: const TextStyle(
          color: Color(0xFFFFD54A),
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    if (_loading && _items.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null && _items.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error!, style: const TextStyle(color: Colors.white70)),
            const SizedBox(height: 12),
            if (!_error!.contains('مخفية') && !_error!.contains('تسجيل الدخول'))
              TextButton(
                onPressed: () => _load(reset: true),
                child: const Text('إعادة المحاولة'),
              ),
          ],
        ),
      );
    }
    if (_items.isEmpty) {
      return const Center(
        child: Text(
          'لا توجد بيانات دعم حتى الآن',
          style: TextStyle(color: Colors.white70),
        ),
      );
    }
    final top = _items.where((item) => item.rank <= 3).toList();
    final others = _items.where((item) => item.rank > 3).toList();
    return RefreshIndicator(
      onRefresh: () => _load(reset: true),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(12, 18, 12, 32),
        children: [
          Text(
            _wealth
                ? 'الحسابات التي تلقّت دعماً من صاحب الملف'
                : 'الحسابات التي دعمت صاحب الملف',
            style: const TextStyle(color: Colors.white70, fontSize: 12),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          _podium(top),
          const SizedBox(height: 18),
          for (final item in others) _supportRow(item),
          if (_nextCursor != null)
            Center(
              child: TextButton(
                key: Key('public-support-more-${widget.metric}'),
                onPressed: _loadingMore ? null : () => _load(reset: false),
                child: _loadingMore
                    ? const CircularProgressIndicator()
                    : const Text('تحميل المزيد'),
              ),
            ),
          if (_error != null)
            TextButton(
              onPressed: () => _load(reset: _nextCursor == null),
              child: Text(_error!),
            ),
        ],
      ),
    );
  }
}
