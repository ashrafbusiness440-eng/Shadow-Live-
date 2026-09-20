import 'package:flutter/material.dart';

void main() {
  runApp(const ShadowControlApp());
}

class ShadowControlApp extends StatelessWidget {
  const ShadowControlApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Shadow Control',
      theme: ThemeData.dark(useMaterial3: true),
      home: const Directionality(
        textDirection: TextDirection.rtl,
        child: ControlStagingScreen(),
      ),
    );
  }
}

class ControlStagingScreen extends StatelessWidget {
  const ControlStagingScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF07050D),
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D0917),
        title: const Text('Shadow Control'),
        centerTitle: false,
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 760),
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: const [
              _StatusCard(
                icon: Icons.shield_outlined,
                title: 'نسخة Staging آمنة',
                body: 'هذه نقطة دخول مستقلة للوحة التحكم ولا تشغّل تطبيق Shadow Live الرئيسي.',
              ),
              SizedBox(height: 12),
              _StatusCard(
                icon: Icons.lock_outline,
                title: 'العمليات الحساسة مقفلة افتراضياً',
                body: 'لن يتم تنفيذ تغييرات مالية أو صلاحيات من هذه الواجهة قبل اكتمال ربط المصادقة والـBackend والتحقق من الجاهزية.',
              ),
              SizedBox(height: 12),
              _StatusCard(
                icon: Icons.construction_outlined,
                title: 'مرحلة الربط',
                body: 'الخطوة التالية: تسجيل دخول الإدارة، قراءة الصلاحيات، ثم ربط حالة الـControl API قبل تفعيل أي إجراء.',
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.icon,required this.title,required this.body});
  final IconData icon;
  final String title,body;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF151022),
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon,color: const Color(0xFFD7B85A)),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title,style: const TextStyle(fontSize: 18,fontWeight: FontWeight.w700)),
                  const SizedBox(height: 6),
                  Text(body,style: const TextStyle(height: 1.5,color: Color(0xFFCBC5D6))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
