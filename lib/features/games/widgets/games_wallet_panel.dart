import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../../../utils/compact_number.dart';
import '../../wallet/screens/recharge_screen.dart';

/// One server read when the games lobby opens, then only on user refresh or
/// return from recharge. No per-game reads, polling, or wallet listeners.
class GamesWalletPanel extends StatefulWidget {
  const GamesWalletPanel({
    super.key,
    this.loadSnapshot,
    this.openRecharge,
  });

  /// Test override; normal calls read the current user's existing wallet.
  final Future<Map<String, dynamic>?> Function()? loadSnapshot;
  final Future<void> Function()? openRecharge;

  @override
  State<GamesWalletPanel> createState() => _GamesWalletPanelState();
}

class _GamesWalletPanelState extends State<GamesWalletPanel> {
  bool _loading = true;
  bool _guest = false;
  bool _error = false;
  num? _coins;
  int _request = 0;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  @override
  void dispose() {
    _request++;
    super.dispose();
  }

  Future<Map<String, dynamic>?> _readRealBalance() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.isAnonymous) return null;
    final snapshot = await FirebaseFirestore.instance
        .collection('users')
        .doc(user.uid)
        .get(const GetOptions(source: Source.server));
    if (FirebaseAuth.instance.currentUser?.uid != user.uid) {
      throw StateError('account_changed');
    }
    return snapshot.data();
  }

  Future<void> _refresh() async {
    final request = ++_request;
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = false;
    });
    try {
      final isGuest = widget.loadSnapshot == null &&
          (FirebaseAuth.instance.currentUser == null ||
              FirebaseAuth.instance.currentUser!.isAnonymous);
      final data = await (widget.loadSnapshot?.call() ?? _readRealBalance());
      if (!mounted || request != _request) return;
      final raw = data?['coins'] ?? data?['balance'];
      final parsed = raw is num ? raw : num.tryParse(raw?.toString() ?? '');
      setState(() {
        _coins = parsed;
        _guest = isGuest;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || request != _request) return;
      setState(() {
        _coins = null;
        _guest = false;
        _error = true;
        _loading = false;
      });
    }
  }

  Future<void> _recharge() async {
    if (_loading || _guest) return;
    try {
      if (widget.openRecharge != null) {
        await widget.openRecharge!();
      } else {
        await Navigator.of(context).push<void>(
          MaterialPageRoute<void>(
            builder: (_) => const RechargeScreen(initialTab: 0),
          ),
        );
      }
    } finally {
      if (mounted) await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = _loading
        ? 'جاري تحميل الرصيد'
        : _guest
            ? 'سجّل الدخول لعرض رصيدك'
            : _error
                ? 'تعذر تحميل الرصيد'
                : _coins == null
                    ? 'الرصيد غير متاح'
                    : formatCompactAmount(_coins);
    return Container(
      key: const ValueKey('games-real-wallet'),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: const Color(0xFF141125),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF5D3C85)),
      ),
      child: Row(
        children: [
          const Icon(Icons.toll_rounded,
              color: Color(0xFFFFD54A), size: 22),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('رصيد الكوينز',
                    style: TextStyle(color: Colors.white60, fontSize: 11)),
                Text(
                  text,
                  key: const ValueKey('games-wallet-balance'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            key: const ValueKey('games-wallet-refresh'),
            tooltip: 'تحديث الرصيد',
            onPressed: _loading ? null : _refresh,
            icon: _loading
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.refresh_rounded, color: Colors.white70),
          ),
          if (!_guest)
            TextButton.icon(
              key: const ValueKey('games-wallet-recharge'),
              onPressed: _loading ? null : _recharge,
              icon: const Icon(Icons.add_circle_outline_rounded, size: 18),
              label: const Text('شحن'),
              style: TextButton.styleFrom(
                foregroundColor: const Color(0xFFFFD54A),
                padding: const EdgeInsets.symmetric(horizontal: 8),
              ),
            ),
        ],
      ),
    );
  }
}
