import 'package:flutter/material.dart';
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
  static const packages = [
    (amount: 500, price: 4.99, image: 'assets/images/coins/coins_500.png'),
    (amount: 1200, price: 9.99, image: 'assets/images/coins/coins_1200.png'),
    (amount: 2500, price: 19.99, image: 'assets/images/coins/coins_2500.png'),
    (amount: 5000, price: 34.99, image: 'assets/images/coins/coins_5000.png'),
    (amount: 12000, price: 66.99, image: 'assets/images/coins/coins_12000.png'),
    (amount: 25000, price: 99.99, image: 'assets/images/coins/coins_25000.png'),
  ];

  @override
  void initState() { super.initState(); tab = widget.initialTab == 1 ? 1 : 0; }

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
              Row(children: [IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white)), const Expanded(child: Text('شحن الرصيد', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900))), const SizedBox(width: 48)]),
              const SizedBox(height: 10),
              Container(height: 58, decoration: BoxDecoration(color: const Color(0xFF101222), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF7B35FF))), child: Row(children: [_tab('🪙 العملات الذهبية', 0), _tab('💎 الألماس', 1)])),
              const SizedBox(height: 18),
              _asset('assets/images/recharge_banner.png', 190),
              const SizedBox(height: 22),
              Text(diamond ? '💎 اختر باقة الألماس المناسبة لك' : '🪙 اختر الباقة المناسبة لك', style: const TextStyle(color: Color(0xFFC9B8FF), fontSize: 18, fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: packages.length,
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 3, crossAxisSpacing: 10, mainAxisSpacing: 12, childAspectRatio: .72),
                itemBuilder: (_, i) {
                  final p = packages[i];
                  final active = selected == i;
                  return InkWell(
                    onTap: () => setState(() => selected = i),
                    borderRadius: BorderRadius.circular(17),
                    child: Container(
                      decoration: BoxDecoration(color: const Color(0xFF101222), borderRadius: BorderRadius.circular(17), border: Border.all(color: active ? const Color(0xFFBD43FF) : Colors.white10, width: active ? 1.5 : 1)),
                      child: Column(children: [
                        if (i == 1) _tag('🔥 الأكثر شعبية', const Color(0xFFFF3B72)),
                        if (i == 5) _tag('👑 أفضل قيمة', const Color(0xFF8A2CFF)),
                        Expanded(child: Center(child: SizedBox(width: 64, height: 64, child: diamond ? const Icon(Icons.diamond_rounded, color: Color(0xFF66E1FF), size: 58) : Image.asset(p.image, width: 64, height: 64, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Icon(Icons.monetization_on_rounded, color: Color(0xFFFFC93D), size: 48))))),
                        Text('${_format(p.amount)} ${diamond ? '💎' : '🪙'}', style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 8),
                        Container(width: double.infinity, padding: const EdgeInsets.symmetric(vertical: 10), decoration: const BoxDecoration(color: Color(0xFF201071), borderRadius: BorderRadius.vertical(bottom: Radius.circular(16))), child: Text('\$ ${p.price.toStringAsFixed(2)}', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w900)))
                      ]),
                    ),
                  );
                },
              ),
              const SizedBox(height: 22), const Divider(color: Colors.white12), const SizedBox(height: 14),
              const Text('🎁 لديك كود ترويجي؟', style: TextStyle(color: Color(0xFFC9B8FF), fontWeight: FontWeight.w800)), const SizedBox(height: 10),
              TextField(style: const TextStyle(color: Colors.white), decoration: InputDecoration(hintText: 'أدخل الكود هنا', hintStyle: const TextStyle(color: Colors.white38), suffixIcon: Padding(padding: const EdgeInsets.all(5), child: FilledButton(onPressed: () {}, child: const Text('تطبيق'))), filled: true, fillColor: const Color(0xFF101222), border: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: const BorderSide(color: Colors.white12)))),
              const SizedBox(height: 18), _asset('assets/images/recharge_features.png', 210), const SizedBox(height: 18),
              SizedBox(height: 54, child: FilledButton(onPressed: () {
                final p = packages[selected];
                Navigator.push(context, MaterialPageRoute(builder: (_) => const RechargeCheckoutScreen(), settings: RouteSettings(arguments: {diamond ? 'diamonds' : 'coins': p.amount, 'price': p.price, 'currencyType': diamond ? 'diamonds' : 'coins'})));
              }, style: FilledButton.styleFrom(backgroundColor: const Color(0xFF8A32FF), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))), child: Text(diamond ? 'متابعة لشحن الألماس' : 'متابعة إلى الدفع', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900))))
            ],
          ),
        ),
      ),
    );
  }

  Widget _tab(String text, int index) {
    final active = tab == index;
    return Expanded(child: InkWell(onTap: () => setState(() { tab = index; selected = 1; }), borderRadius: BorderRadius.circular(15), child: Container(alignment: Alignment.center, decoration: active ? BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF9A2EFF), Color(0xFF291065)]), borderRadius: BorderRadius.circular(15)) : null, child: Text(text, style: TextStyle(color: active ? Colors.white : const Color(0xFFB9A7E8), fontWeight: active ? FontWeight.w800 : FontWeight.w700)))));
  }

  Widget _tag(String text, Color color) => Container(width: double.infinity, padding: const EdgeInsets.symmetric(vertical: 4), decoration: BoxDecoration(color: color, borderRadius: const BorderRadius.vertical(top: Radius.circular(16))), child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)));
  Widget _asset(String path, double height) => ClipRRect(borderRadius: BorderRadius.circular(20), child: Image.asset(path, height: height, width: double.infinity, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(height: height, alignment: Alignment.center, color: const Color(0xFF121426), child: Text('الصورة غير موجودة: $path', textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white54)))));
  String _format(int n) => n.toString().replaceAllMapped(RegExp(r'(?<=\d)(?=(\d{3})+(?!\d))'), (_) => ',');
}
