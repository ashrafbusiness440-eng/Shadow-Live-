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

  Future<void> signInWithGoogle() async {
    setState(() { busy = true; error = null; });
    try {
      final provider = GoogleAuthProvider();
      provider.setCustomParameters({'prompt': 'select_account'});
      await FirebaseAuth.instance.signInWithPopup(provider);
    } on FirebaseAuthException catch (e) {
      if (mounted) setState(() => error = e.message ?? e.code);
    } catch (e) {
      if (mounted) setState(() => error = 'تعذر تسجيل الدخول باستخدام Google: $e');
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> resetPassword() async {
    final address = email.text.trim();
    if (address.isEmpty) {
      setState(() => error = 'اكتب بريدك الإلكتروني أولاً لإرسال رابط إعادة تعيين كلمة المرور.');
      return;
    }
    setState(() { busy = true; error = null; });
    try {
      await FirebaseAuth.instance.sendPasswordResetEmail(email: address);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('تم إرسال رابط إعادة تعيين كلمة المرور إلى $address')),
      );
    } on FirebaseAuthException catch (e) {
      if (mounted) setState(() => error = e.message ?? e.code);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

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
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: busy ? null : resetPassword,
                child: const Text('نسيت كلمة المرور؟'),
              ),
            ),
            if (error != null) ...[const SizedBox(height: 10), Text(error!, style: const TextStyle(color: Colors.redAccent))],
            const SizedBox(height: 16),
            FilledButton.icon(onPressed: busy ? null : submit, icon: const Icon(Icons.login), label: Text(busy ? 'جار التحقق...' : 'تسجيل الدخول')),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: busy ? null : signInWithGoogle,
              icon: const Icon(Icons.account_circle_outlined),
              label: const Text('الدخول باستخدام Google'),
            ),
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

class UsersPage extends StatefulWidget {
  const UsersPage({super.key});
  @override State<UsersPage> createState()=>_UsersPageState();
}

class _UsersPageState extends State<UsersPage> {
  String query='';
  String text(dynamic value)=>value==null?'':'$value';
  String displayName(Map<String,dynamic> d)=>text(d['displayName']).isNotEmpty?text(d['displayName']):(text(d['name']).isNotEmpty?text(d['name']):'مستخدم بدون اسم');
  bool matches(String uid,Map<String,dynamic> d){
    final q=query.trim().toLowerCase();
    if(q.isEmpty)return true;
    return [uid,d['displayName'],d['name'],d['email'],d['id'],d['userId'],d['username'],d['role']]
      .map((v)=>text(v).toLowerCase()).any((v)=>v.contains(q));
  }
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(16),children:[
    const Row(children:[Icon(Icons.people_alt_outlined,size:28,color:Color(0xFFD7B85A)),SizedBox(width:10),Text('المستخدمون',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900))]),
    const SizedBox(height:12),
    TextField(
      onChanged:(v)=>setState(()=>query=v),
      decoration:const InputDecoration(prefixIcon:Icon(Icons.search),hintText:'بحث بالاسم، البريد، ID أو الدور',border:OutlineInputBorder()),
    ),
    const SizedBox(height:12),
    StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(
      stream:FirebaseFirestore.instance.collection('users').limit(100).snapshots(),
      builder:(context,snap){
        if(snap.connectionState==ConnectionState.waiting)return const Padding(padding:EdgeInsets.all(32),child:Center(child:CircularProgressIndicator()));
        if(snap.hasError)return Card(child:ListTile(leading:const Icon(Icons.error_outline,color:Colors.orangeAccent),title:const Text('تعذر قراءة المستخدمين'),subtitle:Text('${snap.error}')));
        final docs=(snap.data?.docs??[]).where((d)=>matches(d.id,d.data())).toList();
        if(docs.isEmpty)return const Card(child:ListTile(leading:Icon(Icons.person_search_outlined),title:Text('لا توجد نتائج مطابقة')));
        return Column(children:docs.map((doc){
          final d=doc.data();
          final role=text(d['role']).isEmpty?'user':text(d['role']);
          final enabled=d['adminEnabled']==true;
          final caps=d['capabilities'] is List?(d['capabilities'] as List).length:0;
          final email=text(d['email']);
          final publicId=text(d['id']).isNotEmpty?text(d['id']):text(d['userId']);
          return Card(child:ListTile(
            leading:CircleAvatar(child:Icon(role=='owner'?Icons.workspace_premium:Icons.person_outline)),
            title:Text(displayName(d),style:const TextStyle(fontWeight:FontWeight.w800)),
            subtitle:Text([
              if(email.isNotEmpty) email,
              if(publicId.isNotEmpty) 'ID: $publicId',
              'الدور: $role',
              'الإدارة: ${enabled?'مفعلة':'غير مفعلة'} • الصلاحيات: $caps'
            ].join('\n')),
            isThreeLine:true,
            trailing:role=='owner'?const Icon(Icons.verified,color:Color(0xFFD7B85A)):const Icon(Icons.chevron_left),
            onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>UserReadOnlyPage(uid:doc.id,data:d))),
          ));
        }).toList());
      },
    ),
  ]);
}

class UserReadOnlyPage extends StatelessWidget {
  const UserReadOnlyPage({super.key,required this.uid,required this.data});
  final String uid; final Map<String,dynamic> data;
  String t(dynamic v)=>v==null?'—':'$v';
  @override Widget build(BuildContext context){
    final caps=data['capabilities'] is List?(data['capabilities'] as List).map((e)=>'$e').toList():<String>[];
    return Scaffold(
      appBar:AppBar(title:const Text('تفاصيل المستخدم')),
      body:ListView(padding:const EdgeInsets.all(16),children:[
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          Text(t(data['displayName']??data['name']),style:const TextStyle(fontSize:21,fontWeight:FontWeight.w900)),
          const SizedBox(height:12),
          SelectableText('UID: $uid'),
          Text('البريد: ${t(data['email'])}'),
          Text('الدور: ${t(data['role']??'user')}'),
          Text('دخول الإدارة: ${data['adminEnabled']==true?'مفعّل':'غير مفعّل'}'),
          Text('Coins: ${t(data['coins'])}'),
          Text('Diamonds: ${t(data['diamonds'])}'),
        ]))),
        const SizedBox(height:10),
        Card(child:ListTile(
          leading:const Icon(Icons.admin_panel_settings_outlined,color:Color(0xFFD7B85A)),
          title:const Text('الصلاحيات'),
          subtitle:Text(caps.isEmpty?'لا توجد صلاحيات إضافية':caps.join(' • ')),
        )),
        const SizedBox(height:10),
        _RolePolicyCard(role:t(data['role']??'user'),adminEnabled:data['adminEnabled']==true,capabilities:caps),
        const SizedBox(height:10),
        const Card(child:ListTile(
          leading:Icon(Icons.lock_outline,color:Color(0xFFD7B85A)),
          title:Text('وضع القراءة الآمن'),
          subtitle:Text('هذه الشاشة لا تعدّل الرتبة أو الرصيد. العمليات الحساسة ستبقى مقفلة حتى ربط Backend آمن مع Audit Log.'),
        )),
      ]),
    );
  }
}
class _RolePolicyCard extends StatelessWidget {
  const _RolePolicyCard({required this.role,required this.adminEnabled,required this.capabilities});
  final String role; final bool adminEnabled; final List<String> capabilities;
  static const labels=<String,String>{
    'viewUsers':'عرض المستخدمين','manageUsers':'إدارة المستخدمين','manageRooms':'إدارة الغرف',
    'reviewReports':'مراجعة البلاغات','manageEconomy':'إدارة الاقتصاد','manageWithdrawals':'إدارة السحب',
    'manageSettlements':'إدارة التسويات','manageRoles':'إدارة الأدوار','manageCapabilities':'إدارة الصلاحيات',
    'manageSystem':'إدارة النظام',
  };
  @override Widget build(BuildContext context){
    final isOwner=role=='owner';
    final roleLabel={'owner':'Owner — المالك','super_admin':'Super Admin','admin':'Admin','moderator':'Moderator','user':'User'}[role]??role;
    return Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Row(children:[const Icon(Icons.security_outlined,color:Color(0xFFD7B85A)),const SizedBox(width:8),Expanded(child:Text('سياسة الدور: $roleLabel',style:const TextStyle(fontWeight:FontWeight.w800)))]),
      const SizedBox(height:8),
      Text(isOwner?'حساب Owner محمي: لا يمكن خفض رتبته أو منح رتبة Owner لحساب آخر من واجهة العميل.':(adminEnabled?'دخول لوحة الإدارة مفعّل لهذا الحساب.':'دخول لوحة الإدارة غير مفعّل لهذا الحساب.')),
      const SizedBox(height:10),
      if(isOwner) const Wrap(spacing:6,runSpacing:6,children:[
        Chip(label:Text('كل الصلاحيات')),Chip(label:Text('Owner Protection')),Chip(label:Text('Recent Auth')),Chip(label:Text('Audit')),
      ]) else if(capabilities.isEmpty) const Text('لا توجد Capabilities إضافية.')
      else Wrap(spacing:6,runSpacing:6,children:capabilities.map((c)=>Chip(label:Text(labels[c]??c))).toList()),
      const SizedBox(height:10),
      const Divider(),
      const Text('التعديل مقفول حاليًا',style:TextStyle(fontWeight:FontWeight.w800)),
      const Text('تغيير الدور أو الصلاحيات سيُفعّل فقط عبر Backend موثّق مع Audit Log، وليس بكتابة مباشرة من PWA.'),
    ])));
  }
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
