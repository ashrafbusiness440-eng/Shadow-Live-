import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'firebase_options.dart';
import 'utils/compact_number.dart';
import 'admin/control_admin_id_override.dart';
import 'admin/control_asset_manager_page.dart';


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
    home: const Directionality(
      textDirection: TextDirection.rtl,
      child: bool.fromEnvironment('CONTROL_E2E_TEST')
          ? ControlShell(initialNavIndex: 2)
          : AdminGate(),
    ),
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
  const ControlShell({super.key, this.initialNavIndex = 0});
  final int initialNavIndex;
  @override State<ControlShell> createState()=>_ControlShellState();
}

class _ControlShellState extends State<ControlShell> {
  late int index;

  @override
  void initState() {
    super.initState();
    index = widget.initialNavIndex.clamp(0, 5);
  }
  @override Widget build(BuildContext context) {
    final pages=[
      DashboardPage(onOpen:(i)=>setState(()=>index=i)),
      const UsersPage(),
      const RoomsPage(),
      const FinancePage(),
      const IdManagementPage(),
      const MorePage(),
    ];
    return Scaffold(
      appBar: AppBar(
        backgroundColor: const Color(0xFF0D0917),
        title: const Column(crossAxisAlignment: CrossAxisAlignment.start,children:[
          Text('Shadow Control',style:TextStyle(fontWeight:FontWeight.w800)),
          Text('بيئة تجريبية • Firebase متصل',style:TextStyle(fontSize:11,color:Color(0xFFD7B85A))),
        ]),
        actions:[
          IconButton(
            tooltip:'تسجيل الخروج',
            onPressed:() async {
              final ok=await showDialog<bool>(
                context:context,
                builder:(dialogContext)=>AlertDialog(
                  title:const Text('تسجيل الخروج'),
                  content:const Text('هل تريد تسجيل الخروج من Shadow Control؟'),
                  actions:[
                    TextButton(onPressed:()=>Navigator.pop(dialogContext,false),child:const Text('إلغاء')),
                    FilledButton(onPressed:()=>Navigator.pop(dialogContext,true),child:const Text('تسجيل الخروج')),
                  ],
                ),
              );
              if(ok==true)await FirebaseAuth.instance.signOut();
            },
            icon:const Icon(Icons.logout_rounded),
          ),
          Padding(
            padding:const EdgeInsets.symmetric(horizontal:14),
            child:CircleAvatar(
              child:Icon(
                FirebaseAuth.instance.currentUser==null
                  ? Icons.admin_panel_settings_outlined
                  : Icons.verified_user_outlined,
              ),
            ),
          ),
        ],
      ),
      body: IndexedStack(index:index,children:pages),
      bottomNavigationBar:NavigationBar(selectedIndex:index,onDestinationSelected:(v)=>setState(()=>index=v),destinations:const[
        NavigationDestination(icon:Icon(Icons.dashboard_outlined),selectedIcon:Icon(Icons.dashboard),label:'الرئيسية'),
        NavigationDestination(icon:Icon(Icons.people_outline),selectedIcon:Icon(Icons.people),label:'المستخدمون'),
        NavigationDestination(icon:Icon(Icons.mic_none),selectedIcon:Icon(Icons.mic),label:'الغرف'),
        NavigationDestination(icon:Icon(Icons.wallet_outlined),selectedIcon:Icon(Icons.wallet),label:'المالية'),
        NavigationDestination(icon:Icon(Icons.badge_outlined),selectedIcon:Icon(Icons.badge),label:'IDs'),
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
      ActionChip(label:const Text('إدارة ID'),avatar:const Icon(Icons.badge_outlined),onPressed:()=>onOpen(4)),
      ActionChip(label:const Text('السجلات والإعدادات'),avatar:const Icon(Icons.history_outlined),onPressed:()=>onOpen(5)),
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
        _OwnerIdPermissionCard(uid:uid,targetRole:t(data['role']??'user'),capabilities:caps),
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
    'manageSystem':'إدارة النظام','manageIds':'إدارة IDs المستخدمين والغرف',
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

class RoomsPage extends StatefulWidget {
  const RoomsPage({super.key});
  @override State<RoomsPage> createState()=>_RoomsPageState();
}

class _RoomsPageState extends State<RoomsPage> {
  final publicId=TextEditingController();
  final reason=TextEditingController(text:'تعديل إعدادات الغرفة من Shadow Control');
  final seats=TextEditingController();
  final moderators=TextEditingController();
  final hostUid=TextEditingController();
  bool busy=false,bypassLevelCapacity=false;
  Map<String,dynamic>? room;
  String? error;

  @override void dispose(){
    publicId.dispose();reason.dispose();seats.dispose();moderators.dispose();hostUid.dispose();super.dispose();
  }

  Uri get apiUri=>Uri(
    scheme:Uri.base.scheme,
    host:Uri.base.host,
    port:Uri.base.hasPort?Uri.base.port:null,
    path:'/api/voice-session',
  );

  Future<Map<String,dynamic>> post(Map<String,dynamic> payload) async {
    final user=FirebaseAuth.instance.currentUser;
    if(user==null)throw Exception('forbidden');
    final token=await user.getIdToken().timeout(const Duration(seconds:12));
    if(token==null||token.isEmpty)throw Exception('forbidden');
    final response=await http.post(
      apiUri,
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:jsonEncode({'action':'controlRoomPolicy',...payload}),
    ).timeout(const Duration(seconds:25));
    final data=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
    if(response.statusCode<200||response.statusCode>=300||data['ok']!=true){
      throw Exception((data['code']??'request_failed').toString());
    }
    return data;
  }

  String message(String code)=>switch(code){
    'forbidden'=>'لا تملك صلاحية manageRooms / globalRoomControl.',
    'room_not_found'=>'لم يتم العثور على الغرفة.',
    'invalid_room_public_id'=>'Room ID غير صالح.',
    'invalid_room_level'=>'Level يجب أن يكون بين 1 و6.',
    'level_unchanged'=>'الغرفة موجودة بالفعل على هذا المستوى.',
    'invalid_seat_override'=>'عدد المايكات يجب أن يكون بين 1 و50.',
    'invalid_moderator_override'=>'عدد المشرفين يجب أن يكون بين 0 و30.',
    'global_room_control_required'=>'تحويل الغرفة إلى رسمية يتطلب Owner أو globalRoomControl.',
    'host_not_found'=>'حساب الـHost غير موجود.',
    _=>'تعذر تنفيذ العملية: '+code,
  };

  void syncControllers(Map<String,dynamic> data){
    final policy=data['policy'] is Map<String,dynamic>?data['policy'] as Map<String,dynamic>:<String,dynamic>{};
    final overrides=policy['overrides'] is Map<String,dynamic>?policy['overrides'] as Map<String,dynamic>:<String,dynamic>{};
    seats.text=overrides['seats']?.toString()??'';
    moderators.text=overrides['moderators']?.toString()??'';
    hostUid.text=policy['hostUid']?.toString()??'';
    bypassLevelCapacity=overrides['bypassLevelCapacity']==true;
  }

  Future<void> lookup() async {
    final id=publicId.text.trim();
    if(id.isEmpty)return;
    setState((){busy=true;error=null;});
    try{
      final data=await post({'controlAction':'state','roomPublicId':id});
      if(!mounted)return;
      syncControllers(data);
      setState(()=>room=data);
    }catch(e){
      if(mounted)setState((){
        room=null;
        error=message(e.toString().replaceFirst('Exception: ',''));
      });
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  Future<void> execute(String action,{Map<String,dynamic> extra=const {}}) async {
    final current=room;if(current==null)return;
    final roomId=(current['roomId']??'').toString();if(roomId.isEmpty)return;
    final why=reason.text.trim().isEmpty?'تعديل إعدادات الغرفة من Shadow Control':reason.text.trim();
    final user=FirebaseAuth.instance.currentUser;if(user==null)return;
    final prefix=user.uid.length>=6?user.uid.substring(0,6):user.uid;
    final key='roomctl_'+DateTime.now().millisecondsSinceEpoch.toString()+'_'+prefix;
    setState((){busy=true;error=null;});
    try{
      await post({
        'controlAction':action,
        'roomId':roomId,
        'reason':why,
        'idempotencyKey':key,
        ...extra,
      });
      final refreshed=await post({'controlAction':'state','roomId':roomId});
      if(!mounted)return;
      syncControllers(refreshed);
      setState(()=>room=refreshed);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content:Text('تم تحديث الغرفة وتسجيل العملية في Audit Log.')),
      );
    }catch(e){
      if(mounted)setState(()=>error=message(e.toString().replaceFirst('Exception: ','')));
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  Future<void> saveOverrides()=>execute('setOverrides',extra:{
    'seats':seats.text.trim().isEmpty?null:int.tryParse(seats.text.trim()),
    'moderators':moderators.text.trim().isEmpty?null:int.tryParse(moderators.text.trim()),
    'bypassLevelCapacity':bypassLevelCapacity,
  });

  @override Widget build(BuildContext context){
    final data=room;
    final policy=data?['policy'] is Map<String,dynamic>?data!['policy'] as Map<String,dynamic>:<String,dynamic>{};
    final level=(policy['level'] as num?)?.toInt()??1;
    final official=policy['official']==true;
    final systemOwned=policy['systemOwned']==true;
    final effectiveSeats=(policy['effectiveSeats']??'—').toString();
    final effectiveModerators=(policy['effectiveModerators']??'—').toString();
    final manual=(policy['capacityMode']??'level').toString()=='manual';

    return ListView(padding:const EdgeInsets.all(16),children:[
      const Row(children:[
        Icon(Icons.mic_none_rounded,size:28,color:Color(0xFFD7B85A)),
        SizedBox(width:10),
        Text('إدارة الغرف',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900)),
      ]),
      const SizedBox(height:6),
      const Text('Room Level + Overrides — التعديلات الحساسة تمر عبر Backend وAudit Log.',style:TextStyle(color:Color(0xFFAAA3B8))),
      const SizedBox(height:16),
      Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[
        TextField(
          controller:publicId,
          keyboardType:TextInputType.number,
          onSubmitted:(_)=>lookup(),
          decoration:const InputDecoration(labelText:'Room ID',hintText:'مثال: 123456',prefixIcon:Icon(Icons.search),border:OutlineInputBorder()),
        ),
        const SizedBox(height:10),
        SizedBox(width:double.infinity,child:FilledButton.icon(
          onPressed:busy?null:lookup,
          icon:busy?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.manage_search_rounded),
          label:Text(busy?'جار التنفيذ...':'بحث عن الغرفة'),
        )),
      ]))),
      if(error!=null)...[
        const SizedBox(height:10),
        Card(color:const Color(0xFF2A1015),child:ListTile(
          leading:const Icon(Icons.error_outline,color:Colors.redAccent),
          title:Text(error!,style:const TextStyle(color:Colors.redAccent)),
        )),
      ],
      if(data!=null)...[
        const SizedBox(height:12),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          Row(children:[
            Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
              Text((data['name']??'غرفة صوتية').toString(),style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900)),
              const SizedBox(height:4),
              Text('ID: '+(data['publicId']??'—').toString()+' • Doc: '+(data['roomId']??'—').toString()),
            ])),
            Chip(
              avatar:Icon(official?Icons.verified_rounded:Icons.mic_none_rounded,size:17),
              label:Text(systemOwned?'رسمية — ملك النظام':(official?'رسمية':'عادية')),
            ),
          ]),
          const Divider(height:28),
          Wrap(spacing:8,runSpacing:8,children:[
            Chip(label:Text('LV.'+level.toString())),
            Chip(label:Text('المايكات الفعلية: '+effectiveSeats)),
            Chip(label:Text('المشرفون: '+effectiveModerators)),
            Chip(label:Text(manual?'Manual Override':'حسب Level')),
          ]),
        ]))),
        const SizedBox(height:12),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          const Text('Room Level',style:TextStyle(fontSize:18,fontWeight:FontWeight.w900)),
          const SizedBox(height:10),
          Row(children:[
            Expanded(child:OutlinedButton.icon(
              onPressed:busy||level<=1?null:()=>execute('lowerLevel'),
              icon:const Icon(Icons.remove),label:const Text('خفض Level'),
            )),
            const SizedBox(width:8),
            Chip(label:Text('LV.'+level.toString())),
            const SizedBox(width:8),
            Expanded(child:FilledButton.icon(
              onPressed:busy||level>=6?null:()=>execute('raiseLevel'),
              icon:const Icon(Icons.add),label:const Text('رفع Level'),
            )),
          ]),
          const SizedBox(height:10),
          Wrap(spacing:6,children:List.generate(6,(i){
            final value=i+1;
            return ChoiceChip(
              label:Text('LV.'+value.toString()),
              selected:value==level,
              onSelected:busy||value==level?null:(_)=>execute('setLevel',extra:{'level':value}),
            );
          })),
        ]))),
        const SizedBox(height:12),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          const Text('Room Overrides',style:TextStyle(fontSize:18,fontWeight:FontWeight.w900)),
          const SizedBox(height:6),
          const Text('اترك القيمة فارغة للرجوع لقيمة الـLevel.',style:TextStyle(color:Color(0xFFAAA3B8),fontSize:12)),
          const SizedBox(height:12),
          Row(children:[
            Expanded(child:TextField(
              controller:seats,keyboardType:TextInputType.number,
              decoration:const InputDecoration(labelText:'عدد المايكات',hintText:'1 - 50',border:OutlineInputBorder()),
            )),
            const SizedBox(width:10),
            Expanded(child:TextField(
              controller:moderators,keyboardType:TextInputType.number,
              decoration:const InputDecoration(labelText:'عدد المشرفين',hintText:'0 - 30',border:OutlineInputBorder()),
            )),
          ]),
          SwitchListTile(
            contentPadding:EdgeInsets.zero,
            title:const Text('تجاوز سعة الـLevel'),
            subtitle:const Text('استخدم القيم اليدوية بدل الجدول الطبيعي.'),
            value:bypassLevelCapacity,
            onChanged:busy?null:(v)=>setState(()=>bypassLevelCapacity=v),
          ),
          Row(children:[
            Expanded(child:FilledButton.icon(
              onPressed:busy?null:saveOverrides,
              icon:const Icon(Icons.save_outlined),label:const Text('حفظ الاستثناءات'),
            )),
            const SizedBox(width:8),
            Expanded(child:OutlinedButton.icon(
              onPressed:busy?null:()=>execute('resetOverrides'),
              icon:const Icon(Icons.restart_alt_rounded),label:const Text('إلغاء الاستثناءات'),
            )),
          ]),
        ]))),
        const SizedBox(height:12),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          const Text('غرفة رسمية / إدارية',style:TextStyle(fontSize:18,fontWeight:FontWeight.w900)),
          const SizedBox(height:6),
          const Text('الغرفة الرسمية ملك Shadow Live. الـHost يدير الجلسة فقط ولا يصبح Owner.',style:TextStyle(color:Color(0xFFAAA3B8),fontSize:12)),
          const SizedBox(height:12),
          TextField(
            controller:hostUid,
            decoration:const InputDecoration(labelText:'Host UID',hintText:'اختياري',border:OutlineInputBorder(),prefixIcon:Icon(Icons.record_voice_over_outlined)),
          ),
          const SizedBox(height:10),
          Row(children:[
            Expanded(child:FilledButton.icon(
              onPressed:busy||official?null:()=>execute('setOfficialRoom',extra:{
                'enabled':true,'officialType':'official','hostUid':hostUid.text.trim(),
              }),
              icon:const Icon(Icons.verified_rounded),label:const Text('تحويل إلى رسمية'),
            )),
            const SizedBox(width:8),
            Expanded(child:OutlinedButton.icon(
              onPressed:busy||!official?null:()=>execute('setOfficialRoom',extra:{'enabled':false}),
              icon:const Icon(Icons.undo_rounded),label:const Text('إلغاء الرسمية'),
            )),
          ]),
        ]))),
        const SizedBox(height:12),
        TextField(
          controller:reason,maxLength:160,
          decoration:const InputDecoration(labelText:'سبب التعديل — يسجل في Audit Log',border:OutlineInputBorder(),prefixIcon:Icon(Icons.history_edu_outlined)),
        ),
      ],
    ]);
  }
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



class IdManagementPage extends StatefulWidget {
  const IdManagementPage({super.key});
  @override State<IdManagementPage> createState()=>_IdManagementHubState();
}

class _IdManagementHubState extends State<IdManagementPage> {
  int mode=0;
  @override Widget build(BuildContext context)=>Column(children:[
    Padding(
      padding:const EdgeInsets.fromLTRB(16,16,16,4),
      child:SegmentedButton<int>(
        segments:const[
          ButtonSegment(value:0,label:Text('المستخدمون'),icon:Icon(Icons.person_outline)),
          ButtonSegment(value:1,label:Text('الغرف'),icon:Icon(Icons.mic_none_rounded)),
        ],
        selected:{mode},
        onSelectionChanged:(value)=>setState(()=>mode=value.first),
      ),
    ),
    Expanded(child:IndexedStack(index:mode,children:const[
      UserIdManagementPage(),
      RoomIdManagementPage(),
    ])),
  ]);
}

class RoomIdManagementPage extends StatefulWidget {
  const RoomIdManagementPage({super.key});
  @override State<RoomIdManagementPage> createState()=>_RoomIdManagementPageState();
}

class _RoomIdManagementPageState extends State<RoomIdManagementPage> {
  final oldId=TextEditingController();
  final newId=TextEditingController();
  final reason=TextEditingController(text:'تغيير ID غرفة إداري');
  bool checking=false,executing=false;
  String? roomDocId;
  Map<String,dynamic>? roomData;
  String? error;

  @override void dispose(){oldId.dispose();newId.dispose();reason.dispose();super.dispose();}

  Future<Map<String,dynamic>?> _actor() async {
    final user=FirebaseAuth.instance.currentUser;
    if(user==null)return null;
    final snap=await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
    return snap.data();
  }

  Future<void> _lookup() async {
    final currentId=AdminIdOverridePolicy.normalize(oldId.text);
    try{AdminIdOverridePolicy.validate(currentId);}catch(_){
      setState(()=>error='ID الغرفة الحالي يجب أن يكون رقمياً من 3 إلى 12 خانة.');return;
    }
    setState((){checking=true;error=null;roomDocId=null;roomData=null;});
    try{
      final idSnap=await FirebaseFirestore.instance.collection('room_ids').doc(currentId).get();
      final target=idSnap.data()?['roomId']?.toString();
      if(target==null||target.isEmpty){
        final retired=idSnap.exists&&idSnap.data()?['reserved']==true;
        throw Exception(retired?'هذا ID غرفة متقاعد ومحجوز.':'لم يتم العثور على غرفة بهذا ID.');
      }
      final roomSnap=await FirebaseFirestore.instance.collection('rooms').doc(target).get();
      if(!roomSnap.exists)throw Exception('الغرفة المرتبطة بالـID غير موجودة.');
      final data=roomSnap.data()??<String,dynamic>{};
      if('${data['publicId']??''}'!=currentId)throw Exception('هذا ID قديم وليس ID الغرفة الحالي.');
      if(mounted)setState((){roomDocId=target;roomData=data;});
    }catch(e){
      if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));
    }finally{
      if(mounted)setState(()=>checking=false);
    }
  }

  String _messageForCode(String code)=>switch(code){
    'id_taken'=>'الـID الجديد مستخدم أو محجوز لمستخدم أو غرفة أخرى.',
    'not_found'=>'لم يتم العثور على ID الغرفة الحالي.',
    'old_id_retired'=>'ID الغرفة الحالي متقاعد ومحجوز.',
    'old_id_not_current'=>'الـID المدخل ليس ID الغرفة الحالي.',
    'recent_auth_required'=>'هذه عملية حساسة. سجّل خروج من Shadow Control ثم ادخل من جديد وأعد المحاولة.',
    'forbidden'=>'هذه العملية تتطلب Owner أو صلاحية manageIds.',
    'invalid_request'=>'تحقق من الـID القديم والجديد والسبب.',
    _=>'تعذر تنفيذ العملية: $code',
  };

  Future<void> _execute() async {
    final before=AdminIdOverridePolicy.normalize(oldId.text);
    final after=AdminIdOverridePolicy.normalize(newId.text);
    try{AdminIdOverridePolicy.validateChange(before,after);}catch(e){
      setState(()=>error=e.toString().replaceFirst('Invalid argument(s): ',''));return;
    }
    if(roomDocId==null||roomData==null||'${roomData!['publicId']??''}'!=before){
      setState(()=>error='تحقق من الغرفة باستخدام الـID الحالي أولًا.');return;
    }
    final why=reason.text.trim().isEmpty?'تغيير ID غرفة من Shadow Control':reason.text.trim();
    final name='${roomData!['name']??roomData!['title']??'غرفة'}';
    final confirmed=await showDialog<bool>(
      context:context,
      builder:(c)=>AlertDialog(
        title:const Text('تأكيد تغيير ID الغرفة'),
        content:Text('الغرفة: $name\\nالقديم: $before\\nالجديد: $after\\n\\nالـID القديم سيتقاعد ويبقى محجوزًا نهائيًا.'),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('تنفيذ التغيير')),
        ],
      ),
    );
    if(confirmed!=true||!mounted)return;
    setState((){executing=true;error=null;});
    try{
      final user=FirebaseAuth.instance.currentUser;if(user==null)throw Exception('forbidden');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('forbidden');
      final key='rid_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=Uri(scheme:Uri.base.scheme,host:Uri.base.host,port:Uri.base.hasPort?Uri.base.port:null,path:'/api/voice-session');
      final response=await http.post(
        apiUri,
        headers:{'Content-Type':'application/json','Authorization':'Bearer $token'},
        body:jsonEncode({
          'action':'changeRoomPublicId',
          'roomId':roomDocId,
          'publicId':after,
          'reason':why,
          'idempotencyKey':key,
        }),
      ).timeout(const Duration(seconds:25));
      final body=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
      if(response.statusCode!=200||body['ok']!=true)throw Exception('${body['code']??'request_failed'}');
      if(!mounted)return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('تم تغيير ID الغرفة: $before → $after')));
      oldId.text=after;newId.clear();roomDocId=null;roomData=null;
      await _lookup();
    }catch(e){
      final code=e.toString().replaceFirst('Exception: ','');
      if(mounted)setState(()=>error=_messageForCode(code));
    }finally{
      if(mounted)setState(()=>executing=false);
    }
  }

  @override Widget build(BuildContext context)=>FutureBuilder<Map<String,dynamic>?>(
    future:_actor(),
    builder:(context,snap){
      if(snap.connectionState==ConnectionState.waiting)return const Center(child:CircularProgressIndicator());
      final actor=snap.data;
      final caps=actor?['capabilities'] is List?(actor!['capabilities'] as List).map((e)=>'$e').toSet():<String>{};
      final canManageIds=actor?['adminEnabled']==true&&(actor?['role']=='owner'||caps.contains('manageIds'));
      if(!canManageIds){
        return ListView(padding:const EdgeInsets.all(16),children:const[
          Card(child:ListTile(
            leading:Icon(Icons.lock_outline,color:Color(0xFFD7B85A)),
            title:Text('IDs الغرف — صلاحية مطلوبة',style:TextStyle(fontWeight:FontWeight.w900)),
            subtitle:Text('متاحة للـOwner أو للحساب الإداري الذي منحه الـOwner صلاحية manageIds.'),
          )),
        ]);
      }
      final data=roomData;
      return ListView(padding:const EdgeInsets.all(16),children:[
        const Row(children:[
          Icon(Icons.mic_none_rounded,size:28,color:Color(0xFFD7B85A)),
          SizedBox(width:10),
          Text('IDs الغرف',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900)),
        ]),
        const SizedBox(height:6),
        const Text('Public ID للغرفة منفصل عن Firestore document ID الداخلي حتى لا يتأثر التنقل أو بيانات الغرفة.',style:TextStyle(color:Color(0xFFAAA3B8))),
        const SizedBox(height:16),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[
          TextField(
            controller:oldId,
            keyboardType:TextInputType.number,
            decoration:const InputDecoration(labelText:'ID الغرفة الحالي',hintText:'مثال: 654321',border:OutlineInputBorder(),prefixIcon:Icon(Icons.search)),
          ),
          const SizedBox(height:12),
          SizedBox(width:double.infinity,child:OutlinedButton.icon(
            onPressed:checking||executing?null:_lookup,
            icon:checking?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.meeting_room_outlined),
            label:Text(checking?'جار التحقق...':'تحقق من الغرفة'),
          )),
        ]))),
        if(data!=null&&roomDocId!=null)...[
          const SizedBox(height:12),
          Card(child:ListTile(
            leading:const CircleAvatar(child:Icon(Icons.mic_none_rounded)),
            title:Text('${data['name']??data['title']??'غرفة'}',style:const TextStyle(fontWeight:FontWeight.w900)),
            subtitle:Text('Public ID: ${data['publicId']}\\nRoom document: $roomDocId'),
            isThreeLine:true,
            trailing:const Icon(Icons.verified,color:Color(0xFFD7B85A)),
          )),
          const SizedBox(height:12),
          Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[
            TextField(
              controller:newId,
              keyboardType:TextInputType.number,
              decoration:const InputDecoration(labelText:'ID الغرفة الجديد',hintText:'مثال: 2222',border:OutlineInputBorder(),prefixIcon:Icon(Icons.badge_outlined)),
            ),
            const SizedBox(height:12),
            TextField(controller:reason,maxLength:160,decoration:const InputDecoration(labelText:'سبب التغيير',border:OutlineInputBorder())),
            const SizedBox(height:6),
            const Text('IDs المستخدمين والغرف تشترك في مساحة واحدة: لا يمكن أن يحمل مستخدم وغرفة نفس الرقم. القديم يتقاعد ويبقى محجوزًا.',style:TextStyle(fontSize:12,color:Color(0xFFAAA3B8))),
            const SizedBox(height:14),
            SizedBox(width:double.infinity,child:FilledButton.icon(
              onPressed:executing?null:_execute,
              icon:executing?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.swap_horiz_rounded),
              label:Text(executing?'جار التنفيذ...':'تغيير ID الغرفة'),
            )),
          ]))),
        ],
        if(error!=null)...[
          const SizedBox(height:12),
          Card(color:const Color(0xFF2A1015),child:ListTile(
            leading:const Icon(Icons.error_outline,color:Colors.redAccent),
            title:Text(error!,style:const TextStyle(color:Colors.redAccent)),
          )),
        ],
        const SizedBox(height:12),
        const Card(child:ListTile(
          leading:Icon(Icons.shield_outlined,color:Color(0xFFD7B85A)),
          title:Text('حماية العملية'),
          subtitle:Text('Owner أو manageIds • Backend موثّق • Transaction • Audit Log • ID القديم محجوز.'),
        )),
      ]);
    },
  );
}

class _OwnerIdPermissionCard extends StatefulWidget {
  const _OwnerIdPermissionCard({required this.uid,required this.targetRole,required this.capabilities});
  final String uid,targetRole;
  final List<String> capabilities;
  @override State<_OwnerIdPermissionCard> createState()=>_OwnerIdPermissionCardState();
}

class _OwnerIdPermissionCardState extends State<_OwnerIdPermissionCard> {
  late bool enabled;
  bool busy=false;

  @override void initState(){super.initState();enabled=widget.capabilities.contains('manageIds');}

  Future<bool> _isOwner() async {
    final current=FirebaseAuth.instance.currentUser;
    if(current==null)return false;
    final snap=await FirebaseFirestore.instance.collection('users').doc(current.uid).get();
    return snap.data()?['role']=='owner'&&snap.data()?['adminEnabled']==true;
  }

  Future<void> _change() async {
    final next=!enabled;
    final reason=next?'منح صلاحية إدارة IDs من Shadow Control':'سحب صلاحية إدارة IDs من Shadow Control';
    final ok=await showDialog<bool>(
      context:context,
      builder:(c)=>AlertDialog(
        title:Text(next?'منح صلاحية إدارة IDs':'سحب صلاحية إدارة IDs'),
        content:Text(next
          ?'سيتمكن هذا الحساب من تغيير IDs المستخدمين والغرف فقط عبر الـBackend الموثّق.'
          :'سيتم سحب صلاحية تغيير IDs المستخدمين والغرف من هذا الحساب.'),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(c,true),child:Text(next?'منح الصلاحية':'سحب الصلاحية')),
        ],
      ),
    );
    if(ok!=true||!mounted)return;
    setState(()=>busy=true);
    try{
      final user=FirebaseAuth.instance.currentUser;if(user==null)throw Exception('not_signed_in');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('empty_token');
      final key='idcap_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=Uri(scheme:Uri.base.scheme,host:Uri.base.host,port:Uri.base.hasPort?Uri.base.port:null,path:'/api/set-id-management-permission');
      final response=await http.post(
        apiUri,
        headers:{'Content-Type':'application/json','Authorization':'Bearer $token'},
        body:jsonEncode({'targetUid':widget.uid,'enabled':next,'reason':reason,'idempotencyKey':key}),
      ).timeout(const Duration(seconds:25));
      final body=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
      if(response.statusCode!=200||body['ok']!=true)throw Exception('${body['code']??'request_failed'}');
      if(mounted){
        setState(()=>enabled=next);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(next?'تم منح صلاحية إدارة IDs':'تم سحب صلاحية إدارة IDs')));
      }
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('تعذر تعديل الصلاحية: $e')));
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  @override Widget build(BuildContext context){
    if(widget.targetRole=='owner'){
      return const Card(child:ListTile(
        leading:Icon(Icons.badge_outlined,color:Color(0xFFD7B85A)),
        title:Text('صلاحية إدارة IDs'),
        subtitle:Text('الـOwner يمتلك صلاحية إدارة IDs تلقائيًا ولا يمكن سحبها.'),
      ));
    }
    return FutureBuilder<bool>(
      future:_isOwner(),
      builder:(context,snap){
        if(snap.data!=true)return const SizedBox.shrink();
        return Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          Row(children:[
            const Icon(Icons.badge_outlined,color:Color(0xFFD7B85A)),
            const SizedBox(width:8),
            const Expanded(child:Text('صلاحية إدارة IDs',style:TextStyle(fontWeight:FontWeight.w900))),
            Chip(label:Text(enabled?'ممنوحة':'غير ممنوحة')),
          ]),
          const SizedBox(height:8),
          const Text('تسمح بتغيير IDs المستخدمين والغرف فقط. لا تمنح صلاحيات مالية أو Owner.'),
          const SizedBox(height:12),
          FilledButton.icon(
            onPressed:busy?null:_change,
            icon:Icon(enabled?Icons.remove_moderator_outlined:Icons.add_moderator_outlined),
            label:Text(busy?'جار التنفيذ...':(enabled?'سحب الصلاحية':'منح الصلاحية')),
          ),
        ])));
      },
    );
  }
}

class UserIdManagementPage extends StatefulWidget {
  const UserIdManagementPage({super.key});
  @override State<UserIdManagementPage> createState()=>_IdManagementPageState();
}

class _IdManagementPageState extends State<UserIdManagementPage> {
  final oldId=TextEditingController();
  final newId=TextEditingController();
  final reason=TextEditingController(text:'تغيير ID إداري');
  bool checking=false,executing=false;
  String? targetUid;
  Map<String,dynamic>? targetData;
  String? error;

  @override void dispose(){oldId.dispose();newId.dispose();reason.dispose();super.dispose();}

  Future<Map<String,dynamic>?> _actor() async {
    final user=FirebaseAuth.instance.currentUser;
    if(user==null)return null;
    final snap=await FirebaseFirestore.instance.collection('users').doc(user.uid).get();
    return snap.data();
  }

  Future<void> _lookup() async {
    final currentId=AdminIdOverridePolicy.normalize(oldId.text);
    try{AdminIdOverridePolicy.validate(currentId);}catch(_){
      setState(()=>error='الـID الحالي يجب أن يكون رقمياً من 3 إلى 12 خانة.');return;
    }
    setState((){checking=true;error=null;targetUid=null;targetData=null;});
    try{
      final idSnap=await FirebaseFirestore.instance.collection('public_ids').doc(currentId).get();
      final uid=idSnap.data()?['uid']?.toString();
      if(uid==null||uid.isEmpty){
        final retired=idSnap.exists&&idSnap.data()?['reserved']==true;
        throw Exception(retired?'هذا ID متقاعد ومحجوز وليس ID حاليًا.':'لم يتم العثور على حساب بهذا ID.');
      }
      final userSnap=await FirebaseFirestore.instance.collection('public_profiles').doc(uid).get();
      if(!userSnap.exists)throw Exception('الحساب المرتبط بالـID غير موجود.');
      final data=userSnap.data()??<String,dynamic>{};
      if('${data['publicId']??''}'!=currentId)throw Exception('هذا ID قديم/بديل وليس الـID الحالي للحساب.');
      if(mounted)setState((){targetUid=uid;targetData=data;});
    }catch(e){
      if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));
    }finally{
      if(mounted)setState(()=>checking=false);
    }
  }

  String _messageForCode(String code)=>switch(code){
    'id_taken'=>'الـID الجديد مستخدم أو محجوز مسبقًا.',
    'not_found'=>'لم يتم العثور على الـID الحالي.',
    'old_id_retired'=>'الـID الحالي الذي أدخلته متقاعد ومحجوز.',
    'old_id_not_current'=>'الـID المدخل ليس الـID الحالي لهذا الحساب.',
    'owner_protected'=>'لا يمكن لحساب إداري آخر تغيير ID حساب الـOwner.',
    'recent_auth_required'=>'هذه عملية حساسة. سجّل خروج من Shadow Control ثم ادخل من جديد وأعد المحاولة.',
    'forbidden'=>'هذه العملية تتطلب Owner أو صلاحية manageIds.',
    'invalid_request'=>'تحقق من الـID القديم والجديد والسبب.',
    _=>'تعذر تنفيذ العملية: $code',
  };

  Future<void> _execute() async {
    final before=AdminIdOverridePolicy.normalize(oldId.text);
    final after=AdminIdOverridePolicy.normalize(newId.text);
    try{AdminIdOverridePolicy.validateChange(before,after);}catch(e){
      setState(()=>error=e.toString().replaceFirst('Invalid argument(s): ',''));return;
    }
    if(targetUid==null||targetData==null||'${targetData!['publicId']??''}'!=before){
      setState(()=>error='تحقق من الحساب باستخدام الـID الحالي أولًا.');return;
    }
    final why=reason.text.trim().isEmpty?'تغيير ID إداري من Shadow Control':reason.text.trim();
    final name='${targetData!['displayName']??targetData!['name']??'مستخدم'}';
    final confirmed=await showDialog<bool>(
      context:context,
      builder:(c)=>AlertDialog(
        title:const Text('تأكيد تغيير الـID'),
        content:Text('الحساب: $name\nالقديم: $before\nالجديد: $after\n\nالـID القديم سيتقاعد ويبقى محجوزًا ولن يعود قابلاً للاستخدام أو البحث.'),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('تنفيذ التغيير')),
        ],
      ),
    );
    if(confirmed!=true||!mounted)return;
    setState((){executing=true;error=null;});
    try{
      final user=FirebaseAuth.instance.currentUser;if(user==null)throw Exception('forbidden');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('forbidden');
      final key='pid_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=Uri(scheme:Uri.base.scheme,host:Uri.base.host,port:Uri.base.hasPort?Uri.base.port:null,path:'/api/change-public-id');
      final response=await http.post(
        apiUri,
        headers:{'Content-Type':'application/json','Authorization':'Bearer $token'},
        body:jsonEncode({'currentId':before,'newId':after,'reason':why,'idempotencyKey':key}),
      ).timeout(const Duration(seconds:25));
      final body=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
      if(response.statusCode!=200||body['ok']!=true)throw Exception('${body['code']??'request_failed'}');
      if(!mounted)return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('تم تغيير ID: $before → $after')));
      oldId.text=after;newId.clear();targetUid=null;targetData=null;
      await _lookup();
    }catch(e){
      final code=e.toString().replaceFirst('Exception: ','');
      if(mounted)setState(()=>error=_messageForCode(code));
    }finally{
      if(mounted)setState(()=>executing=false);
    }
  }

  @override Widget build(BuildContext context)=>FutureBuilder<Map<String,dynamic>?>(
    future:_actor(),
    builder:(context,snap){
      if(snap.connectionState==ConnectionState.waiting)return const Center(child:CircularProgressIndicator());
      final actor=snap.data;
      final caps=actor?['capabilities'] is List?(actor!['capabilities'] as List).map((e)=>'$e').toSet():<String>{};
      final canManageIds=actor?['adminEnabled']==true&&(actor?['role']=='owner'||caps.contains('manageIds'));
      if(!canManageIds){
        return ListView(padding:const EdgeInsets.all(16),children:const[
          Card(child:ListTile(
            leading:Icon(Icons.lock_outline,color:Color(0xFFD7B85A)),
            title:Text('إدارة الـID — صلاحية مطلوبة',style:TextStyle(fontWeight:FontWeight.w900)),
            subtitle:Text('متاحة للـOwner أو للحساب الإداري الذي منحه الـOwner صلاحية manageIds.'),
          )),
        ]);
      }
      final data=targetData;
      return ListView(padding:const EdgeInsets.all(16),children:[
        const Row(children:[
          Icon(Icons.badge_outlined,size:28,color:Color(0xFFD7B85A)),
          SizedBox(width:10),
          Text('IDs المستخدمين',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900)),
        ]),
        const SizedBox(height:6),
        const Text('تغيير Public ID للمستخدم مع حجز المعرف القديم وتسجيل العملية.',style:TextStyle(color:Color(0xFFAAA3B8))),
        const SizedBox(height:16),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[
          TextField(
            controller:oldId,
            keyboardType:TextInputType.number,
            decoration:const InputDecoration(labelText:'ID الحالي',hintText:'مثال: 48470239',border:OutlineInputBorder(),prefixIcon:Icon(Icons.search)),
          ),
          const SizedBox(height:12),
          SizedBox(width:double.infinity,child:OutlinedButton.icon(
            onPressed:checking||executing?null:_lookup,
            icon:checking?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.person_search_outlined),
            label:Text(checking?'جار التحقق...':'تحقق من الحساب'),
          )),
        ]))),
        if(data!=null&&targetUid!=null)...[
          const SizedBox(height:12),
          Card(child:ListTile(
            leading:const CircleAvatar(child:Icon(Icons.person)),
            title:Text('${data['displayName']??data['name']??'مستخدم'}',style:const TextStyle(fontWeight:FontWeight.w900)),
            subtitle:Text('ID الحالي: ${data['publicId']}\nUID: $targetUid'),
            isThreeLine:true,
            trailing:const Icon(Icons.verified,color:Color(0xFFD7B85A)),
          )),
          const SizedBox(height:12),
          Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[
            TextField(
              controller:newId,
              keyboardType:TextInputType.number,
              decoration:const InputDecoration(labelText:'ID الجديد',hintText:'مثال: 1111',border:OutlineInputBorder(),prefixIcon:Icon(Icons.badge_outlined)),
            ),
            const SizedBox(height:12),
            TextField(
              controller:reason,
              maxLength:160,
              decoration:const InputDecoration(labelText:'سبب التغيير',border:OutlineInputBorder()),
            ),
            const SizedBox(height:6),
            const Text('الشروط: أرقام فقط، من 3 إلى 12 خانة، وغير مستخدم أو محجوز. الـID القديم سيتقاعد نهائيًا ويبقى محجوزًا.',style:TextStyle(fontSize:12,color:Color(0xFFAAA3B8))),
            const SizedBox(height:14),
            SizedBox(width:double.infinity,child:FilledButton.icon(
              onPressed:executing?null:_execute,
              icon:executing?const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2)):const Icon(Icons.swap_horiz_rounded),
              label:Text(executing?'جار التنفيذ...':'تغيير الـID'),
            )),
          ]))),
        ],
        if(error!=null)...[
          const SizedBox(height:12),
          Card(color:const Color(0xFF2A1015),child:ListTile(
            leading:const Icon(Icons.error_outline,color:Colors.redAccent),
            title:Text(error!,style:const TextStyle(color:Colors.redAccent)),
          )),
        ],
        const SizedBox(height:12),
        const Card(child:ListTile(
          leading:Icon(Icons.shield_outlined,color:Color(0xFFD7B85A)),
          title:Text('حماية العملية'),
          subtitle:Text('Owner أو manageIds • Backend موثّق • Transaction واحدة • Audit Log • ID القديم محجوز • لا علاقة لها بميزة VIP IDs.'),
        )),
      ]);
    },
  );
}

class MorePage extends StatelessWidget {
  const MorePage({super.key});

  @override
  Widget build(BuildContext context) {
    final uid=FirebaseAuth.instance.currentUser?.uid;
    if(uid==null)return const Center(child:CircularProgressIndicator());
    return FutureBuilder<DocumentSnapshot<Map<String,dynamic>>>(
      future:FirebaseFirestore.instance.collection('users').doc(uid).get(),
      builder:(context,snap){
        if(!snap.hasData)return const Center(child:CircularProgressIndicator());
        final isOwner=snap.data?.data()?['role']=='owner';
        final items=<ControlItem>[
          const ControlItem('الوكالات','إدارة الوكالات والمضيفين والتسويات',Icons.apartment_outlined),
          const ControlItem('التقارير','واجهة جاهزة؛ القراءة الحقيقية تنتظر Rules محددة لـ reports بدل فتح Firestore بشكل واسع',Icons.flag_outlined),
          const ControlItem('VIP و IDs الخاصة','إدارة VIP والمعرّفات الخاصة',Icons.workspace_premium_outlined),
          if(isOwner)
            const ControlItem('إدارة أصول التطبيق','Owner فقط • رفع/استبدال صور المشروع + Asset Registry + Audit Log',Icons.image_outlined),
          const ControlItem('إعدادات النظام','system_config — قراءة فقط، وEmergency Lock يبقى Backend فقط',Icons.settings_outlined),
          const ControlItem('سجل الإدارة','Audit Log للعمليات الحساسة — قراءة فقط',Icons.history_outlined),
        ];
        return ControlList(title:'المزيد',icon:Icons.grid_view_rounded,items:items);
      },
    );
  }
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
      onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>item.title=='سجل الإدارة'?const AuditLogPage():(item.title=='إعدادات النظام'?const SystemConfigPage():(item.title=='إدارة أصول التطبيق'?const ControlAssetManagerPage():DetailPage(item:item))))),
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
