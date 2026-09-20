import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'firebase_options.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  runApp(const ShadowControlApp());
}

class ShadowControlApp extends StatelessWidget {
  const ShadowControlApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'Shadow Control',
    theme: ThemeData.dark(useMaterial3: true).copyWith(
      scaffoldBackgroundColor: const Color(0xFF07050D),
      cardTheme: const CardThemeData(color: Color(0xFF151022)),
      navigationBarTheme: const NavigationBarThemeData(backgroundColor: Color(0xFF0D0917), indicatorColor: Color(0x443F2B71)),
    ),
    home: const Directionality(textDirection: TextDirection.rtl, child: AdminGate()),
  );
}

class AdminGate extends StatelessWidget {
  const AdminGate({super.key});
  @override
  Widget build(BuildContext context) => StreamBuilder<User?>(
    stream: FirebaseAuth.instance.authStateChanges(),
    builder: (context, auth) {
      if (auth.connectionState == ConnectionState.waiting) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final user = auth.data;
      if (user == null) return const AdminSignInPage();
      return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        future: FirebaseFirestore.instance.collection('users').doc(user.uid).get(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Scaffold(body: Center(child: CircularProgressIndicator()));
          }
          final data = snap.data?.data();
          final role = '${data?['role'] ?? 'user'}';
          final enabled = data?['adminEnabled'] == true;
          if (data == null || (role != 'owner' && !enabled)) {
            return const AccessDeniedPage();
          }
          return const ControlShell();
        },
      );
    },
  );
}

class AdminSignInPage extends StatefulWidget {
  const AdminSignInPage({super.key});
  @override
  State<AdminSignInPage> createState() => _AdminSignInPageState();
}

class _AdminSignInPageState extends State<AdminSignInPage> {
  final email = TextEditingController();
  final password = TextEditingController();
  bool busy = false;
  String? error;

  Future<void> submit() async {
    setState(() { busy = true; error = null; });
    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: email.text.trim(),
        password: password.text,
      );
    } on FirebaseAuthException catch (e) {
      if (mounted) setState(() => error = e.message ?? e.code);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.all(24),
          children: [
            const Icon(Icons.admin_panel_settings, size: 64, color: Color(0xFFD7B85A)),
            const SizedBox(height: 16),
            const Text('Shadow Control', textAlign: TextAlign.center, style: TextStyle(fontSize: 28, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text('دخول الإدارة', textAlign: TextAlign.center),
            const SizedBox(height: 24),
            TextField(controller: email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'البريد الإلكتروني', border: OutlineInputBorder())),
            const SizedBox(height: 12),
            TextField(controller: password, obscureText: true, onSubmitted: (_) => submit(), decoration: const InputDecoration(labelText: 'كلمة المرور', border: OutlineInputBorder())),
            if (error != null) ...[const SizedBox(height: 10), Text(error!, style: const TextStyle(color: Colors.redAccent))],
            const SizedBox(height: 16),
            FilledButton.icon(onPressed: busy ? null : submit, icon: const Icon(Icons.login), label: Text(busy ? 'جار التحقق...' : 'تسجيل الدخول')),
          ],
        ),
      ),
    ),
  );
}

class AccessDeniedPage extends StatelessWidget {
  const AccessDeniedPage({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
    body: Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Icon(Icons.gpp_bad_outlined, size: 64, color: Colors.orangeAccent),
          const SizedBox(height: 16),
          const Text('لا توجد صلاحية إدارية', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 8),
          const Text('الحساب مسجل لكنه غير مخول لدخول Shadow Control.', textAlign: TextAlign.center),
          const SizedBox(height: 18),
          OutlinedButton.icon(onPressed: () => FirebaseAuth.instance.signOut(), icon: const Icon(Icons.logout), label: const Text('تسجيل الخروج')),
        ]),
      ),
    ),
  );
}

class ControlShell extends StatefulWidget {
  const ControlShell({super.key});
  @override State<ControlShell> createState()=>_ControlShellState();
}

class _ControlShellState extends State<ControlShell> {
  int index=0;
  @override Widget build(BuildContext context) {
    final pages=[
      DashboardPage(onOpen:(i)=>setState(()=>index=i)),
      const UsersPage(),
      const RoomsPage(),
      const FinancePage(),
      const MorePage(),
    ];
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D0917),
        title: const Column(crossAxisAlignment: CrossAxisAlignment.start,children:[
          Text('Shadow Control',style:TextStyle(fontWeight:FontWeight.w800)),
          Text('بيئة تجريبية • Firebase متصل',style:TextStyle(fontSize:11,color:Color(0xFFD7B85A))),
        ]),
        actions:[Padding(padding:const EdgeInsets.symmetric(horizontal:14),child:CircleAvatar(child:Icon(FirebaseAuth.instance.currentUser==null?Icons.admin_panel_settings_outlined:Icons.verified_user_outlined)))],
      ),
      body: IndexedStack(index:index,children:pages),
      bottomNavigationBar:NavigationBar(selectedIndex:index,onDestinationSelected:(v)=>setState(()=>index=v),destinations:const[
        NavigationDestination(icon:Icon(Icons.dashboard_outlined),selectedIcon:Icon(Icons.dashboard),label:'الرئيسية'),
        NavigationDestination(icon:Icon(Icons.people_outline),selectedIcon:Icon(Icons.people),label:'المستخدمون'),
        NavigationDestination(icon:Icon(Icons.mic_none),selectedIcon:Icon(Icons.mic),label:'الغرف'),
        NavigationDestination(icon:Icon(Icons.wallet_outlined),selectedIcon:Icon(Icons.wallet),label:'المالية'),
        NavigationDestination(icon:Icon(Icons.more_horiz),label:'المزيد'),
      ]),
    );
  }
}

class DashboardPage extends StatelessWidget {
  const DashboardPage({super.key,required this.onOpen});
  final ValueChanged<int> onOpen;
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(16),children:[
    const Text('لوحة التحكم',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900)),
    const SizedBox(height:4),const Text('نظرة سريعة على Shadow Live',style:TextStyle(color:Color(0xFFAAA3B8))),const SizedBox(height:16),
    const Wrap(spacing:10,runSpacing:10,children:[
      StatCard(icon:Icons.people_alt_outlined,label:'المستخدمون',value:'إدارة'),
      StatCard(icon:Icons.mic_none,label:'الغرف',value:'مراقبة'),
      StatCard(icon:Icons.monetization_on_outlined,label:'العملات',value:'Coins'),
      StatCard(icon:Icons.diamond_outlined,label:'الألماس',value:'Diamonds'),
    ]),
    const SizedBox(height:18),
    Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      const Row(children:[Icon(Icons.science_outlined,color:Color(0xFFD7B85A)),SizedBox(width:8),Text('وضع الاختبار',style:TextStyle(fontSize:18,fontWeight:FontWeight.w800))]),
      const SizedBox(height:8),Text(FirebaseAuth.instance.currentUser==null?'Firebase جاهز. سجّل دخول بحساب الإدارة عند تفعيل بوابة الدخول؛ البيانات الحالية للاختبار.':'جلسة Firebase نشطة. العمليات الحساسة ستستخدم صلاحيات السيرفر وسجل الإدارة.',style:const TextStyle(height:1.55,color:Color(0xFFCBC5D6))),
    ]))),
    const SizedBox(height:12),const Text('اختصارات',style:TextStyle(fontSize:18,fontWeight:FontWeight.w800)),const SizedBox(height:8),
    Wrap(spacing:8,runSpacing:8,children:[
      ActionChip(label:const Text('إضافة عملات'),avatar:const Icon(Icons.add_circle_outline),onPressed:()=>onOpen(3)),
      ActionChip(label:const Text('إضافة ألماس'),avatar:const Icon(Icons.diamond_outlined),onPressed:()=>onOpen(3)),
      ActionChip(label:const Text('إدارة مستخدم'),avatar:const Icon(Icons.manage_accounts_outlined),onPressed:()=>onOpen(1)),
      ActionChip(label:const Text('مراجعة بلاغ'),avatar:const Icon(Icons.report_outlined),onPressed:()=>onOpen(4)),
    ]),
  ]);
}

class UsersPage extends StatelessWidget {
  const UsersPage({super.key});
  @override Widget build(BuildContext context)=>const ControlList(title:'المستخدمون',icon:Icons.people_alt_outlined,items:[
    ControlItem('إدارة الحسابات','بحث بالاسم أو ID وفتح تفاصيل الحساب',Icons.manage_accounts_outlined),
    ControlItem('الحظر والتنبيهات','مراجعة حالة الحساب والإجراءات الإدارية',Icons.gpp_maybe_outlined),
    ControlItem('الأدوار والصلاحيات','Owner / Admin / Moderator والصلاحيات المنفصلة',Icons.admin_panel_settings_outlined),
  ]);
}
class RoomsPage extends StatelessWidget {
  const RoomsPage({super.key});
  @override Widget build(BuildContext context)=>const ControlList(title:'الغرف',icon:Icons.mic_none_rounded,items:[
    ControlItem('الغرف النشطة','عرض الغرف الحالية وإدارة المضيفين',Icons.podcasts_outlined),
    ControlItem('الغرف المبلغ عنها','مراجعة البلاغات المرتبطة بالغرف',Icons.report_outlined),
    ControlItem('إدارة المضيفين','صلاحيات المضيف والكتم والمنع',Icons.record_voice_over_outlined),
  ]);
}
class FinancePage extends StatelessWidget {
  const FinancePage({super.key});
  @override Widget build(BuildContext context)=>const ControlList(title:'المالية',icon:Icons.account_balance_wallet_outlined,items:[
    ControlItem('العملات Coins','تعديل رصيد تجريبي عبر عملية إدارية مسجلة',Icons.monetization_on_outlined),
    ControlItem('الألماس Diamonds','إدارة رصيد الأرباح التجريبي',Icons.diamond_outlined),
    ControlItem('الشحن والمعاملات','مراجعة الشحن والسجل المالي',Icons.receipt_long_outlined),
    ControlItem('السحب والتسويات','طلبات السحب وتسويات الوكالات',Icons.payments_outlined),
  ]);
}
class MorePage extends StatelessWidget {
  const MorePage({super.key});
  @override Widget build(BuildContext context)=>const ControlList(title:'المزيد',icon:Icons.grid_view_rounded,items:[
    ControlItem('الوكالات','إدارة الوكالات والمضيفين والتسويات',Icons.apartment_outlined),
    ControlItem('التقارير','مراجعة بلاغات المستخدمين والمحتوى',Icons.flag_outlined),
    ControlItem('VIP و IDs الخاصة','إدارة VIP والمعرّفات الخاصة',Icons.workspace_premium_outlined),
    ControlItem('الإعدادات','إعدادات النظام وEmergency Lock',Icons.settings_outlined),
    ControlItem('سجل الإدارة','Audit Log للعمليات الحساسة',Icons.history_outlined),
  ]);
}

class ControlItem {
  const ControlItem(this.title,this.subtitle,this.icon);
  final String title,subtitle; final IconData icon;
}
class ControlList extends StatelessWidget {
  const ControlList({super.key,required this.title,required this.icon,required this.items});
  final String title; final IconData icon; final List<ControlItem> items;
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(16),children:[
    Row(children:[Icon(icon,size:28,color:const Color(0xFFD7B85A)),const SizedBox(width:10),Text(title,style:const TextStyle(fontSize:25,fontWeight:FontWeight.w900))]),
    const SizedBox(height:16),
    ...items.map((item)=>Card(child:ListTile(
      leading:Icon(item.icon,color:const Color(0xFFD7B85A)),trailing:const Icon(Icons.chevron_left),
      title:Text(item.title,style:const TextStyle(fontWeight:FontWeight.w700)),subtitle:Text(item.subtitle),
      onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>DetailPage(item:item))),
    ))),
  ]);
}
class DetailPage extends StatelessWidget {
  const DetailPage({super.key,required this.item}); final ControlItem item;
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:Text(item.title)),
    body:ListView(padding:const EdgeInsets.all(16),children:[
      Card(child:Padding(padding:const EdgeInsets.all(18),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Icon(item.icon,size:36,color:const Color(0xFFD7B85A)),const SizedBox(height:12),
        Text(item.title,style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900)),const SizedBox(height:8),
        Text(item.subtitle,style:const TextStyle(color:Color(0xFFCBC5D6),height:1.5)),
      ]))),
      const SizedBox(height:12),
      const Card(child:ListTile(leading:Icon(Icons.link,color:Color(0xFFD7B85A)),title:Text('مرحلة الربط'),subtitle:Text('الواجهة جاهزة. الإجراء الحقيقي سيُمرّر عبر ControlService مع الصلاحيات وAudit Log قبل تنفيذ أي تغيير.'))),
    ]),
  );
}
class StatCard extends StatelessWidget {
  const StatCard({super.key,required this.icon,required this.label,required this.value});
  final IconData icon; final String label,value;
  @override Widget build(BuildContext context)=>SizedBox(width:160,child:Card(child:Padding(padding:const EdgeInsets.all(14),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Icon(icon,color:const Color(0xFFD7B85A)),const SizedBox(height:14),Text(value,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900)),Text(label,style:const TextStyle(color:Color(0xFFAAA3B8))),
  ]))));
}
