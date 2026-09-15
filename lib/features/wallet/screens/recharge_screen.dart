import 'package:flutter/material.dart';

class RechargeScreen extends StatelessWidget {
  const RechargeScreen({super.key});

  static const packages = <(String, String)>[
    ('500', '\$4.99'), ('1,200', '\$9.99'), ('2,500', '\$19.99'),
    ('5,000', '\$34.99'), ('12,000', '\$66.99'), ('25,000', '\$99.99'),
  ];

  @override
  Widget build(BuildContext context) => Directionality(
        textDirection: TextDirection.rtl,
        child: Scaffold(
          backgroundColor: const Color(0xFF05060D),
          appBar: AppBar(backgroundColor: const Color(0xFF090A11), title: const Text('شحن الرصيد'), centerTitle: true),
          body: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              ClipRRect(borderRadius: BorderRadius.circular(22), child: Image.asset('assets/images/recharge_banner.png', fit: BoxFit.cover)),
              const SizedBox(height: 18),
              const Text('اختر باقة العملات', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
              const SizedBox(height: 12),
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(crossAxisCount: 2, childAspectRatio: 1.18, crossAxisSpacing: 12, mainAxisSpacing: 12),
                itemCount: packages.length,
                itemBuilder: (context, i) {
                  final p = packages[i];
                  return Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: const Color(0xFF111321), borderRadius: BorderRadius.circular(18), border: Border.all(color: const Color(0xFF7B2CFF).withValues(alpha: .35))),
                    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
                      const Icon(Icons.monetization_on_rounded, color: Color(0xFFFFC84A), size: 34),
                      const SizedBox(height: 8),
                      Text(p.$1, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
                      Text(p.$2, style: const TextStyle(color: Color(0xFFFFC84A), fontWeight: FontWeight.w700)),
                    ]),
                  );
                },
              ),
            ],
          ),
        ),
      );
}
