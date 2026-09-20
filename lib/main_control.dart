import 'package:flutter/material.dart';

void main() => runApp(const ShadowControlApp());

class ShadowControlApp extends StatelessWidget {
  const ShadowControlApp({super.key});
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Shadow Control',
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF07050D),
        cardTheme: const CardThemeData(color: Color(0xFF151022)),
        navigationBarTheme: const NavigationBarThemeData(
          backgroundColor: Color(0xFF0D0917),
          indicatorColor: Color(0x443F2B71),
        ),
      ),
      home: const Directionality(textDirection: TextDirection.rtl, child: ControlShell()),
    );
  }
}

class ControlShell extends StatefulWidget {
  const ControlShell({super.key});
  @override
  State<ControlShell> createState() => _ControlShellState();
}

class _ControlShellState extends State<ControlShell> {
  int index = 0;
  final pages = const [
    DashboardPage(),
    SectionPage(title: 'المستخدمون', icon: Icons.people_alt_outlined, items: ['إدارة الحسابات', 'الحظر والتنبيهات', 'الأدوار والصلاحيات']),
    SectionPage(title: 'الغرف', icon: Icons.mic_none_rounded, items: ['الغرف النشطة', 'الغرف المبلغ عنها', 'إدارة المضيفين']),
    SectionPage(title: 'المالية', icon: Icons.account_balance_wallet_outlined, items: ['العملات', 'الألماس', 'الشحن والمعاملات']),
    SectionPage(title: 'المزيد', icon: Icons.grid_view_rounded, items: ['الوكالات', 'التقارير', 'الإعدادات', 'سجل الإدارة']),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D0917),
        title: const Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('Shadow Control', style: TextStyle(fontWeight: FontWeight.w800)),
          Text('بيئة تجريبية', style: TextStyle(fontSize: 11, color: Color(0xFFD7B85A))),
        ]),
        actions: const [Padding(padding: EdgeInsets.symmetric(horizontal: 14), child: CircleAvatar(child: Icon(Icons.admin_panel_settings_outlined)))],
      ),
      body: IndexedStack(index: index, children: pages),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (v) => setState(() => index = v),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.dashboard_outlined), selectedIcon: Icon(Icons.dashboard), label: 'الرئيسية'),
          NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'المستخدمون'),
          NavigationDestination(icon: Icon(Icons.mic_none), selectedIcon: Icon(Icons.mic), label: 'الغرف'),
          NavigationDestination(icon: Icon(Icons.wallet_outlined), selectedIcon: Icon(Icons.wallet), label: 'المالية'),
          NavigationDestination(icon: Icon(Icons.more_horiz), label: 'المزيد'),
        ],
      ),
    );
  }
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key});
  @override
  Widget build(BuildContext context) {
    return ListView(padding: const EdgeInsets.all(16), children: [
      const Text('لوحة التحكم', style: TextStyle(fontSize: 25, fontWeight: FontWeight.w900)),
      const SizedBox(height: 4),
      const Text('نظرة سريعة على Shadow Live', style: TextStyle(color: Color(0xFFAAA3B8))),
      const SizedBox(height: 16),
      const Wrap(spacing: 10, runSpacing: 10, children: [
        StatCard(icon: Icons.people_alt_outlined, label: 'المستخدمون', value: 'تجريبي'),
        StatCard(icon: Icons.mic_none, label: 'الغرف', value: 'تجريبي'),
        StatCard(icon: Icons.monetization_on_outlined, label: 'العملات', value: 'تجريبي'),
        StatCard(icon: Icons.diamond_outlined, label: 'الألماس', value: 'تجريبي'),
      ]),
      const SizedBox(height: 18),
      Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [Icon(Icons.science_outlined, color: Color(0xFFD7B85A)), SizedBox(width: 8), Text('وضع الاختبار', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800))]),
        SizedBox(height: 8),
        Text('الحسابات والأرصدة الحالية تجريبية. واجهات الإدارة مفتوحة للاختبار، وسيتم ربط البيانات الحقيقية والصلاحيات تدريجياً.', style: TextStyle(height: 1.55, color: Color(0xFFCBC5D6))),
      ]))),
      const SizedBox(height: 12),
      const Text('اختصارات', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
      const SizedBox(height: 8),
      const Wrap(spacing: 8, runSpacing: 8, children: [
        ActionChip(label: Text('إضافة عملات'), avatar: Icon(Icons.add_circle_outline)),
        ActionChip(label: Text('إضافة ألماس'), avatar: Icon(Icons.diamond_outlined)),
        ActionChip(label: Text('إدارة مستخدم'), avatar: Icon(Icons.manage_accounts_outlined)),
        ActionChip(label: Text('مراجعة بلاغ'), avatar: Icon(Icons.report_outlined)),
      ]),
    ]);
  }
}

class StatCard extends StatelessWidget {
  const StatCard({super.key, required this.icon, required this.label, required this.value});
  final IconData icon; final String label, value;
  @override
  Widget build(BuildContext context) => SizedBox(width: 160, child: Card(child: Padding(
    padding: const EdgeInsets.all(14),
    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Icon(icon, color: const Color(0xFFD7B85A)), const SizedBox(height: 14),
      Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900)),
      Text(label, style: const TextStyle(color: Color(0xFFAAA3B8))),
    ]),
  )));
}

class SectionPage extends StatelessWidget {
  const SectionPage({super.key, required this.title, required this.icon, required this.items});
  final String title; final IconData icon; final List<String> items;
  @override
  Widget build(BuildContext context) => ListView(padding: const EdgeInsets.all(16), children: [
    Row(children: [Icon(icon, size: 28, color: const Color(0xFFD7B85A)), const SizedBox(width: 10), Text(title, style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w900))]),
    const SizedBox(height: 16),
    ...items.map((item) => Card(child: ListTile(
      leading: const Icon(Icons.chevron_left, color: Color(0xFFD7B85A)),
      title: Text(item, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: const Text('جاهز للربط والاختبار'),
      onTap: () => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$item — واجهة الاختبار جاهزة للربط'))),
    ))),
  ]);
}
