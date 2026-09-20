import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'firebase_options.dart';

String formatCompactAmount(dynamic value){
  final n=num.tryParse('${value??0}')??0;
  String trim(double v){
    final s=v.toStringAsFixed(v.truncateToDouble()==v?0:1);
    return s.endsWith('.0')?s.substring(0,s.length-2):s;
  }
  if(n.abs()>=1000000)return '${trim(n/1000000)}M';
  if(n.abs()>=1000)return '${trim(n/1000)}K';
  return n.truncateToDouble()==n?n.toInt().toString():n.toString();
}

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
    const SizedBox(height:4),const Text('حالة Shadow Live الإدارية — قراءة مباشرة وآمنة',style:TextStyle(color:Color(0xFFAAA3B8))),const SizedBox(height:16),
    StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(
      stream:FirebaseFirestore.instance.collection('users').limit(100).snapshots(),
      builder:(context,snap){
        final docs=snap.data?.docs??[];
        final admins=docs.where((d)=>d.data()['adminEnabled']==true).length;
        final owners=docs.where((d)=>d.data()['role']=='owner').length;
        return Wrap(spacing:10,runSpacing:10,children:[
          StatCard(icon:Icons.people_alt_outlined,label:'المستخدمون',value:snap.hasError?'—':(snap.hasData?'${docs.length}':'...')),
          StatCard(icon:Icons.admin_panel_settings_outlined,label:'إدارة مفعلة',value:snap.hasError?'—':(snap.hasData?'$admins':'...')),
          StatCard(icon:Icons.workspace_premium_outlined,label:'Owner',value:snap.hasError?'—':(snap.hasData?'$owners':'...')),
          const StatCard(icon:Icons.shield_outlined,label:'الوضع',value:'Read-only'),
        ]);
      },
    ),
    const SizedBox(height:18),
    Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      const Row(children:[Icon(Icons.verified_user_outlined,color:Color(0xFFD7B85A)),SizedBox(width:8),Text('حالة الأمان',style:TextStyle(fontSize:18,fontWeight:FontWeight.w800))]),
      const SizedBox(height:8),
      Text(FirebaseAuth.instance.currentUser==null?'لا توجد جلسة Firebase نشطة.':'Firebase متصل والجلسة نشطة. بيانات المستخدمين والسجلات المتاحة تُقرأ مباشرة، بينما تغييرات الرتب والأرصدة والإجراءات الحساسة مقفلة حتى Backend موثّق + Audit Log.',style:const TextStyle(height:1.55,color:Color(0xFFCBC5D6))),
    ]))),
    const SizedBox(height:12),const Text('اختصارات آمنة',style:TextStyle(fontSize:18,fontWeight:FontWeight.w800)),const SizedBox(height:8),
    Wrap(spacing:8,runSpacing:8,children:[
      ActionChip(label:const Text('المستخدمون'),avatar:const Icon(Icons.manage_accounts_outlined),onPressed:()=>onOpen(1)),
      ActionChip(label:const Text('الغرف'),avatar:const Icon(Icons.mic_none_rounded),onPressed:()=>onOpen(2)),
      ActionChip(label:const Text('السجل المالي'),avatar:const Icon(Icons.receipt_long_outlined),onPressed:()=>onOpen(3)),
      ActionChip(label:const Text('السجلات والإعدادات'),avatar:const Icon(Icons.history_outlined),onPressed:()=>onOpen(4)),
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
          Text('Coins: ${formatCompactAmount(data['coins'])}'),
          Text('Diamonds: ${formatCompactAmount(data['diamonds'])}'),
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
        _OwnerEconomyCard(uid:uid,coins:data['coins'],diamonds:data['diamonds']),
        const SizedBox(height:10),
        const Card(child:ListTile(
          leading:Icon(Icons.lock_outline,color:Color(0xFFD7B85A)),
          title:Text('الكتابة المباشرة إلى Firestore ممنوعة'),
          subtitle:Text('تعديل الرصيد سيعمل فقط عبر Control Backend الموثّق، مع Recent Auth وFinancial Ledger وAudit Log.'),
        )),
      ]),
    );
  }
}
class _OwnerEconomyCard extends StatelessWidget {
  const _OwnerEconomyCard({required this.uid,required this.coins,required this.diamonds});
  final String uid; final dynamic coins,diamonds;
  @override Widget build(BuildContext context){
    final current=FirebaseAuth.instance.currentUser;
    return FutureBuilder<DocumentSnapshot<Map<String,dynamic>>>(
      future:current==null?null:FirebaseFirestore.instance.collection('users').doc(current.uid).get(),
      builder:(context,snap){
        final actor=snap.data?.data();
        final isOwner=actor?['role']=='owner'&&actor?['adminEnabled']==true;
        return Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          const Row(children:[Icon(Icons.account_balance_wallet_outlined,color:Color(0xFFD7B85A)),SizedBox(width:8),Text('إدارة Coins و Diamonds',style:TextStyle(fontWeight:FontWeight.w900))]),
          const SizedBox(height:8),Text('Coins: ${formatCompactAmount(coins)}   •   Diamonds: ${formatCompactAmount(diamonds)}'),const SizedBox(height:12),
          Wrap(spacing:8,runSpacing:8,children:[
            FilledButton.icon(onPressed:isOwner?()=>_openAdjustment(context,'coins'):null,icon:const Icon(Icons.monetization_on_outlined),label:const Text('تعديل Coins')),
            FilledButton.icon(onPressed:isOwner?()=>_openAdjustment(context,'diamonds'):null,icon:const Icon(Icons.diamond_outlined),label:const Text('تعديل Diamonds')),
          ]),
          const SizedBox(height:8),Text(isOwner?'صلاحية Owner مؤكدة. التعديلات تُنفذ عبر Control Backend وتُسجّل في Financial Ledger وAudit Log.':'هذه الأدوات مخصصة لحساب Owner.',style:const TextStyle(color:Color(0xFFAAA3B8))),
        ])));
      },
    );
  }
  Future<void> _openAdjustment(BuildContext context,String asset) async {
    final parentContext=context;
    final amount=TextEditingController(),reason=TextEditingController(); bool subtract=false;
    await showDialog(context:parentContext,builder:(dialogContext)=>StatefulBuilder(builder:(context,setState)=>AlertDialog(
      title:Text(asset=='coins'?'تعديل Coins':'تعديل Diamonds'),
      content:SizedBox(width:420,child:Column(mainAxisSize:MainAxisSize.min,children:[
        SegmentedButton<bool>(segments:const [ButtonSegment(value:false,label:Text('زيادة'),icon:Icon(Icons.add)),ButtonSegment(value:true,label:Text('خصم'),icon:Icon(Icons.remove))],selected:{subtract},onSelectionChanged:(v)=>setState(()=>subtract=v.first)),
        const SizedBox(height:12),
        TextField(controller:amount,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'المبلغ',border:OutlineInputBorder())),
        const SizedBox(height:12),
        TextField(controller:reason,maxLength:160,decoration:const InputDecoration(labelText:'سبب العملية',hintText:'مثال: مكافأة اختبار',border:OutlineInputBorder())),
        const SizedBox(height:6),
        const Text('سيتم تسجيل الرصيد قبل وبعد العملية والسبب وهوية الـOwner في Financial Ledger وAudit Log.',style:TextStyle(fontSize:12,color:Color(0xFFAAA3B8))),
      ])),
      actions:[
        TextButton(onPressed:()=>Navigator.pop(dialogContext),child:const Text('إلغاء')),
        FilledButton(onPressed:(){
          final value=num.tryParse(amount.text.trim());
          if(value==null||value<=0||reason.text.trim().length<3){
            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('أدخل مبلغًا أكبر من صفر وسببًا من 3 أحرف على الأقل.'))); return;
          }
          final delta=subtract?-value:value;
          final why=reason.text.trim();
          Navigator.pop(dialogContext);
          WidgetsBinding.instance.addPostFrameCallback((_){
            if(parentContext.mounted)_confirmAndExecute(parentContext,asset,delta,why);
          });
        },child:const Text('مراجعة العملية')),
      ],
    )));
    amount.dispose(); reason.dispose();
  }
  Future<void> _confirmAndExecute(BuildContext context,String asset,num delta,String reason) async {
    final current=asset=='coins'?num.tryParse('${coins??0}')??0:num.tryParse('${diamonds??0}')??0;
    final projected=current+delta;
    final ok=await showDialog<bool>(context:context,builder:(c)=>AlertDialog(
      title:const Text('تأكيد تعديل الرصيد'),
      content:Text('الحالي: ${formatCompactAmount(current)}\nالتغيير: ${delta>0?'+':''}${formatCompactAmount(delta.abs())}\nبعد العملية: ${formatCompactAmount(projected)}\nالسبب: $reason'),
      actions:[TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),FilledButton(onPressed:projected<0?null:()=>Navigator.pop(c,true),child:const Text('تنفيذ'))],
    ));
    if(ok!=true||!context.mounted)return;
    try{
      final user=FirebaseAuth.instance.currentUser;if(user==null)throw Exception('not_signed_in');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('empty_token');
      final key='bal_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=Uri(scheme:Uri.base.scheme,host:Uri.base.host,port:Uri.base.hasPort?Uri.base.port:null,path:'/api/adjust-balance');
      final response=await http.post(apiUri,headers:{'Content-Type':'application/json','Authorization':'Bearer $token'},body:jsonEncode({'targetId':uid,'asset':asset,'delta':delta,'reason':reason,'idempotencyKey':key})).timeout(const Duration(seconds:20));
      final body=jsonDecode(response.body) as Map<String,dynamic>;
      if(response.statusCode!=200||body['ok']!=true)throw Exception(body['code']??'request_failed');
      if(context.mounted){ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('تم تعديل الرصيد بنجاح: ${formatCompactAmount(body['before'])} → ${formatCompactAmount(body['after'])}')));Navigator.pop(context);}
    }catch(e){
      if(context.mounted){ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('تعذر تنفيذ العملية: $e'),duration:const Duration(seconds:6)));}
    }
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
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(16),children:[
    const Row(children:[Icon(Icons.mic_none_rounded,size:28,color:Color(0xFFD7B85A)),SizedBox(width:10),Text('الغرف',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900))]),
    const SizedBox(height:16),
    const Card(child:ListTile(
      leading:Icon(Icons.shield_outlined,color:Color(0xFFD7B85A)),
      title:Text('الربط الآمن قيد التجهيز',style:TextStyle(fontWeight:FontWeight.w800)),
      subtitle:Text('Firestore Rules الحالية لا تمنح لوحة التحكم قراءة لمجموعة غرف. لذلك لن نستخدم قراءة مفتوحة أو صلاحيات مؤقتة واسعة.'),
    )),
    const SizedBox(height:10),
    ...const [
      ControlItem('الغرف النشطة','ستعرض roomId، الاسم، المضيف، الحالة وعدد المشاركين بعد اعتماد Collection وقاعدة القراءة.',Icons.podcasts_outlined),
      ControlItem('الغرف المبلغ عنها','ستعرض بلاغات الغرف للقراءة والمراجعة بعد إضافة صلاحية reviewReports.',Icons.report_outlined),
      ControlItem('إدارة المضيفين','أي كتم/منع/تغيير مضيف سيبقى عملية Backend مسجلة في Audit Log.',Icons.record_voice_over_outlined),
    ].map((item)=>Card(child:ListTile(leading:Icon(item.icon,color:const Color(0xFFD7B85A)),title:Text(item.title,style:const TextStyle(fontWeight:FontWeight.w700)),subtitle:Text(item.subtitle)))),
  ]);
}
class FinancePage extends StatelessWidget {
  const FinancePage({super.key});
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(16),children:[
    const Row(children:[Icon(Icons.account_balance_wallet_outlined,size:28,color:Color(0xFFD7B85A)),SizedBox(width:10),Text('المالية',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900))]),
    const SizedBox(height:16),
    _AdminCollectionTile(title:'السجل المالي',subtitle:'financial_ledger — قراءة فقط',icon:Icons.receipt_long_outlined,collection:'financial_ledger'),
    _AdminCollectionTile(title:'تسويات الوكالات',subtitle:'agency_settlements — قراءة فقط',icon:Icons.payments_outlined,collection:'agency_settlements'),
    const Card(child:ListTile(leading:Icon(Icons.verified_user_outlined,color:Color(0xFFD7B85A)),title:Text('تعديل Coins / Diamonds عبر Backend آمن'),subtitle:Text('Owner يمكنه تعديل الأرصدة من صفحة المستخدم، وكل عملية تُسجّل في Financial Ledger وAudit Log.'))),
  ]);
}

class _AdminCollectionTile extends StatelessWidget {
  const _AdminCollectionTile({required this.title,required this.subtitle,required this.icon,required this.collection});
  final String title,subtitle,collection; final IconData icon;
  @override Widget build(BuildContext context)=>Card(child:ListTile(
    leading:Icon(icon,color:const Color(0xFFD7B85A)),trailing:const Icon(Icons.chevron_left),
    title:Text(title,style:const TextStyle(fontWeight:FontWeight.w800)),subtitle:Text(subtitle),
    onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>AdminCollectionPage(title:title,collection:collection))),
  ));
}

class AdminCollectionPage extends StatelessWidget {
  const AdminCollectionPage({super.key,required this.title,required this.collection});
  final String title,collection;
  String compact(Map<String,dynamic> d)=>d.entries.take(6).map((e)=>'${e.key}: ${e.value}').join('\n');
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:Text(title)),
    body:StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(
      stream:FirebaseFirestore.instance.collection(collection).limit(100).snapshots(),
      builder:(context,snap){
        if(snap.connectionState==ConnectionState.waiting)return const Center(child:CircularProgressIndicator());
        if(snap.hasError)return ListView(padding:const EdgeInsets.all(16),children:[
          const Card(child:ListTile(leading:Icon(Icons.lock_outline,color:Color(0xFFD7B85A)),title:Text('قراءة إدارية فقط'),subtitle:Text('لا توجد عمليات كتابة من هذه الشاشة.'))),
          Card(child:ListTile(leading:const Icon(Icons.error_outline,color:Colors.orangeAccent),title:const Text('تعذر تحميل البيانات'),subtitle:Text('${snap.error}'))),
        ]);
        final docs=snap.data?.docs??[];
        if(docs.isEmpty)return const Center(child:Text('لا توجد سجلات حتى الآن.'));
        return ListView.builder(padding:const EdgeInsets.all(16),itemCount:docs.length,itemBuilder:(context,i){
          final doc=docs[i]; return Card(child:ListTile(
            leading:const Icon(Icons.description_outlined,color:Color(0xFFD7B85A)),
            title:SelectableText(doc.id),subtitle:Text(compact(doc.data())),
          ));
        });
      },
    ),
  );
}

class SystemConfigPage extends StatelessWidget {
  const SystemConfigPage({super.key});
  @override Widget build(BuildContext context)=>AdminCollectionPage(title:'إعدادات النظام',collection:'system_config');
}

class AuditLogPage extends StatelessWidget {
  const AuditLogPage({super.key});
  String t(dynamic v)=>v==null?'—':'$v';
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:const Text('سجل الإدارة')),
    body:StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(
      stream:FirebaseFirestore.instance.collection('admin_audit_logs').limit(100).snapshots(),
      builder:(context,snap){
        if(snap.connectionState==ConnectionState.waiting)return const Center(child:CircularProgressIndicator());
        if(snap.hasError)return ListView(padding:const EdgeInsets.all(16),children:[
          const Card(child:ListTile(leading:Icon(Icons.shield_outlined,color:Color(0xFFD7B85A)),title:Text('Audit Log للقراءة فقط'),subtitle:Text('القواعد تسمح بالقراءة فقط لمن لديه viewAuditLog. حساب Owner يمر عبر صلاحية المالك.'))),
          Card(child:ListTile(leading:const Icon(Icons.error_outline,color:Colors.orangeAccent),title:const Text('تعذر تحميل السجل'),subtitle:Text('${snap.error}'))),
        ]);
        final docs=snap.data?.docs??[];
        if(docs.isEmpty)return const Center(child:Text('لا توجد عمليات إدارية مسجلة بعد.'));
        return ListView.builder(padding:const EdgeInsets.all(16),itemCount:docs.length,itemBuilder:(context,i){
          final d=docs[i].data();
          final action=t(d['action']??d['type']);
          final actor=t(d['actorUid']??d['uid']);
          final reason=t(d['reason']);
          final target=t(d['targetUid']??d['targetId']);
          return Card(child:ListTile(
            leading:const Icon(Icons.history_outlined,color:Color(0xFFD7B85A)),
            title:Text(action,style:const TextStyle(fontWeight:FontWeight.w800)),
            subtitle:Text('المنفذ: $actor\nالهدف: $target\nالسبب: $reason'),
            isThreeLine:true,
          ));
        });
      },
    ),
  );
}

class MorePage extends StatelessWidget {
  const MorePage({super.key});
  @override Widget build(BuildContext context)=>const ControlList(title:'المزيد',icon:Icons.grid_view_rounded,items:[
    ControlItem('الوكالات','إدارة الوكالات والمضيفين والتسويات',Icons.apartment_outlined),
    ControlItem('التقارير','واجهة جاهزة؛ القراءة الحقيقية تنتظر Rules محددة لـ reports بدل فتح Firestore بشكل واسع',Icons.flag_outlined),
    ControlItem('VIP و IDs الخاصة','إدارة VIP والمعرّفات الخاصة',Icons.workspace_premium_outlined),
    ControlItem('إعدادات النظام','system_config — قراءة فقط، وEmergency Lock يبقى Backend فقط',Icons.settings_outlined),
    ControlItem('سجل الإدارة','Audit Log للعمليات الحساسة — قراءة فقط',Icons.history_outlined),
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
      onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>item.title=='سجل الإدارة'?const AuditLogPage():(item.title=='إعدادات النظام'?const SystemConfigPage():DetailPage(item:item)))),
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
