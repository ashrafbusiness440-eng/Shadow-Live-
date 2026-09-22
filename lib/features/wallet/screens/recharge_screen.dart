import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../../utils/compact_number.dart';
import '../services/diamond_wallet_service.dart';
import '../services/recharge_config_service.dart';
import 'recharge_checkout_screen.dart';

class RechargeScreen extends StatefulWidget {
  final int initialTab;

  const RechargeScreen({super.key, this.initialTab = 0});

  @override
  State<RechargeScreen> createState() => _RechargeScreenState();
}

class _RechargeScreenState extends State<RechargeScreen> {
  late int tab;
  int selected = 1;
  bool _checkedPassword = false;
  final TextEditingController _diamondAmount = TextEditingController();

  StreamSubscription<List<RechargePackageConfig>>? _packageSubscription;
  List<RechargePackageConfig> _packages =
      List<RechargePackageConfig>.from(RechargeConfigService.fallbackPackages);

  @override
  void initState() {
    super.initState();
    tab = widget.initialTab == 1 ? 1 : 0;
    _packageSubscription = RechargeConfigService.watchPackages().listen(
      (items) {
        if (!mounted) return;
        setState(() {
          _packages = List<RechargePackageConfig>.from(items);
          if (selected >= _packages.length) {
            selected = _packages.isEmpty ? 0 : _packages.length - 1;
          }
        });
      },
      onError: (_) {},
    );
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (tab == 1) _ensurePassword();
    });
  }

  @override
  void dispose() {
    _packageSubscription?.cancel();
    _diamondAmount.dispose();
    super.dispose();
  }

  void _msg(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  Future<void> _ensurePassword() async {
    if (_checkedPassword) return;
    _checkedPassword = true;
    try {
      final state = await DiamondWalletService.loadState();
      if (!mounted || state['passwordSet'] == true) return;
      await _createPasswordDialog();
    } catch (error) {
      _checkedPassword = false;
      _msg('تعذر قراءة إعدادات محفظة الألماس: $error');
    }
  }

  Future<void> _createPasswordDialog() async {
    final password = TextEditingController();
    final confirm = TextEditingController();
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101222),
          title: const Text(
            'إنشاء كلمة سر الألماس',
            style: TextStyle(color: Colors.white),
          ),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'كلمة السر مستقلة عن تسجيل الدخول وتحمي التحويلات والمعاملات الحساسة.',
                style: TextStyle(color: Colors.white70),
              ),
              const SizedBox(height: 12),
              _dialogField(password, 'كلمة السر'),
              const SizedBox(height: 10),
              _dialogField(confirm, 'تأكيد كلمة السر'),
            ],
          ),
          actions: [
            FilledButton(
              onPressed: () async {
                if (password.text.length < 6) {
                  _msg('كلمة السر 6 خانات على الأقل.');
                  return;
                }
                if (password.text != confirm.text) {
                  _msg('كلمتا السر غير متطابقتين.');
                  return;
                }
                try {
                  await DiamondWalletService.setInitialPassword(password.text);
                  if (dialogContext.mounted) Navigator.pop(dialogContext);
                  _msg('تم إنشاء كلمة سر محفظة الألماس.');
                } catch (error) {
                  _msg(error.toString());
                }
              },
              child: const Text('حفظ'),
            ),
          ],
        ),
      ),
    );
  }

  Future<String?> _askWalletPassword(String title) async {
    final controller = TextEditingController();
    return showDialog<String>(
      context: context,
      builder: (dialogContext) => Directionality(
        textDirection: TextDirection.rtl,
        child: AlertDialog(
          backgroundColor: const Color(0xFF101222),
          title: Text(title, style: const TextStyle(color: Colors.white)),
          content: _dialogField(controller, 'كلمة سر الألماس'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('إلغاء'),
            ),
            FilledButton(
              onPressed: () {
                if (controller.text.isEmpty) return;
                Navigator.pop(dialogContext, controller.text);
              },
              child: const Text('تأكيد'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _exchangeDiamonds() async {
    final diamonds = int.tryParse(_diamondAmount.text.trim()) ?? 0;
    if (diamonds <= 0) {
      _msg('أدخل عدد الألماس المطلوب تحويله.');
      return;
    }
    final password = await _askWalletPassword('تأكيد تحويل الألماس');
    if (password == null) return;
    try {
      final coins = await DiamondWalletService.exchangeDiamondsForCoins(
        diamonds: diamonds,
        password: password,
      );
      _diamondAmount.clear();
      if (mounted) setState(() {});
      _msg(
        'تم تحويل ' +
            formatCompactAmount(diamonds) +
            ' ألماس إلى ' +
            formatCompactAmount(coins) +
            ' عملة.',
      );
    } catch (error) {
      _msg(error.toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final diamond = tab == 1;
    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 28),
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.maybePop(context),
                    icon: const Icon(
                      Icons.arrow_forward_ios_rounded,
                      color: Colors.white,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      diamond ? 'محفظة الألماس' : 'شحن الرصيد',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
              const SizedBox(height: 10),
              Container(
                height: 58,
                decoration: BoxDecoration(
                  color: const Color(0xFF101222),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFF7B35FF)),
                ),
                child: Row(
                  children: [
                    _tab('🪙 العملات الذهبية', 0),
                    _tab('💎 الألماس', 1),
                  ],
                ),
              ),
              const SizedBox(height: 18),
              _asset('assets/images/recharge_banner.png', 145),
              if (diamond) ...[
                const SizedBox(height: 12),
                _walletBalance(),
                const SizedBox(height: 16),
                _diamondExchangeCard(),
                const SizedBox(height: 14),
                SizedBox(
                  height: 54,
                  child: FilledButton.icon(
                    onPressed: _openGiftSheet,
                    icon: const Icon(Icons.card_giftcard_rounded),
                    label: const Text(
                      'إهداء الألماس لصديق 🎁',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF7130D9),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                  ),
                ),
              ] else ...[
                const SizedBox(height: 20),
                const Text(
                  '🪙 اختر الباقة المناسبة لك',
                  style: TextStyle(
                    color: Color(0xFFC9B8FF),
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 12),
                _rechargePackages(),
                const SizedBox(height: 20),
                const Divider(color: Colors.white12),
                const SizedBox(height: 12),
                const Text(
                  '🎁 لديك كود ترويجي؟',
                  style: TextStyle(
                    color: Color(0xFFC9B8FF),
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 10),
                TextField(
                  style: const TextStyle(color: Colors.white),
                  decoration: InputDecoration(
                    hintText: 'أدخل الكود هنا',
                    hintStyle: const TextStyle(color: Colors.white38),
                    filled: true,
                    fillColor: const Color(0xFF101222),
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                  ),
                ),
                const SizedBox(height: 16),
                _assetNatural('assets/images/recharge_features.png'),
                const SizedBox(height: 16),
                SizedBox(
                  height: 54,
                  child: FilledButton(
                    onPressed: () {
                      if (_packages.isEmpty) return;
                      final safeIndex = selected < _packages.length ? selected : _packages.length - 1;
                      final package = _packages[safeIndex];
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => const RechargeCheckoutScreen(),
                          settings: RouteSettings(
                            arguments: {
                              'coins': package.totalCoins,
                              'baseCoins': package.baseCoins,
                              'bonusCoins': package.bonusCoins,
                              'price': package.priceUsd,
                              'productId': package.productId,
                              'packageId': package.id,
                              'currencyType': 'coins',
                            },
                          ),
                        ),
                      );
                    },
                    style: FilledButton.styleFrom(
                      backgroundColor: const Color(0xFF8A32FF),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(16),
                      ),
                    ),
                    child: const Text(
                      'متابعة إلى الدفع',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _walletBalance() {
    return StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
      stream: DiamondWalletService.watchWallet(),
      builder: (_, snapshot) {
        final data = snapshot.data?.data() ?? const <String, dynamic>{};
        final diamonds = (data['diamonds'] as num?)?.toInt() ?? 0;
        final coins =
            (data['coins'] as num?)?.toInt() ??
            (data['balance'] as num?)?.toInt() ??
            0;
        return Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: const Color(0xFF101222),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF5635A7)),
          ),
          child: Row(
            children: [
              Expanded(
                child: _balanceValue(
                  'الألماس',
                  '💎 ' + formatCompactAmount(diamonds),
                ),
              ),
              Container(width: 1, height: 42, color: Colors.white12),
              Expanded(
                child: _balanceValue(
                  'العملات',
                  '🪙 ' + formatCompactAmount(coins),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _balanceValue(String label, String value) {
    return Column(
      children: [
        Text(
          label,
          style: const TextStyle(
            color: Color(0xFFC9B8FF),
            fontSize: 12,
            fontWeight: FontWeight.w800,
          ),
        ),
        const SizedBox(height: 5),
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 19,
            fontWeight: FontWeight.w900,
          ),
        ),
      ],
    );
  }

  Widget _diamondExchangeCard() {
    final diamonds = int.tryParse(_diamondAmount.text.trim()) ?? 0;
    final coins = diamonds * 10000;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF101222),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFF7B35FF)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'تحويل الألماس إلى عملات',
            style: TextStyle(
              color: Colors.white,
              fontSize: 18,
              fontWeight: FontWeight.w900,
            ),
          ),
          const SizedBox(height: 5),
          const Text(
            'السعر المعتمد: 1 💎 = 10,000 🪙',
            style: TextStyle(
              color: Color(0xFFC9B8FF),
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 14),
          TextField(
            controller: _diamondAmount,
            keyboardType: TextInputType.number,
            onChanged: (_) => setState(() {}),
            style: const TextStyle(color: Colors.white),
            decoration: InputDecoration(
              prefixIcon: const Icon(
                Icons.diamond_rounded,
                color: Color(0xFFC9B8FF),
              ),
              hintText: 'عدد الألماس',
              hintStyle: const TextStyle(color: Colors.white38),
              filled: true,
              fillColor: const Color(0xFF080A14),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(14),
                borderSide: BorderSide.none,
              ),
            ),
          ),
          const SizedBox(height: 12),
          Text(
            diamonds > 0
                ? 'ستحصل على 🪙 ' + formatCompactAmount(coins)
                : 'أدخل العدد لمشاهدة قيمة التحويل',
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 14),
          FilledButton.icon(
            onPressed: _exchangeDiamonds,
            icon: const Icon(Icons.swap_horiz_rounded),
            label: const Text(
              'تحويل الآن',
              style: TextStyle(fontWeight: FontWeight.w900),
            ),
            style: FilledButton.styleFrom(
              backgroundColor: const Color(0xFF8A32FF),
              minimumSize: const Size.fromHeight(50),
            ),
          ),
        ],
      ),
    );
  }

  Widget _rechargePackages() {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _packages.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 10,
        mainAxisSpacing: 12,
        childAspectRatio: .68,
      ),
      itemBuilder: (_, index) {
        final package = _packages[index];
        final active = selected == index;
        return InkWell(
          onTap: () => setState(() => selected = index),
          borderRadius: BorderRadius.circular(17),
          child: Container(
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              color: const Color(0xFF101222),
              borderRadius: BorderRadius.circular(17),
              border: Border.all(
                color:
                    active ? const Color(0xFFBD43FF) : Colors.white10,
                width: active ? 1.5 : 1,
              ),
            ),
            child: Column(
              children: [
                if (package.badge.isNotEmpty)
                  _tag(
                    package.badge == 'أفضل قيمة'
                        ? '👑 ' + package.badge
                        : '🔥 ' + package.badge,
                    package.badge == 'أفضل قيمة'
                        ? const Color(0xFF8A2CFF)
                        : const Color(0xFFFF3B72),
                  ),
                Expanded(
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.asset(
                        package.imageAsset,
                        fit: BoxFit.cover,
                        alignment: Alignment.center,
                        errorBuilder: (_, __, ___) => const Center(
                          child: Icon(
                            Icons.monetization_on_rounded,
                            color: Color(0xFFFFC93D),
                            size: 54,
                          ),
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.fromLTRB(4, 18, 4, 8),
                          decoration: const BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.topCenter,
                              end: Alignment.bottomCenter,
                              colors: [Colors.transparent, Color(0xE605060D)],
                            ),
                          ),
                          child: Text(
                            '🪙 ' + formatCompactAmount(package.totalCoins),
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 16,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 10),
                  decoration: const BoxDecoration(color: Color(0xFF201071)),
                  child: Text(
                    r'$ ' + package.priceUsd.toStringAsFixed(2),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 16,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _openGiftSheet() async {
    final id = TextEditingController();
    final amount = TextEditingController();
    Map<String, dynamic>? recipient;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF101222),
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => StatefulBuilder(
        builder: (sheetContext, setLocal) => Directionality(
          textDirection: TextDirection.rtl,
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              20,
              22,
              20,
              MediaQuery.of(sheetContext).viewInsets.bottom + 24,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'إهداء الألماس لصديق 🎁',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 21,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 6),
                const Text(
                  'المستلم يحصل على 10,000 عملة مقابل كل 1 ألماس.',
                  style: TextStyle(color: Colors.white60),
                ),
                const SizedBox(height: 14),
                _input(id, 'ID المستلم', Icons.badge_outlined),
                const SizedBox(height: 8),
                OutlinedButton(
                  onPressed: () async {
                    try {
                      final result =
                          await DiamondWalletService.findUserByPublicId(
                        id.text,
                      );
                      setLocal(() => recipient = result);
                      if (result == null) {
                        _msg('لم يتم العثور على مستخدم بهذا الـ ID.');
                      }
                    } catch (error) {
                      _msg(error.toString());
                    }
                  },
                  child: const Text('تحقق من المستخدم'),
                ),
                if (recipient != null) ...[
                  const SizedBox(height: 12),
                  _recipientCard(recipient!),
                ],
                const SizedBox(height: 12),
                _input(
                  amount,
                  'عدد الألماس',
                  Icons.diamond_outlined,
                  onChanged: (_) => setLocal(() {}),
                ),
                const SizedBox(height: 8),
                Text(
                  (int.tryParse(amount.text.trim()) ?? 0) > 0
                      ? 'سيستلم 🪙 ' +
                          formatCompactAmount(
                            (int.tryParse(amount.text.trim()) ?? 0) * 10000,
                          )
                      : 'أدخل عدد الألماس',
                  style: const TextStyle(color: Colors.white60),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: recipient == null
                      ? null
                      : () async {
                          final diamonds =
                              int.tryParse(amount.text.trim()) ?? 0;
                          if (diamonds <= 0) {
                            _msg('أدخل عدد ألماس صالح.');
                            return;
                          }
                          final recipientUid =
                              recipient!['uid'].toString();
                          Navigator.pop(sheetContext);
                          await _confirmDiamondGift(
                            recipientUid,
                            diamonds,
                          );
                        },
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF8A32FF),
                    minimumSize: const Size.fromHeight(52),
                  ),
                  child: const Text(
                    'إرسال',
                    style: TextStyle(fontWeight: FontWeight.w900),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _confirmDiamondGift(
    String recipientUid,
    int diamonds,
  ) async {
    final password = await _askWalletPassword('تأكيد إهداء الألماس');
    if (password == null) return;
    try {
      final coins = await DiamondWalletService.giftDiamonds(
        recipientUid: recipientUid,
        diamonds: diamonds,
        password: password,
      );
      _msg(
        'تم إرسال ' +
            formatCompactAmount(diamonds) +
            ' ألماس، وسيستلم المستخدم ' +
            formatCompactAmount(coins) +
            ' عملة.',
      );
    } catch (error) {
      _msg(error.toString());
    }
  }

  Widget _recipientCard(Map<String, dynamic> user) {
    final name =
        (user['displayName'] ?? user['username'] ?? 'مستخدم').toString();
    final id = (user['publicId'] ?? '').toString();
    final url =
        (user['profileImageUrl'] ?? user['avatarUrl'] ?? '').toString();
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: const Color(0xFF080A14),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          CircleAvatar(
            radius: 24,
            backgroundImage: url.isNotEmpty ? NetworkImage(url) : null,
            child: url.isEmpty ? const Icon(Icons.person) : null,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                Text(
                  'ID: $id',
                  style: const TextStyle(color: Colors.white54),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _dialogField(TextEditingController controller, String hint) =>
      TextField(
        controller: controller,
        obscureText: true,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.white38),
          filled: true,
          fillColor: const Color(0xFF080A14),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: BorderSide.none,
          ),
        ),
      );

  Widget _input(
    TextEditingController controller,
    String hint,
    IconData icon, {
    ValueChanged<String>? onChanged,
  }) =>
      TextField(
        controller: controller,
        keyboardType: TextInputType.number,
        onChanged: onChanged,
        style: const TextStyle(color: Colors.white),
        decoration: InputDecoration(
          prefixIcon: Icon(icon, color: const Color(0xFFC9B8FF)),
          hintText: hint,
          hintStyle: const TextStyle(color: Colors.white38),
          filled: true,
          fillColor: const Color(0xFF080A14),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(14),
            borderSide: BorderSide.none,
          ),
        ),
      );

  Widget _tab(String text, int index) {
    final active = tab == index;
    return Expanded(
      child: InkWell(
        onTap: () {
          setState(() {
            tab = index;
            selected = 1;
          });
          if (index == 1) _ensurePassword();
        },
        borderRadius: BorderRadius.circular(15),
        child: Container(
          alignment: Alignment.center,
          decoration: active
              ? BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [Color(0xFF9A2EFF), Color(0xFF291065)],
                  ),
                  borderRadius: BorderRadius.circular(15),
                )
              : null,
          child: Text(
            text,
            style: TextStyle(
              color: active ? Colors.white : const Color(0xFFB9A7E8),
              fontWeight: active ? FontWeight.w800 : FontWeight.w700,
            ),
          ),
        ),
      ),
    );
  }

  Widget _tag(String text, Color color) => Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(vertical: 4),
        decoration: BoxDecoration(
          color: color,
          borderRadius: const BorderRadius.vertical(
            top: Radius.circular(16),
          ),
        ),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 10,
            fontWeight: FontWeight.w800,
          ),
        ),
      );

  Widget _asset(String path, double height) => ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Image.asset(
          path,
          height: height,
          width: double.infinity,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => Container(
            height: height,
            color: const Color(0xFF121426),
          ),
        ),
      );

  Widget _assetNatural(String path) => ClipRRect(
        borderRadius: BorderRadius.circular(18),
        child: Image.asset(
          path,
          width: double.infinity,
          fit: BoxFit.fitWidth,
          errorBuilder: (_, __, ___) => Container(
            height: 105,
            color: const Color(0xFF121426),
          ),
        ),
      );
}
