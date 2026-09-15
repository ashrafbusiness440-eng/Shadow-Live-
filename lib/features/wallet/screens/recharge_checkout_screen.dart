import 'package:flutter/material.dart';

class RechargeCheckoutScreen extends StatefulWidget {
  const RechargeCheckoutScreen({super.key});

  @override
  State<RechargeCheckoutScreen> createState() => _RechargeCheckoutScreenState();
}

class _RechargeCheckoutScreenState extends State<RechargeCheckoutScreen> {
  int payment = 0;

  @override
  Widget build(BuildContext context) {
    final args = (ModalRoute.of(context)?.settings.arguments as Map?) ?? const {};
    final coins = args['coins'] ?? 1200;
    final price = (args['price'] ?? 9.99) as num;
    const methods = [
      ('بطاقة ائتمان / خصم مباشر', 'Visa, Mastercard, Maestro', Icons.credit_card_rounded),
      ('PayPal', 'دفع آمن وسريع', Icons.account_balance_wallet_rounded),
      ('Google Play', 'استخدام رصيد المتجر', Icons.play_arrow_rounded),
      ('Apple Pay', 'الدفع بواسطة Apple Pay', Icons.apple_rounded),
      ('طرق دفع محلية', 'حسب بلدك', Icons.wallet_rounded),
    ];

    return Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        backgroundColor: const Color(0xFF05060D),
        body: SafeArea(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(18, 8, 18, 26),
            children: [
              Row(children: [
                IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white)),
                const Expanded(child: Text('إتمام عملية الشحن', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900))),
                const SizedBox(width: 48),
              ]),
              const SizedBox(height: 18),
              _card(child: Row(children: [
                const Icon(Icons.monetization_on_rounded, color: Color(0xFFFFC83D), size: 48),
                const SizedBox(width: 12),
                Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text('${_format(coins)} عملة ذهبية', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w900, fontSize: 17)), const SizedBox(height: 4), Text('\$ ${price.toStringAsFixed(2)}', style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900))])),
                TextButton(onPressed: () => Navigator.pop(context), child: const Text('تغيير الباقة')),
              ])),
              const SizedBox(height: 26),
              const Text('💳  اختر طريقة الدفع', style: TextStyle(color: Color(0xFFC9B8FF), fontSize: 18, fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              ...List.generate(methods.length, (i) {
                final m = methods[i];
                final active = payment == i;
                return Padding(padding: const EdgeInsets.only(bottom: 10), child: InkWell(onTap: () => setState(() => payment = i), borderRadius: BorderRadius.circular(16), child: Container(padding: const EdgeInsets.all(15), decoration: BoxDecoration(color: const Color(0xFF101222), borderRadius: BorderRadius.circular(16), border: Border.all(color: active ? const Color(0xFF8D48FF) : Colors.white10, width: active ? 1.5 : 1)), child: Row(children: [Icon(active ? Icons.radio_button_checked : Icons.radio_button_off, color: active ? const Color(0xFF9C68FF) : Colors.white24), const SizedBox(width: 12), Icon(m.$3, color: active ? const Color(0xFF6C8CFF) : Colors.white70, size: 31), const SizedBox(width: 12), Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(m.$1, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800)), const SizedBox(height: 3), Text(m.$2, style: const TextStyle(color: Colors.white54, fontSize: 12))]))]))));
              }),
              const SizedBox(height: 14),
              const Text('🧾  تفاصيل الطلب', style: TextStyle(color: Color(0xFFC9B8FF), fontSize: 18, fontWeight: FontWeight.w900)),
              const SizedBox(height: 10),
              _card(child: Column(children: [
                _row('الباقة المختارة', '${_format(coins)} عملة ذهبية'),
                _row('السعر', '\$ ${price.toStringAsFixed(2)}'),
                _row('الرسوم', '\$ 0.00'),
                const Divider(color: Colors.white12, height: 28),
                _row('المجموع الكلي', '\$ ${price.toStringAsFixed(2)}', strong: true),
              ])),
              const SizedBox(height: 20),
              Container(height: 58, decoration: BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFFE32AD2), Color(0xFF7A2CFF), Color(0xFF3F67FF)]), borderRadius: BorderRadius.circular(16)), child: TextButton(onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('سيتم ربط بوابة الدفع الفعلية في مرحلة الدفع والشحن.'))), child: const Text('🔒  إتمام الدفع الآن', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w900)))),
              const SizedBox(height: 12),
              const Text('بإتمام عملية الدفع فإنك توافق على شروط الاستخدام وسياسة الخصوصية', textAlign: TextAlign.center, style: TextStyle(color: Colors.white54, fontSize: 11, height: 1.5)),
              const SizedBox(height: 20),
              ClipRRect(borderRadius: BorderRadius.circular(18), child: Image.asset('assets/images/shadow_footer.png', width: double.infinity, fit: BoxFit.fitWidth, errorBuilder: (_, __, ___) => const SizedBox.shrink())),
            ],
          ),
        ),
      ),
    );
  }

  Widget _card({required Widget child}) => Container(padding: const EdgeInsets.all(16), decoration: BoxDecoration(color: const Color(0xFF101222), borderRadius: BorderRadius.circular(17), border: Border.all(color: Colors.white10)), child: child);

  Widget _row(String a, String b, {bool strong = false}) => Padding(padding: const EdgeInsets.symmetric(vertical: 6), child: Row(children: [Expanded(child: Text(a, style: TextStyle(color: strong ? Colors.white : Colors.white60, fontWeight: strong ? FontWeight.w900 : FontWeight.w500))), Text(b, style: TextStyle(color: strong ? const Color(0xFFFFC83D) : Colors.white, fontSize: strong ? 18 : 14, fontWeight: FontWeight.w900))]));

  static String _format(dynamic n) => n.toString().replaceAllMapped(RegExp(r'(?<=\d)(?=(\d{3})+(?!\d))'), (_) => ',');
}
