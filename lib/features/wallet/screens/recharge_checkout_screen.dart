import 'dart:async';

import 'package:flutter/material.dart';
import 'package:in_app_purchase/in_app_purchase.dart';

import '../../../utils/compact_number.dart';
import '../services/google_play_billing_service.dart';

class RechargeCheckoutScreen extends StatefulWidget {
  const RechargeCheckoutScreen({super.key});

  @override
  State<RechargeCheckoutScreen> createState() =>
      _RechargeCheckoutScreenState();
}

class _RechargeCheckoutScreenState extends State<RechargeCheckoutScreen> {
  bool _initialized = false;
  bool _storeLoading = false;
  bool _purchaseBusy = false;
  String? _storeError;
  ProductDetails? _playProduct;
  StreamSubscription<List<PurchaseDetails>>? _purchaseSubscription;
  Map<String, dynamic> _args = const <String, dynamic>{};
  final Set<String> _processingPurchases = <String>{};

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    _initialized = true;

    final raw = ModalRoute.of(context)?.settings.arguments;
    _args = raw is Map
        ? Map<String, dynamic>.from(raw)
        : const <String, dynamic>{};

    if (GooglePlayBillingService.supported) {
      _purchaseSubscription =
          GooglePlayBillingService.purchaseStream.listen(
        _handlePurchases,
        onError: (Object error) {
          if (!mounted) return;
          setState(() {
            _purchaseBusy = false;
            _storeError = error.toString();
          });
        },
      );
      _loadGooglePlayProduct();
    }
  }

  @override
  void dispose() {
    _purchaseSubscription?.cancel();
    super.dispose();
  }

  int get _coins => (_args['coins'] as num?)?.toInt() ?? 0;
  int get _baseCoins => (_args['baseCoins'] as num?)?.toInt() ?? _coins;
  int get _bonusCoins => (_args['bonusCoins'] as num?)?.toInt() ?? 0;
  num get _price => (_args['price'] as num?) ?? 0;
  String get _productId => (_args['productId'] ?? '').toString();

  Future<void> _loadGooglePlayProduct() async {
    if (_productId.isEmpty) {
      setState(() => _storeError = 'Product ID غير محدد لهذه الباقة.');
      return;
    }
    setState(() {
      _storeLoading = true;
      _storeError = null;
    });
    try {
      final product =
          await GooglePlayBillingService.loadProduct(_productId);
      if (!mounted) return;
      setState(() {
        _playProduct = product;
        _storeLoading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _storeLoading = false;
        _storeError = error.toString();
      });
    }
  }

  Future<void> _startPurchase() async {
    final product = _playProduct;
    if (!GooglePlayBillingService.supported) {
      _message('Google Play Billing متاح داخل تطبيق Android فقط.');
      return;
    }
    if (product == null) {
      _message(_storeError ?? 'جار تحميل منتج Google Play.');
      return;
    }

    setState(() => _purchaseBusy = true);
    try {
      final started = await GooglePlayBillingService.buy(product);
      if (!started && mounted) {
        setState(() => _purchaseBusy = false);
        _message('تعذر فتح نافذة Google Play.');
      }
    } catch (error) {
      if (!mounted) return;
      setState(() => _purchaseBusy = false);
      _message(error.toString());
    }
  }

  Future<void> _handlePurchases(
    List<PurchaseDetails> purchases,
  ) async {
    for (final purchase in purchases) {
      if (purchase.productID != _productId) continue;

      if (purchase.status == PurchaseStatus.pending) {
        if (!mounted) continue;
        setState(() => _purchaseBusy = true);
        _message('عملية الدفع معلقة في Google Play.');
        continue;
      }

      if (purchase.status == PurchaseStatus.error) {
        if (!mounted) continue;
        setState(() => _purchaseBusy = false);
        _message(
          purchase.error?.message ?? 'فشلت عملية Google Play.',
        );
        continue;
      }

      if (purchase.status == PurchaseStatus.canceled) {
        if (!mounted) continue;
        setState(() => _purchaseBusy = false);
        _message('تم إلغاء عملية الدفع.');
        continue;
      }

      if (purchase.status != PurchaseStatus.purchased &&
          purchase.status != PurchaseStatus.restored) {
        continue;
      }

      final key = purchase.purchaseID ??
          purchase.verificationData.serverVerificationData;
      if (_processingPurchases.contains(key)) continue;
      _processingPurchases.add(key);

      try {
        final result =
            await GooglePlayBillingService.verifyAndCredit(purchase);
        final credited = (result['coins'] as num?)?.toInt() ?? _coins;
        if (!mounted) return;
        setState(() => _purchaseBusy = false);
        _message(
          'تم اعتماد الشحن وإضافة ' +
              formatCompactAmount(credited) +
              ' عملة.',
        );
        Navigator.pop(context, true);
      } catch (error) {
        _processingPurchases.remove(key);
        if (!mounted) return;
        setState(() => _purchaseBusy = false);
        _message(error.toString());
      }
    }
  }

  void _message(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(text)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final storePrice =
        _playProduct?.price ?? ('USD ' + _price.toStringAsFixed(2));

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 26),
            children: [
              Row(
                children: [
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(
                      Icons.arrow_forward_ios_rounded,
                      color: Colors.white,
                    ),
                  ),
                  const Expanded(
                    child: Text(
                      'إتمام عملية الشحن',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  const SizedBox(width: 48),
                ],
              ),
              const SizedBox(height: 18),
              _card(
                child: Row(
                  children: [
                    const Icon(
                      Icons.monetization_on_rounded,
                      color: Color(0xFFFFC83D),
                      size: 48,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            formatCompactAmount(_coins) + ' عملة ذهبية',
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w900,
                              fontSize: 17,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            storePrice,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 20,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ],
                      ),
                    ),
                    TextButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('تغيير الباقة'),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 26),
              const Text(
                '💳 طريقة الدفع',
                style: TextStyle(
                  color: Color(0xFFC9B8FF),
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 12),
              _paymentMethod(
                icon: Icons.play_arrow_rounded,
                title: 'Google Play',
                subtitle: GooglePlayBillingService.supported
                    ? 'الطريقة الأساسية للشحن داخل Android'
                    : 'تظهر عملية الدفع الفعلية داخل تطبيق Android',
                active: true,
              ),
              _paymentMethod(
                icon: Icons.credit_card_rounded,
                title: 'بطاقة ائتمان / خصم مباشر',
                subtitle: 'سيتم إضافتها لاحقاً',
                active: false,
              ),
              _paymentMethod(
                icon: Icons.account_balance_wallet_rounded,
                title: 'طرق دفع إضافية',
                subtitle: 'PayPal / Apple Pay / طرق محلية — لاحقاً',
                active: false,
              ),
              const SizedBox(height: 14),
              const Text(
                '🧾 تفاصيل الطلب',
                style: TextStyle(
                  color: Color(0xFFC9B8FF),
                  fontSize: 18,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 10),
              _card(
                child: Column(
                  children: [
                    _row(
                      'Coins الأساسية',
                      formatCompactAmount(_baseCoins) + ' عملة',
                    ),
                    if (_bonusCoins > 0)
                      _row(
                        'Bonus',
                        '+' + formatCompactAmount(_bonusCoins) + ' عملة',
                      ),
                    _row(
                      'المجموع المستلم',
                      formatCompactAmount(_coins) + ' عملة ذهبية',
                    ),
                    _row('السعر المرجعي', storePrice),
                    const Divider(color: Colors.white12, height: 28),
                    _row(
                      'التحقق',
                      'Google Play + Shadow Server',
                      strong: true,
                    ),
                  ],
                ),
              ),
              if (_storeLoading) ...[
                const SizedBox(height: 16),
                const LinearProgressIndicator(),
              ],
              if (_storeError != null) ...[
                const SizedBox(height: 12),
                Text(
                  _storeError!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Colors.orangeAccent,
                    fontSize: 12,
                  ),
                ),
              ],
              const SizedBox(height: 20),
              Container(
                height: 58,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    colors: [
                      Color(0xFFE32AD2),
                      Color(0xFF7A2CFF),
                      Color(0xFF3F67FF),
                    ],
                  ),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: TextButton(
                  onPressed: _purchaseBusy ? null : _startPurchase,
                  child: _purchaseBusy
                      ? const SizedBox(
                          width: 22,
                          height: 22,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Text(
                          '🔒 إتمام الدفع عبر Google Play',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 18,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                ),
              ),
              const SizedBox(height: 12),
              const Text(
                'لا تتم إضافة العملات إلا بعد تحقق Shadow Server من Purchase Token لدى Google Play.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: Colors.white54,
                  fontSize: 11,
                  height: 1.5,
                ),
              ),
              const SizedBox(height: 20),
              ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Image.asset(
                  'assets/images/shadow_footer.png',
                  width: double.infinity,
                  fit: BoxFit.fitWidth,
                  errorBuilder: (_, __, ___) =>
                      const SizedBox.shrink(),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _paymentMethod({
    required IconData icon,
    required String title,
    required String subtitle,
    required bool active,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Container(
        padding: const EdgeInsets.all(15),
        decoration: BoxDecoration(
          color: const Color(0xFF101222),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color: active ? const Color(0xFF8D48FF) : Colors.white10,
            width: active ? 1.5 : 1,
          ),
        ),
        child: Row(
          children: [
            Icon(
              active
                  ? Icons.radio_button_checked
                  : Icons.lock_clock_outlined,
              color: active
                  ? const Color(0xFF9C68FF)
                  : Colors.white24,
            ),
            const SizedBox(width: 12),
            Icon(
              icon,
              color: active
                  ? const Color(0xFF6C8CFF)
                  : Colors.white38,
              size: 31,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      color: active ? Colors.white : Colors.white54,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    subtitle,
                    style: const TextStyle(
                      color: Colors.white54,
                      fontSize: 12,
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

  Widget _card({required Widget child}) => Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: const Color(0xFF101222),
          borderRadius: BorderRadius.circular(17),
          border: Border.all(color: Colors.white10),
        ),
        child: child,
      );

  Widget _row(String a, String b, {bool strong = false}) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                a,
                style: TextStyle(
                  color: strong ? Colors.white : Colors.white60,
                  fontWeight:
                      strong ? FontWeight.w900 : FontWeight.w500,
                ),
              ),
            ),
            Text(
              b,
              style: TextStyle(
                color:
                    strong ? const Color(0xFFFFC83D) : Colors.white,
                fontSize: strong ? 15 : 14,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      );
}
