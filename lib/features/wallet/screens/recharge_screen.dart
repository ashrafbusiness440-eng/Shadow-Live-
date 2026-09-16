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
    (amount: 500, price: 4.99, diamonds: 50, image: 'assets/images/coins/coins_500.png'),
    (amount: 1200, price: 9.99, diamonds: 120, image: 'assets/images/coins/coins_1200.png'),
    (amount: 2500, price: 19.99, diamonds: 250, image: 'assets/images/coins/coins_2500.png'),
    (amount: 5000, price: 34.99, diamonds: 500, image: 'assets/images/coins/coins_5000.png'),
    (amount: 12000, price: 66.99, diamonds: 1200, image: 'assets/images/coins/coins_12000.png'),
    (amount: 25000, price: 99.99, diamonds: 2500, image: 'assets/images/coins/coins_25000.png'),
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
              Row(children: [IconButton(onPressed: () => Navigator.maybePop(context), icon: const Icon(Icons.arrow_forward_ios_rounded, color: Colors.white)), Expanded(child: Text(diamond ? 'محفظة الألماس' : 'شحن الرصيد', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900))), const SizedBox(width: 48)]),
              const SizedBox(height: 10),
              Container(height: 58, decoration: BoxDecoration(color: const Color(0xFF101222), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF7B35FF))), child: Row(children: [_tab('🪙 العملات الذهبية', 0), _tab('💎 الألماس', 1)])),
              const SizedBox(height: 18),
              _asset('assets/images/recharge_banner.png', 170),
              if (diamond) ...[
                const SizedBox(height: 14),
                Container(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 14), decoration: BoxDecoration(color: const Color(0xFF101222), borderRadius: BorderRadius.circular(16), border: Border.all(color: const Color(0xFF5635A7))), child: const Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [Text('رصيد الألماس الحالي', style: TextStyle(color: Color(0xFFC9B8FF), fontWeight: FontWeight.w800)), Text('💎 0', style: TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900))])),
              ],
              const SizedBox(height: 22),
              Text(diamond ? '🪙 اختر باقة العملات المناسبة لك' : '🪙 اختر الباقة المناسبة لك', style: const TextStyle(color: Color(0xFFC9B8FF), fontSize: 18, fontWeight: FontWeight.w900)),
              if (diamond) const Padding(padding: EdgeInsets.only(top: 5), child: Text('استخدم ألماسك للحصول على العملات الذهبية', style: TextStyle(color: Colors.white54, fontSize: 13))),
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
                        Expanded(child: Center(child: Container(width: 70, height: 70, padding: const EdgeInsets.all(8), alignment: Alignment.center, child: Image.asset(p.image, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const Icon(Icons.monetization_on_rounded, color: Color(0xFFFFC93D), size: 46))))),
                        Text('🪙 ${_format(p.amount)}', style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w900)),
                        const SizedBox(height: 8),
                        Container(width: double.infinity, padding: const EdgeInsets.symmetric(vertical: 10), decoration: const BoxDecoration(color: Color(0xFF201071), borderRadius: BorderRadius.vertical(bottom: Radius.circular(16))), child: Text(diamond ? '💎 ${_format(p.diamonds)}' : '\$ ${p.price.toStringAsFixed(2)}', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w900)))
                      ]),
                    ),
                  );
                },
              ),
              const SizedBox(height: 22), const Divider(color: Colors.white12), const SizedBox(height: 14),
              if (diamond) ...[
                SizedBox(height: 54, child: FilledButton.icon(onPressed: () => _openGiftSheet(context), icon: const Icon(Icons.card_giftcard_rounded), label: const Text('إهداء العملات لصديق', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w900)), style: FilledButton.styleFrom(backgroundColor: const Color(0xFF7130D9), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))))),
              ] else ...[
                const Text('🎁 لديك كود ترويجي؟', style: TextStyle(color: Color(0xFFC9B8FF), fontWeight: FontWeight.w800)), const SizedBox(height: 10),
                TextField(style: const TextStyle(color: Colors.white), decoration: InputDecoration(hintText: 'أدخل الكود هنا', hintStyle: const TextStyle(color: Colors.white38), suffixIcon: Padding(padding: const EdgeInsets.all(5), child: FilledButton(onPressed: () {}, child: const Text('تطبيق'))), filled: true, fillColor: const Color(0xFF101222), border: OutlineInputBorder(borderRadius: BorderRadius.circular(15), borderSide: const BorderSide(color: Colors.white12)))),
              ],
              const SizedBox(height: 18),
              _asset('assets/images/recharge_features.png', 150),
              const SizedBox(height: 18),
              SizedBox(height: 54, child: FilledButton(onPressed: () {
                final p = packages[selected];
                if (diamond) {
                  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('سيتم استبدال 💎 ${p.diamonds} مقابل 🪙 ${_format(p.amount)} بعد ربط الرصيد بقاعدة البيانات.')));
                  return;
                }
                Navigator.push(context, MaterialPageRoute(builder: (_) => const RechargeCheckoutScreen(), settings: RouteSettings(arguments: {'coins': p.amount, 'price': p.price, 'currencyType': 'coins'})));
              }, style: FilledButton.styleFrom(backgroundColor: const Color(0xFF8A32FF), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16))), child: Text(diamond ? 'استبدال الألماس بالعملات' : 'متابعة إلى الدفع', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900))))
            ],
          ),
        ),
      ),
    );
  }

  void _openGiftSheet(BuildContext context) {
    final idController = TextEditingController();
    final amountController = TextEditingController();
    showModalBottomSheet(context: context, isScrollControlled: true, backgroundColor: const Color(0xFF101222), shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))), builder: (ctx) => Directionality(textDirection: TextDirection.rtl, child: Padding(padding: EdgeInsets.fromLTRB(20, 22, 20, MediaQuery.of(ctx).viewInsets.bottom + 24), child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      const Text('إهداء العملات لصديق 🎁', style: TextStyle(color: Colors.white, fontSize: 21, fontWeight: FontWeight.w900)),
      const SizedBox(height: 16),
      _input(idController, 'ID المستلم', Icons.badge_outlined),
      const SizedBox(height: 10),
      OutlinedButton(onPressed: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('سيتم التحقق من الاسم والصورة بعد ربط البحث بالـ ID.'))), child: const Text('تحقق من المستخدم')),
      const SizedBox(height: 10),
      _input(amountController, 'عدد العملات — الحد الأدنى 100', Icons.monetization_on_outlined),
      const SizedBox(height: 16),
      FilledButton(onPressed: () { Navigator.pop(ctx); _requestTransferPassword(context); }, style: FilledButton.styleFrom(backgroundColor: const Color(0xFF8A32FF), minimumSize: const Size.fromHeight(52)), child: const Text('إرسال', style: TextStyle(fontWeight: FontWeight.w900))),
    ]))));
  }

  void _requestTransferPassword(BuildContext context) {
    final password = TextEditingController();
    showDialog(context: context, builder: (ctx) => Directionality(textDirection: TextDirection.rtl, child: AlertDialog(backgroundColor: const Color(0xFF101222), title: const Text('كلمة سر المعاملات', style: TextStyle(color: Colors.white)), content: Column(mainAxisSize: MainAxisSize.min, children: [const Text('في أول استخدام ستحدد كلمة سر خاصة بالتحويلات. بعد ذلك ستُطلب للتأكيد عند كل إرسال.', style: TextStyle(color: Colors.white70)), const SizedBox(height: 12), TextField(controller: password, obscureText: true, style: const TextStyle(color: Colors.white), decoration: const InputDecoration(hintText: 'كلمة السر', hintStyle: TextStyle(color: Colors.white38), enabledBorder: OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)), focusedBorder: OutlineInputBorder(borderSide: BorderSide(color: Color(0xFF8A32FF)))))]), actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('إلغاء')), FilledButton(onPressed: () { Navigator.pop(ctx); ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('واجهة التحويل جاهزة؛ الحفظ الآمن والتنفيذ سيُربطان بخدمة الخادم.'))); }, child: const Text('تأكيد'))])));
  }

  Widget _input(TextEditingController controller, String hint, IconData icon) => TextField(controller: controller, keyboardType: TextInputType.number, style: const TextStyle(color: Colors.white), decoration: InputDecoration(prefixIcon: Icon(icon, color: const Color(0xFFC9B8FF)), hintText: hint, hintStyle: const TextStyle(color: Colors.white38), filled: true, fillColor: const Color(0xFF080A14), border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none)));

  Widget _tab(String text, int index) {
    final active = tab == index;
    return Expanded(child: InkWell(onTap: () => setState(() { tab = index; selected = 1; }), borderRadius: BorderRadius.circular(15), child: Container(alignment: Alignment.center, decoration: active ? BoxDecoration(gradient: const LinearGradient(colors: [Color(0xFF9A2EFF), Color(0xFF291065)]), borderRadius: BorderRadius.circular(15)) : null, child: Text(text, style: TextStyle(color: active ? Colors.white : const Color(0xFFB9A7E8), fontWeight: active ? FontWeight.w800 : FontWeight.w700)))));
  }

  Widget _tag(String text, Color color) => Container(width: double.infinity, padding: const EdgeInsets.symmetric(vertical: 4), decoration: BoxDecoration(color: color, borderRadius: const BorderRadius.vertical(top: Radius.circular(16))), child: Text(text, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)));
  Widget _asset(String path, double height) => ClipRRect(borderRadius: BorderRadius.circular(20), child: Image.asset(path, height: height, width: double.infinity, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(height: height, alignment: Alignment.center, color: const Color(0xFF121426), child: Text('الصورة غير موجودة: $path', textDirection: TextDirection.ltr, style: const TextStyle(color: Colors.white54)))));
  String _format(int n) => n.toString().replaceAllMapped(RegExp(r'(?<=\d)(?=(\d{3})+(?!\d))'), (_) => ',');
}
