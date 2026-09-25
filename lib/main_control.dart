import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'firebase_options.dart';
import 'utils/compact_number.dart';
import 'admin/control_admin_id_override.dart';
import 'admin/control_api_endpoints.dart';
import 'admin/control_firebase.dart';
import 'admin/control_asset_manager_page.dart';
import 'admin/economy_control_page.dart';
import 'admin/games_control_page.dart';
import 'admin/user_access_control_card.dart';


Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeControlFirebase();
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
          ? ControlShell(initialNavIndex: 3)
          : AdminGate(),
    ),
  );
}

class AdminGate extends StatelessWidget {
  const AdminGate({super.key});
  @override
  Widget build(BuildContext context) => StreamBuilder<User?>(
    stream: controlAuth.authStateChanges(),
    builder: (context, auth) {
      if (auth.connectionState == ConnectionState.waiting) {
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      }
      final user = auth.data;
      if (user == null) return const AdminSignInPage();
      return FutureBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        future: controlFirestore.collection('users').doc(user.uid).get(),
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
      await controlAuth.signInWithPopup(provider);
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
      await controlAuth.sendPasswordResetEmail(email: address);
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
      await controlAuth.signInWithEmailAndPassword(
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
          OutlinedButton.icon(onPressed: () => controlAuth.signOut(), icon: const Icon(Icons.logout), label: const Text('تسجيل الخروج')),
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
              if(ok==true)await controlAuth.signOut();
            },
            icon:const Icon(Icons.logout_rounded),
          ),
          Padding(
            padding:const EdgeInsets.symmetric(horizontal:14),
            child:CircleAvatar(
              child:Icon(
                controlAuth.currentUser==null
                  ? Icons.admin_panel_settings_outlined
                  : Icons.verified_user_outlined,
              ),
            ),
          ),
        ],
      ),
      body: IndexedStack(index:index,children:pages),
      bottomNavigationBar:NavigationBar(
        height:72,
        labelBehavior:NavigationDestinationLabelBehavior.onlyShowSelected,
        selectedIndex:index,
        onDestinationSelected:(v)=>setState(()=>index=v),
        destinations:const[
          NavigationDestination(icon:Icon(Icons.dashboard_outlined),selectedIcon:Icon(Icons.dashboard),label:'الرئيسية'),
          NavigationDestination(icon:Icon(Icons.people_outline),selectedIcon:Icon(Icons.people),label:'مستخدمون'),
          NavigationDestination(icon:Icon(Icons.mic_none),selectedIcon:Icon(Icons.mic),label:'غرف'),
          NavigationDestination(icon:Icon(Icons.wallet_outlined),selectedIcon:Icon(Icons.wallet),label:'المالية'),
          NavigationDestination(icon:Icon(Icons.badge_outlined),selectedIcon:Icon(Icons.badge),label:'IDs'),
          NavigationDestination(icon:Icon(Icons.more_horiz),label:'المزيد'),
        ],
      ),
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
      stream:controlFirestore.collection('users').snapshots(),
      builder:(context,snap){
        final allDocs=snap.data?.docs??[];
        final docs=allDocs.where((d)=>(d.data()['accountStatus']??'active').toString()!='deleted').toList();
        final admins=docs.where((d){
          final data=d.data();
          final role=(data['role']??'user').toString();
          return data['adminEnabled']==true || const {'owner','super_admin','admin','moderator'}.contains(role);
        }).length;
        final owners=docs.where((d)=>d.data()['role']=='owner').length;
        return Wrap(spacing:10,runSpacing:10,children:[
          StatCard(icon:Icons.people_alt_outlined,label:'المستخدمون',value:snap.hasError?'—':(snap.hasData?docs.length.toString():'...')),
          StatCard(icon:Icons.admin_panel_settings_outlined,label:'الإداريون',value:snap.hasError?'—':(snap.hasData?admins.toString():'...')),
          StatCard(icon:Icons.workspace_premium_outlined,label:'Owner',value:snap.hasError?'—':(snap.hasData?owners.toString():'...')),
          const StatCard(icon:Icons.shield_outlined,label:'الوضع',value:'Read-only'),
        ]);
      },
    ),
    const SizedBox(height:18),
    Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      const Row(children:[Icon(Icons.verified_user_outlined,color:Color(0xFFD7B85A)),SizedBox(width:8),Text('حالة الأمان',style:TextStyle(fontSize:18,fontWeight:FontWeight.w800))]),
      const SizedBox(height:8),
      Text(controlAuth.currentUser==null?'لا توجد جلسة Firebase نشطة.':'Firebase متصل والجلسة نشطة. بيانات المستخدمين والسجلات المتاحة تُقرأ مباشرة، بينما تغييرات الرتب والأرصدة والإجراءات الحساسة مقفلة حتى Backend موثّق + Audit Log.',style:const TextStyle(height:1.55,color:Color(0xFFCBC5D6))),
    ]))),
    const SizedBox(height:12),const Text('اختصارات آمنة',style:TextStyle(fontSize:18,fontWeight:FontWeight.w800)),const SizedBox(height:8),
    Wrap(spacing:8,runSpacing:8,children:[
      ActionChip(label:const Text('المستخدمون'),avatar:const Icon(Icons.manage_accounts_outlined),onPressed:()=>onOpen(1)),
      ActionChip(label:const Text('إدارة الغرف'),avatar:const Icon(Icons.mic_none_rounded),onPressed:()=>onOpen(2)),
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

enum _UserBucket { regular, admins, disabled, banned, deleted }

class _UsersPageState extends State<UsersPage> {
  String query='';
  _UserBucket selected=_UserBucket.regular;

  String text(dynamic value)=>value==null?'':'$value';
  String displayName(Map<String,dynamic> d)=>text(d['displayName']).isNotEmpty
      ? text(d['displayName'])
      : (text(d['name']).isNotEmpty?text(d['name']):'مستخدم بدون اسم');

  String statusOf(Map<String,dynamic> d){
    final status=text(d['accountStatus']).trim();
    return status.isEmpty?'active':status;
  }

  bool isAdmin(Map<String,dynamic> d){
    final role=text(d['role']).isEmpty?'user':text(d['role']);
    return d['adminEnabled']==true || const {'owner','super_admin','admin','moderator'}.contains(role);
  }

  _UserBucket bucketOf(Map<String,dynamic> d){
    final status=statusOf(d);
    if(status=='deleted')return _UserBucket.deleted;
    if(status=='banned')return _UserBucket.banned;
    if(status=='disabled'||status=='suspended')return _UserBucket.disabled;
    if(isAdmin(d))return _UserBucket.admins;
    return _UserBucket.regular;
  }

  String bucketLabel(_UserBucket bucket)=>switch(bucket){
    _UserBucket.regular=>'باقي الحسابات',
    _UserBucket.admins=>'الإداريون',
    _UserBucket.disabled=>'معطّل / معلّق',
    _UserBucket.banned=>'محظور',
    _UserBucket.deleted=>'محذوف',
  };

  IconData bucketIcon(_UserBucket bucket)=>switch(bucket){
    _UserBucket.regular=>Icons.people_outline,
    _UserBucket.admins=>Icons.admin_panel_settings_outlined,
    _UserBucket.disabled=>Icons.pause_circle_outline,
    _UserBucket.banned=>Icons.block,
    _UserBucket.deleted=>Icons.delete_outline,
  };

  bool matches(String uid,Map<String,dynamic> d){
    final q=query.trim().toLowerCase();
    if(q.isEmpty)return true;
    return [
      uid,d['displayName'],d['name'],d['email'],d['id'],d['userId'],d['username'],
      d['role'],d['accountStatus']
    ].map((v)=>text(v).toLowerCase()).any((v)=>v.contains(q));
  }

  Widget userCard(QueryDocumentSnapshot<Map<String,dynamic>> doc){
    final d=doc.data();
    final role=text(d['role']).isEmpty?'user':text(d['role']);
    final enabled=d['adminEnabled']==true;
    final status=statusOf(d);
    final explicitCaps=d['capabilities'] is List?(d['capabilities'] as List).length:0;
    final capsLabel=role=='owner'?'كل الصلاحيات (Owner)':explicitCaps.toString();
    final email=text(d['email']);
    final publicId=text(d['id']).isNotEmpty?text(d['id']):text(d['userId']);

    final statusLabel=switch(status){
      'deleted'=>'محذوف',
      'banned'=>'محظور',
      'disabled'=>'معطّل',
      'suspended'=>'معلّق',
      _=>'نشط',
    };

    return Card(child:ListTile(
      leading:CircleAvatar(child:Icon(
        status=='deleted'?Icons.delete_outline:
        status=='banned'?Icons.block:
        (status=='disabled'||status=='suspended')?Icons.pause_circle_outline:
        role=='owner'?Icons.workspace_premium:
        isAdmin(d)?Icons.admin_panel_settings_outlined:
        Icons.person_outline,
      )),
      title:Text(displayName(d),style:const TextStyle(fontWeight:FontWeight.w800)),
      subtitle:Text([
        if(email.isNotEmpty) email,
        if(publicId.isNotEmpty) 'ID: $publicId',
        'الحالة: $statusLabel • الدور: $role',
        'الإدارة: ${enabled?'مفعلة':'غير مفعلة'} • الصلاحيات: $capsLabel'
      ].join('\n')),
      isThreeLine:true,
      trailing:role=='owner'
          ? const Icon(Icons.verified,color:Color(0xFFD7B85A))
          : const Icon(Icons.chevron_left),
      onTap:()=>Navigator.of(context).push(
        MaterialPageRoute(builder:(_)=>UserReadOnlyPage(uid:doc.id,data:d)),
      ),
    ));
  }

  @override Widget build(BuildContext context)=>ListView(
    padding:const EdgeInsets.all(16),
    children:[
      const Row(children:[
        Icon(Icons.people_alt_outlined,size:28,color:Color(0xFFD7B85A)),
        SizedBox(width:10),
        Text('المستخدمون',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900)),
      ]),
      const SizedBox(height:12),
      TextField(
        onChanged:(v)=>setState(()=>query=v),
        decoration:const InputDecoration(
          prefixIcon:Icon(Icons.search),
          hintText:'بحث بالاسم، البريد، ID، الدور أو الحالة',
          border:OutlineInputBorder(),
        ),
      ),
      const SizedBox(height:12),
      StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(
        stream:controlFirestore.collection('users').snapshots(),
        builder:(context,snap){
          if(snap.connectionState==ConnectionState.waiting){
            return const Padding(
              padding:EdgeInsets.all(32),
              child:Center(child:CircularProgressIndicator()),
            );
          }
          if(snap.hasError){
            return Card(child:ListTile(
              leading:const Icon(Icons.error_outline,color:Colors.orangeAccent),
              title:const Text('تعذر قراءة المستخدمين'),
              subtitle:Text('${snap.error}'),
            ));
          }

          final all=snap.data?.docs??[];
          int countFor(_UserBucket bucket)=>all.where((doc)=>bucketOf(doc.data())==bucket).length;

          final visible=all.where((doc)=>
            bucketOf(doc.data())==selected && matches(doc.id,doc.data())
          ).toList();

          return Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
            Wrap(
              spacing:8,
              runSpacing:8,
              children:_UserBucket.values.map((bucket){
                final active=selected==bucket;
                return ChoiceChip(
                  selected:active,
                  onSelected:(_)=>setState(()=>selected=bucket),
                  avatar:Icon(bucketIcon(bucket),size:18),
                  label:Text('${bucketLabel(bucket)} (${countFor(bucket)})'),
                );
              }).toList(),
            ),
            const SizedBox(height:12),
            Card(
              child:ListTile(
                leading:Icon(bucketIcon(selected),color:const Color(0xFFD7B85A)),
                title:Text(bucketLabel(selected),style:const TextStyle(fontWeight:FontWeight.w900)),
                subtitle:Text(
                  selected==_UserBucket.deleted
                    ? 'الحسابات المحذوفة محفوظة كسجل تدقيق ولا تدخل ضمن عدد المستخدمين.'
                    : selected==_UserBucket.disabled
                      ? 'يشمل الحسابات المعطّلة والمعلّقة مؤقتًا.'
                      : 'عدد الحسابات في هذا القسم: ${countFor(selected)}'
                ),
              ),
            ),
            const SizedBox(height:8),
            if(visible.isEmpty)
              const Card(child:ListTile(
                leading:Icon(Icons.person_search_outlined),
                title:Text('لا توجد نتائج مطابقة في هذا القسم'),
              ))
            else
              ...visible.map(userCard),
          ]);
        },
      ),
    ],
  );
}

class UserReadOnlyPage extends StatelessWidget {
  const UserReadOnlyPage({super.key,required this.uid,required this.data});
  final String uid; final Map<String,dynamic> data;
  String t(dynamic v)=>v==null?'—':'$v';
  @override Widget build(BuildContext context){
    final caps=data['capabilities'] is List?(data['capabilities'] as List).map((e)=>'$e').toList():<String>[];
    final isOwner=t(data['role']??'user')=='owner';
    return Scaffold(
      appBar:AppBar(title:const Text('تفاصيل المستخدم')),
      body:ListView(padding:const EdgeInsets.all(16),children:[
        _UserAccountOverviewCard(uid:uid,seed:data),
        const SizedBox(height:10),
        Card(child:ListTile(
          leading:const Icon(Icons.admin_panel_settings_outlined,color:Color(0xFFD7B85A)),
          title:const Text('الصلاحيات'),
          subtitle:Text(isOwner
              ? 'كل الصلاحيات مفعّلة تلقائيًا للـOwner (الصلاحيات الفعلية لا تعتمد على قائمة capabilities المخزنة).'
              : (caps.isEmpty?'لا توجد صلاحيات إضافية':caps.join(' • '))),
        )),
        const SizedBox(height:10),
        _RolePolicyCard(role:t(data['role']??'user'),adminEnabled:data['adminEnabled']==true,capabilities:caps),
        const SizedBox(height:10),
        OwnerUserAccessCard(
          uid:uid,
          targetRole:t(data['role']??'user'),
          adminEnabled:data['adminEnabled']==true,
          capabilities:caps,
        ),
        const SizedBox(height:10),
        _OwnerAccountActionsCard(
          uid:uid,
          targetRole:t(data['role']??'user'),
          accountStatus:t(data['accountStatus']??'active'),
          suspendedUntil:data['suspendedUntil'],
        ),
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
class _UserAccountOverviewCard extends StatefulWidget {
  const _UserAccountOverviewCard({required this.uid,required this.seed});
  final String uid;
  final Map<String,dynamic> seed;
  @override State<_UserAccountOverviewCard> createState()=>_UserAccountOverviewCardState();
}

class _UserAccountOverviewCardState extends State<_UserAccountOverviewCard> {
  late final Future<Map<String,dynamic>> future=_load();
  bool expanded=false;

  String text(dynamic value){
    if(value==null)return '';
    if(value is List)return value.map((e)=>'$e').join('، ');
    return '$value'.trim();
  }

  dynamic firstValue(List<dynamic> values){
    for(final value in values){
      if(value==null)continue;
      if(value is String && value.trim().isEmpty)continue;
      return value;
    }
    return null;
  }

  Future<Map<String,dynamic>> _load() async {
    final user=controlAuth.currentUser;
    if(user==null)throw Exception('not_signed_in');
    await user.reload();
      final refreshed=controlAuth.currentUser;
      if(refreshed==null)throw Exception('not_signed_in');
      final token=await refreshed.getIdToken(true).timeout(const Duration(seconds:12));
    if(token==null||token.isEmpty)throw Exception('empty_token');
    final response=await http.post(
      shadowApiEndpoint('control-user-details'),
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
      body:jsonEncode({'targetUid':widget.uid}),
    ).timeout(const Duration(seconds:25));
    final body=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
    if(response.statusCode<200||response.statusCode>=300||body['ok']!=true){
      throw Exception((body['code']??'request_failed').toString());
    }
    return body;
  }

  Map<String,dynamic> map(dynamic value)=>value is Map
      ? Map<String,dynamic>.from(value)
      : <String,dynamic>{};

  ImageProvider? avatar(Map<String,dynamic> user,Map<String,dynamic> profile,Map<String,dynamic> auth){
    final url=text(firstValue([
      user['profileImageUrl'],profile['profileImageUrl'],user['profileImage'],user['avatarUrl'],auth['photoUrl'],
    ]));
    if(url.startsWith('http://')||url.startsWith('https://'))return NetworkImage(url);
    final asset=text(firstValue([user['profileAvatarAsset'],profile['profileAvatarAsset']]));
    if(asset.isNotEmpty)return AssetImage(asset);
    return null;
  }

  String providerLabel(String provider)=>switch(provider){
    'google.com'=>'Google',
    'phone'=>'رقم الهاتف',
    'password'=>'البريد الإلكتروني',
    'apple.com'=>'Apple',
    'facebook.com'=>'Facebook',
    _=>provider,
  };

  Widget providerChip(String label,IconData icon,bool linked){
    return Chip(
      avatar:Icon(icon,size:18,color:linked?Colors.greenAccent:Colors.white38),
      label:Text(label),
      side:BorderSide(color:linked?Colors.greenAccent.withValues(alpha:.35):Colors.white12),
      backgroundColor:linked?Colors.green.withValues(alpha:.10):Colors.white.withValues(alpha:.03),
    );
  }

  Widget detailRow(String label,dynamic value,{bool ltr=false}){
    final rendered=text(value);
    return Padding(
      padding:const EdgeInsets.symmetric(vertical:5),
      child:Row(crossAxisAlignment:CrossAxisAlignment.start,children:[
        SizedBox(width:112,child:Text(label,style:const TextStyle(color:Color(0xFFAAA3B8),fontWeight:FontWeight.w700))),
        const SizedBox(width:8),
        Expanded(child:SelectableText(
          rendered.isEmpty?'—':rendered,
          textDirection:ltr?TextDirection.ltr:null,
          style:const TextStyle(fontWeight:FontWeight.w700),
        )),
      ]),
    );
  }

  Widget sectionTitle(String title,IconData icon)=>Padding(
    padding:const EdgeInsets.only(top:14,bottom:5),
    child:Row(children:[
      Icon(icon,size:19,color:const Color(0xFFD7B85A)),
      const SizedBox(width:7),
      Text(title,style:const TextStyle(fontWeight:FontWeight.w900,fontSize:16)),
    ]),
  );

  @override Widget build(BuildContext context){
    return FutureBuilder<Map<String,dynamic>>(
      future:future,
      builder:(context,snap){
        final body=snap.data??<String,dynamic>{};
        final remoteUser=map(body['user']);
        final profile=map(body['publicProfile']);
        final auth=map(body['auth']);
        final room=map(body['room']);
        final agency=map(body['agency']);
        final data=<String,dynamic>{...widget.seed,...remoteUser};

        final providers=(auth['providers'] is List)
            ? (auth['providers'] as List).whereType<Map>().map((e)=>Map<String,dynamic>.from(e)).toList()
            : <Map<String,dynamic>>[];
        bool hasProvider(String id)=>providers.any((p)=>text(p['providerId'])==id);

        final email=text(firstValue([auth['email'],data['email']]));
        final phone=text(firstValue([auth['phoneNumber'],data['phone']]));
        final hasEmail=hasProvider('password');
        final hasPhone=hasProvider('phone');
        final hasGoogle=hasProvider('google.com');
        final displayName=text(firstValue([
          data['displayName'],profile['displayName'],data['name'],auth['displayName'],'مستخدم بدون اسم'
        ]));
        final publicId=text(firstValue([data['publicId'],profile['publicId']]));
        final role=text(firstValue([data['role'],'user']));
        final status=text(firstValue([data['accountStatus'],'active']));
        final vip=firstValue([data['vipLevel'],profile['vipLevel'],0]);
        final level=firstValue([data['level'],profile['level'],0]);
        final charisma=firstValue([
          data['charisma'],data['charismaLevel'],
          profile['charisma'],profile['charismaLevel'],
          data['popularity'],data['popularityLevel'],
          profile['popularity'],profile['popularityLevel'],
          data['appeal'],data['appealLevel'],
          profile['appeal'],profile['appealLevel'],
        ]);
        final wealth=firstValue([data['wealth'],data['wealthLevel'],profile['wealth'],profile['wealthLevel']]);
        final roomId=text(firstValue([room['publicId'],data['personalRoomId'],data['roomId'],room['id']]));
        final agencyName=text(firstValue([agency['name'],agency['displayName'],agency['agencyName']]));
        final agencyId=text(firstValue([data['agencyId'],agency['id']]));
        final image=avatar(data,profile,auth);

        return Card(
          child:Padding(
            padding:const EdgeInsets.all(16),
            child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
              Row(crossAxisAlignment:CrossAxisAlignment.center,children:[
                CircleAvatar(
                  radius:31,
                  backgroundImage:image,
                  child:image==null?const Icon(Icons.person,size:32):null,
                ),
                const SizedBox(width:12),
                Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
                  Text(displayName,style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900)),
                  const SizedBox(height:3),
                  if(publicId.isNotEmpty)Text('ID: $publicId',textDirection:TextDirection.ltr,style:const TextStyle(color:Color(0xFFAAA3B8))),
                  Text('الحالة: $status • الدور: $role',style:const TextStyle(color:Color(0xFFAAA3B8))),
                ])),
              ]),
              const SizedBox(height:12),
              const Text('ربط الحساب',style:TextStyle(fontWeight:FontWeight.w900)),
              const SizedBox(height:6),
              Wrap(spacing:7,runSpacing:7,children:[
                providerChip('رقم الهاتف',Icons.phone_outlined,hasPhone),
                providerChip('Google',Icons.g_mobiledata_rounded,hasGoogle),
                providerChip('البريد',Icons.email_outlined,hasEmail),
              ]),
              if(snap.connectionState==ConnectionState.waiting)...[
                const SizedBox(height:8),
                const LinearProgressIndicator(minHeight:2),
              ],
              if(snap.hasError)...[
                const SizedBox(height:8),
                Text('تعذر تحميل التفاصيل الإضافية: \${snap.error}',style:const TextStyle(color:Colors.orangeAccent,fontSize:12)),
              ],
              const Divider(height:24),
              InkWell(
                borderRadius:BorderRadius.circular(12),
                onTap:()=>setState(()=>expanded=!expanded),
                child:Padding(
                  padding:const EdgeInsets.symmetric(vertical:8),
                  child:Row(children:[
                    Icon(expanded?Icons.keyboard_arrow_up:Icons.keyboard_arrow_down,color:const Color(0xFFD7B85A)),
                    const SizedBox(width:8),
                    Text(expanded?'إخفاء التفاصيل':'عرض المزيد',style:const TextStyle(fontWeight:FontWeight.w900)),
                    const Spacer(),
                    Text('VIP $vip • Lv.$level',style:const TextStyle(color:Color(0xFFAAA3B8))),
                  ]),
                ),
              ),
              if(expanded)...[
                sectionTitle('هوية الحساب',Icons.badge_outlined),
                detailRow('UID',widget.uid,ltr:true),
                detailRow('Public ID',publicId,ltr:true),
                detailRow('اسم المستخدم',firstValue([data['username'],profile['username']])),
                detailRow('البريد',email,ltr:true),
                detailRow('البريد موثّق',auth['emailVerified']==true?'نعم':'لا'),
                detailRow('رقم الهاتف',phone,ltr:true),
                detailRow('طرق الربط',providers.map((p)=>providerLabel(text(p['providerId']))).where((e)=>e.isNotEmpty).join(' • ')),
                detailRow('Auth معطّل',auth['disabled']==true?'نعم':'لا'),

                sectionTitle('المستويات والحالة',Icons.workspace_premium_outlined),
                detailRow('المستوى',level),
                detailRow('VIP',vip),
                detailRow('الجاذبية',charisma),
                detailRow('الثروة',wealth),
                detailRow('الدور',role),
                detailRow('دخول الإدارة',data['adminEnabled']==true?'مفعّل':'غير مفعّل'),
                detailRow('حالة الحساب',status),

                sectionTitle('الغرفة والوكالة',Icons.meeting_room_outlined),
                detailRow('Room ID',roomId,ltr:true),
                detailRow('اسم الغرفة',firstValue([room['name'],room['title']])),
                detailRow('نوع الغرفة',firstValue([room['roomType'],room['type']])),
                detailRow('الوكالة',agencyName.isNotEmpty?agencyName:(agencyId.isNotEmpty?'مسجل':'غير مسجل')),
                detailRow('Agency ID',agencyId,ltr:true),
                detailRow('دوره بالوكالة',data['agencyRole']),

                sectionTitle('المحفظة والإحصائيات',Icons.account_balance_wallet_outlined),
                detailRow('Coins',formatCompactAmount(data['coins'])),
                detailRow('Diamonds',formatCompactAmount(data['diamonds'])),
                detailRow('Balance',formatCompactAmount(data['balance'])),
                detailRow('هدايا أرسلها',formatCompactAmount(data['totalGiftsSent'])),
                detailRow('هدايا استلمها',formatCompactAmount(data['totalGiftsReceived'])),
                detailRow('قيمة مستلمة',formatCompactAmount(data['totalValueReceived'])),
                detailRow('دعم مستلم',formatCompactAmount(data['giftSupportReceivedCoins'])),
                detailRow('Diamonds Lifetime',formatCompactAmount(data['giftDiamondsLifetime'])),

                sectionTitle('الملف الشخصي',Icons.account_circle_outlined),
                detailRow('الجنس',data['gender']),
                detailRow('تاريخ الميلاد',data['birthDate']),
                detailRow('الدولة',data['country']),
                detailRow('الموقع',firstValue([data['location'],profile['location']])),
                detailRow('النبذة',firstValue([data['bio'],profile['bio']])),
                detailRow('الاهتمامات',firstValue([data['interests'],profile['interests']])),
                detailRow('متصل الآن',firstValue([data['isOnline'],profile['isOnline']])==true?'نعم':'لا'),

                sectionTitle('تواريخ الحساب',Icons.history_outlined),
                detailRow('إنشاء Auth',auth['createdAt']),
                detailRow('آخر دخول',auth['lastLoginAt']),
                detailRow('آخر Refresh',auth['lastRefreshAt']),
                detailRow('إنشاء الملف',firstValue([data['createdAt'],profile['createdAt']])),
                detailRow('آخر تحديث',firstValue([data['updatedAt'],profile['updatedAt']])),
              ],
            ]),
          ),
        );
      },
    );
  }
}

class _OwnerAccountActionsCard extends StatelessWidget {
  const _OwnerAccountActionsCard({
    required this.uid,
    required this.targetRole,
    required this.accountStatus,
    required this.suspendedUntil,
  });
  final String uid,targetRole,accountStatus;
  final dynamic suspendedUntil;

  bool get protectedOwner=>targetRole=='owner';
  bool get blocked=>accountStatus=='banned'||accountStatus=='suspended'||accountStatus=='disabled'||accountStatus=='deleted';

  String statusLabel(){
    if(accountStatus=='suspended')return 'معلّق مؤقتًا';
    if(accountStatus=='banned')return 'محظور دائمًا';
    if(accountStatus=='disabled')return 'معطّل';
    if(accountStatus=='deleted')return 'محذوف';
    return 'نشط';
  }

  Future<void> _execute(BuildContext context,String action,String reason,{int? durationMinutes}) async {
    try{
      final user=controlAuth.currentUser;
      if(user==null)throw Exception('not_signed_in');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('empty_token');
      final prefix=user.uid.length>=6?user.uid.substring(0,6):user.uid;
      final key='acct_'+DateTime.now().millisecondsSinceEpoch.toString()+'_'+prefix;
      final response=await http.post(
        shadowApiEndpoint('manage-user-account'),
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:jsonEncode({
          'targetUid':uid,
          'accountAction':action,
          'reason':reason,
          'idempotencyKey':key,
          if(durationMinutes!=null)'durationMinutes':durationMinutes,
        }),
      ).timeout(const Duration(seconds:25));
      final body=response.body.isEmpty?<String,dynamic>{}:jsonDecode(response.body) as Map<String,dynamic>;
      if(response.statusCode<200||response.statusCode>=300||body['ok']!=true){
        final code=(body['code']??'request_failed').toString();
        throw Exception(code);
      }
      if(!context.mounted)return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('تم تنفيذ الإجراء وتسجيله في Audit Log.')));
      Navigator.pop(context);
    }catch(e){
      if(!context.mounted)return;
      final code=e.toString().replaceFirst('Exception: ','');
      final message=switch(code){
        'recent_auth_required'=>'يلزم تسجيل دخول حديث للـOwner. سجّل خروج ثم ادخل من جديد.',
        'owner_protected'=>'حساب Owner محمي ولا يمكن حظره أو حذفه.',
        'not_found'=>'المستخدم غير موجود.',
        'invalid_suspend_duration'=>'مدة التعليق غير صالحة.',
        'not_signed_in'=>'انتهت جلسة Shadow Control. سجّل دخول الأونر من جديد ثم أعد المحاولة.',
        'unauthorized'=>'انتهت جلسة Shadow Control. سجّل دخول الأونر من جديد ثم أعد المحاولة.',
        'PERMISSION_DENIED'=>'حساب الخدمة لا يملك صلاحية Firebase Auth المطلوبة.',
        _=>'تعذر تنفيذ الإجراء: '+code,
      };
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(message),duration:const Duration(seconds:6)));
    }
  }

  Future<String?> _reason(BuildContext context,String title) async {
    final controller=TextEditingController();
    final result=await showDialog<String>(
      context:context,
      builder:(c)=>AlertDialog(
        title:Text(title),
        content:TextField(
          controller:controller,
          maxLength:160,
          maxLines:2,
          decoration:const InputDecoration(labelText:'سبب الإجراء *',border:OutlineInputBorder()),
        ),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>controller.text.trim().length<3?null:Navigator.pop(c,controller.text.trim()),child:const Text('متابعة')),
        ],
      ),
    );
    controller.dispose();
    return result;
  }

  Future<void> _suspend(BuildContext context) async {
    final reason=await _reason(context,'تعليق حساب المستخدم');
    if(reason==null||!context.mounted)return;
    int minutes=1440;
    final confirmed=await showDialog<bool>(
      context:context,
      builder:(c)=>StatefulBuilder(builder:(context,setState)=>AlertDialog(
        title:const Text('مدة التعليق'),
        content:DropdownButtonFormField<int>(
          initialValue:minutes,
          decoration:const InputDecoration(labelText:'المدة',border:OutlineInputBorder()),
          items:const[
            DropdownMenuItem(value:60,child:Text('ساعة')),
            DropdownMenuItem(value:360,child:Text('6 ساعات')),
            DropdownMenuItem(value:1440,child:Text('24 ساعة')),
            DropdownMenuItem(value:10080,child:Text('7 أيام')),
            DropdownMenuItem(value:43200,child:Text('30 يومًا')),
          ],
          onChanged:(v){if(v!=null)setState(()=>minutes=v);},
        ),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('تعليق الحساب')),
        ],
      )),
    );
    if(confirmed==true&&context.mounted)await _execute(context,'suspend',reason,durationMinutes:minutes);
  }

  Future<void> _simple(BuildContext context,String action,String title,{bool destructive=false}) async {
    final reason=await _reason(context,title);
    if(reason==null||!context.mounted)return;
    final ok=await showDialog<bool>(
      context:context,
      builder:(c)=>AlertDialog(
        title:Text(title),
        content:Text(destructive
          ? 'هذا إجراء حساس. سيتم تعطيل وصول المستخدم وتسجيل العملية بالكامل.'
          : 'سيتم تنفيذ الإجراء عبر Backend وتسجيله في Audit Log.'),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),
          FilledButton(onPressed:()=>Navigator.pop(c,true),child:const Text('تأكيد')),
        ],
      ),
    );
    if(ok==true&&context.mounted)await _execute(context,action,reason);
  }

  Future<void> _delete(BuildContext context) async {
    final reason=await _reason(context,'حذف حساب المستخدم');
    if(reason==null||!context.mounted)return;
    final confirm=TextEditingController();
    final ok=await showDialog<bool>(
      context:context,
      builder:(c)=>AlertDialog(
        title:const Text('حذف الحساب نهائيًا'),
        content:Column(mainAxisSize:MainAxisSize.min,crossAxisAlignment:CrossAxisAlignment.start,children:[
          const Text('سيتم حذف حساب Firebase Auth ومنع تسجيل الدخول نهائيًا. السجل المالي وAudit Log يبقيان محفوظين للتدقيق.'),
          const SizedBox(height:12),
          TextField(controller:confirm,decoration:const InputDecoration(labelText:'اكتب كلمة حذف للتأكيد',border:OutlineInputBorder())),
        ]),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(c,false),child:const Text('إلغاء')),
          FilledButton(
            onPressed:()=>confirm.text.trim()=='حذف'?Navigator.pop(c,true):null,
            child:const Text('حذف نهائي'),
          ),
        ],
      ),
    );
    confirm.dispose();
    if(ok==true&&context.mounted)await _execute(context,'deleteAccount',reason);
  }

  @override Widget build(BuildContext context){
    final suspendedText=suspendedUntil==null||'$suspendedUntil'.isEmpty?'':' • حتى: $suspendedUntil';
    return Card(child:Padding(
      padding:const EdgeInsets.all(16),
      child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Row(children:[
          Icon(protectedOwner?Icons.shield_rounded:Icons.gpp_maybe_outlined,color:protectedOwner?const Color(0xFFD7B85A):Colors.orangeAccent),
          const SizedBox(width:8),
          const Expanded(child:Text('إجراءات الحساب والحظر',style:TextStyle(fontWeight:FontWeight.w900,fontSize:17))),
          Chip(label:Text(statusLabel())),
        ]),
        const SizedBox(height:6),
        Text(protectedOwner
          ? 'حساب Owner محمي من الحظر والحذف.'
          : 'تعليق مؤقت، حظر دائم، تعطيل، إنهاء الجلسات أو حذف الحساب. كل إجراء Backend-only ومسجل في Audit Log.'+suspendedText,
          style:const TextStyle(color:Color(0xFFAAA3B8))),
        const SizedBox(height:12),
        Wrap(spacing:8,runSpacing:8,children:[
          FilledButton.tonalIcon(onPressed:protectedOwner||accountStatus=='deleted'?null:()=>_suspend(context),icon:const Icon(Icons.timer_off_outlined),label:const Text('تعليق مؤقت')),
          FilledButton.tonalIcon(onPressed:protectedOwner||accountStatus=='deleted'?null:()=>_simple(context,'ban','حظر المستخدم نهائيًا',destructive:true),icon:const Icon(Icons.block),label:const Text('حظر دائم')),
          OutlinedButton.icon(onPressed:protectedOwner||accountStatus=='deleted'?null:()=>_simple(context,'disable','تعطيل الحساب'),icon:const Icon(Icons.pause_circle_outline),label:const Text('تعطيل')),
          OutlinedButton.icon(onPressed:protectedOwner||accountStatus=='deleted'?null:()=>_simple(context,'revokeSessions','إنهاء جلسات المستخدم'),icon:const Icon(Icons.phonelink_erase_outlined),label:const Text('إنهاء الجلسات')),
          if(blocked&&accountStatus!='deleted')
            FilledButton.icon(onPressed:protectedOwner?null:()=>_simple(context,accountStatus=='banned'?'unban':'enable','إعادة تفعيل الحساب'),icon:const Icon(Icons.lock_open_outlined),label:const Text('فك الحظر / تفعيل')),
          FilledButton.icon(
            style:FilledButton.styleFrom(backgroundColor:Colors.red.shade800),
            onPressed:protectedOwner||accountStatus=='deleted'?null:()=>_delete(context),
            icon:const Icon(Icons.delete_forever_outlined),
            label:const Text('حذف الحساب'),
          ),
        ]),
      ]),
    ));
  }
}

class _OwnerEconomyCard extends StatelessWidget {
  const _OwnerEconomyCard({required this.uid,required this.coins,required this.diamonds});
  final String uid; final dynamic coins,diamonds;
  @override Widget build(BuildContext context){
    final current=controlAuth.currentUser;
    return FutureBuilder<DocumentSnapshot<Map<String,dynamic>>>(
      future:current==null?null:controlFirestore.collection('users').doc(current.uid).get(),
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
      final user=controlAuth.currentUser;if(user==null)throw Exception('not_signed_in');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('empty_token');
      final key='bal_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=shadowApiEndpoint('adjust-balance');
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
    'reviewReports':'مراجعة البلاغات','manageEconomy':'إدارة الاقتصاد','manageGames':'إدارة الألعاب','manageWithdrawals':'إدارة السحب',
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
      Text(isOwner?'تعديلات هذا الحساب محمية.':'يمكن للـOwner تعديل الدور والصلاحيات من بطاقة الإدارة أدناه.',style:const TextStyle(fontWeight:FontWeight.w800)),
      const Text('كل تغيير حساس يمر عبر Cloudflare Backend ويُسجل في Audit Log؛ لا توجد كتابة مباشرة من PWA.'),
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
  final roomName=TextEditingController();
  final roomCategory=TextEditingController();
  final roomDescription=TextEditingController();
  final roomCover=TextEditingController();
  final roomTags=TextEditingController();
  bool busy=false,bypassLevelCapacity=false,hiddenOfficialRoom=false;
  String officialType='official';
  Map<String,dynamic>? room;
  String? error;

  @override void dispose(){
    publicId.dispose();reason.dispose();seats.dispose();moderators.dispose();hostUid.dispose();
    roomName.dispose();roomCategory.dispose();roomDescription.dispose();roomCover.dispose();roomTags.dispose();
    super.dispose();
  }

  Uri get apiUri=>shadowApiEndpoint('voice-session');

  Future<Map<String,dynamic>> post(Map<String,dynamic> payload) async {
    final user=controlAuth.currentUser;
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
    'global_room_control_required'=>'إنشاء/إدارة الغرف الرسمية يتطلب Owner أو globalRoomControl.',
    'host_not_found'=>'حساب الـHost غير موجود.',
    'invalid_room_name'=>'اسم الغرفة يجب أن يكون بين حرفين و80 حرفًا.',
    'room_public_id_taken'=>'Room ID مستخدم مسبقًا.',
    'invalid_official_room_type'=>'نوع الغرفة الرسمية غير صالح.',
    'invalid_room_visibility'=>'خصوصية الغرفة الرسمية غير صالحة.',
    'room_public_id_exhausted'=>'تعذر حجز Room ID تلقائيًا. حاول مرة أخرى.',
    'official_room_required'=>'هذا التعديل متاح فقط للغرف الرسمية أو الإدارية.',
    _=>'تعذر تنفيذ العملية: '+code,
  };

  void syncControllers(Map<String,dynamic> data){
    final policy=data['policy'] is Map<String,dynamic>?data['policy'] as Map<String,dynamic>:<String,dynamic>{};
    final overrides=policy['overrides'] is Map<String,dynamic>?policy['overrides'] as Map<String,dynamic>:<String,dynamic>{};
    seats.text=overrides['seats']?.toString()??'';
    moderators.text=overrides['moderators']?.toString()??'';
    hostUid.text=policy['hostUid']?.toString()??'';
    roomName.text=(data['name']??'').toString();
    roomCategory.text=(data['category']??'').toString();
    roomDescription.text=(data['description']??'').toString();
    roomCover.text=(data['coverImageUrl']??'').toString();
    roomTags.text=data['tags'] is List?(data['tags'] as List).map((e)=>'$e').join(', '):'';
    officialType=(policy['type']??'official').toString();
    if(!['official','administrative','customer_service'].contains(officialType))officialType='official';
    hiddenOfficialRoom=(data['visibility']??'public').toString()=='hidden';
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
    final user=controlAuth.currentUser;if(user==null)return;
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

  Future<void> showCreateOfficialRoom() async {
    final nameController=TextEditingController();
    final roomIdController=TextEditingController();
    final createHostController=TextEditingController();
    final createSeatsController=TextEditingController(text:'8');
    final createModeratorsController=TextEditingController(text:'3');
    final categoryController=TextEditingController(text:'رسمية');
    final descriptionController=TextEditingController();
    final coverController=TextEditingController();
    final tagsController=TextEditingController();
    var officialType='official';
    var hidden=false;
    var creating=false;

    await showModalBottomSheet<void>(
      context:context,
      isScrollControlled:true,
      backgroundColor:const Color(0xFF0D0917),
      shape:const RoundedRectangleBorder(borderRadius:BorderRadius.vertical(top:Radius.circular(26))),
      builder:(sheetContext)=>Directionality(
        textDirection:TextDirection.rtl,
        child:StatefulBuilder(builder:(context,setSheetState)=>SafeArea(
          child:Padding(
            padding:EdgeInsets.fromLTRB(16,14,16,MediaQuery.viewInsetsOf(context).bottom+18),
            child:SingleChildScrollView(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
              Center(child:Container(width:44,height:4,decoration:BoxDecoration(color:Colors.white24,borderRadius:BorderRadius.circular(99)))),
              const SizedBox(height:14),
              const Row(children:[
                Icon(Icons.add_business_rounded,color:Color(0xFFD7B85A)),
                SizedBox(width:8),
                Expanded(child:Text('إنشاء غرفة رسمية',style:TextStyle(fontSize:21,fontWeight:FontWeight.w900))),
              ]),
              const SizedBox(height:4),
              const Text('الغرفة ستكون ملك Shadow Live. الـHost يدير الجلسة فقط ولا يصبح Owner.',style:TextStyle(color:Color(0xFFAAA3B8),fontSize:12)),
              const SizedBox(height:14),
              TextField(controller:nameController,decoration:const InputDecoration(labelText:'اسم الغرفة *',border:OutlineInputBorder())),
              const SizedBox(height:10),
              TextField(
                controller:roomIdController,
                keyboardType:TextInputType.number,
                decoration:const InputDecoration(labelText:'Room ID — اختياري',hintText:'اتركه فارغًا لتوليد ID تلقائي',border:OutlineInputBorder()),
              ),
              const SizedBox(height:10),
              DropdownButtonFormField<String>(
                initialValue:officialType,
                decoration:const InputDecoration(labelText:'نوع الغرفة',border:OutlineInputBorder()),
                items:const[
                  DropdownMenuItem(value:'official',child:Text('رسمية')),
                  DropdownMenuItem(value:'administrative',child:Text('إدارية')),
                  DropdownMenuItem(value:'customer_service',child:Text('خدمة عملاء')),
                ],
                onChanged:creating?null:(v){if(v!=null)setSheetState(()=>officialType=v);},
              ),
              const SizedBox(height:10),
              TextField(controller:createHostController,decoration:const InputDecoration(labelText:'Host UID — اختياري',border:OutlineInputBorder(),prefixIcon:Icon(Icons.record_voice_over_outlined))),
              const SizedBox(height:10),
              Row(children:[
                Expanded(child:TextField(
                  controller:createSeatsController,
                  keyboardType:TextInputType.number,
                  decoration:const InputDecoration(labelText:'عدد المايكات',hintText:'1 - 50',border:OutlineInputBorder()),
                )),
                const SizedBox(width:10),
                Expanded(child:TextField(
                  controller:createModeratorsController,
                  keyboardType:TextInputType.number,
                  decoration:const InputDecoration(labelText:'عدد المشرفين',hintText:'0 - 30',border:OutlineInputBorder()),
                )),
              ]),
              const SizedBox(height:10),
              TextField(controller:categoryController,decoration:const InputDecoration(labelText:'التصنيف',border:OutlineInputBorder())),
              const SizedBox(height:10),
              TextField(controller:descriptionController,maxLines:2,decoration:const InputDecoration(labelText:'وصف الغرفة',border:OutlineInputBorder())),
              const SizedBox(height:10),
              TextField(controller:coverController,decoration:const InputDecoration(labelText:'رابط صورة / غلاف الغرفة',border:OutlineInputBorder())),
              const SizedBox(height:10),
              TextField(controller:tagsController,decoration:const InputDecoration(labelText:'وسوم — افصل بينها بفاصلة',border:OutlineInputBorder())),
              SwitchListTile(
                contentPadding:EdgeInsets.zero,
                title:const Text('غرفة مخفية'),
                subtitle:const Text('لا تظهر في الاكتشاف العام.'),
                value:hidden,
                onChanged:creating?null:(v)=>setSheetState(()=>hidden=v),
              ),
              const SizedBox(height:8),
              SizedBox(width:double.infinity,child:FilledButton.icon(
                onPressed:creating?null:() async {
                  final user=controlAuth.currentUser;
                  if(user==null)return;
                  final prefix=user.uid.length>=6?user.uid.substring(0,6):user.uid;
                  final key='roomcreate_'+DateTime.now().millisecondsSinceEpoch.toString()+'_'+prefix;
                  setSheetState(()=>creating=true);
                  try{
                    final data=await post({
                      'controlAction':'createOfficialRoom',
                      'name':nameController.text.trim(),
                      'publicId':roomIdController.text.trim(),
                      'hostUid':createHostController.text.trim(),
                      'officialType':officialType,
                      'seats':int.tryParse(createSeatsController.text.trim()),
                      'moderators':int.tryParse(createModeratorsController.text.trim()),
                      'category':categoryController.text.trim(),
                      'description':descriptionController.text.trim(),
                      'coverImageUrl':coverController.text.trim(),
                      'tags':tagsController.text.split(',').map((e)=>e.trim()).where((e)=>e.isNotEmpty).toList(),
                      'visibility':hidden?'hidden':'public',
                      'reason':'إنشاء غرفة رسمية من Shadow Control',
                      'idempotencyKey':key,
                    });
                    final createdPublicId=(data['publicId']??'').toString();
                    if(createdPublicId.isNotEmpty)publicId.text=createdPublicId;
                    if(sheetContext.mounted)Navigator.pop(sheetContext);
                    if(createdPublicId.isNotEmpty)await lookup();
                    if(mounted){
                      ScaffoldMessenger.of(this.context).showSnackBar(
                        SnackBar(content:Text('تم إنشاء الغرفة الرسمية — Room ID: '+createdPublicId)),
                      );
                    }
                  }catch(e){
                    if(sheetContext.mounted){
                      final code=e.toString().replaceFirst('Exception: ','');
                      ScaffoldMessenger.of(sheetContext).showSnackBar(SnackBar(content:Text(message(code))));
                      setSheetState(()=>creating=false);
                    }
                  }
                },
                icon:creating
                    ? const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2))
                    : const Icon(Icons.add_business_rounded),
                label:Text(creating?'جار الإنشاء...':'إنشاء الغرفة الرسمية وحفظها'),
              )),
            ])),
          ),
        )),
      ),
    );

    nameController.dispose();
    roomIdController.dispose();
    createHostController.dispose();
    createSeatsController.dispose();
    createModeratorsController.dispose();
    categoryController.dispose();
    descriptionController.dispose();
    coverController.dispose();
    tagsController.dispose();
  }

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
      const Text('إنشاء وإدارة الغرف الرسمية + Room Level + Overrides — كل التعديلات الحساسة تمر عبر Backend وAudit Log.',style:TextStyle(color:Color(0xFFAAA3B8))),
      const SizedBox(height:12),
      SizedBox(width:double.infinity,child:FilledButton.icon(
        onPressed:busy?null:showCreateOfficialRoom,
        icon:const Icon(Icons.add_business_rounded),
        label:const Text('+ إنشاء غرفة رسمية'),
      )),
      const SizedBox(height:12),
      Card(child:ExpansionTile(
        leading:const Icon(Icons.admin_panel_settings_outlined,color:Color(0xFFD7B85A)),
        title:const Text('إدارة الغرف الإدارية والرسمية',style:TextStyle(fontWeight:FontWeight.w900)),
        subtitle:const Text('اختر غرفة للدخول إلى التحكم والتعديل مباشرة.'),
        children:[
          StreamBuilder<QuerySnapshot<Map<String,dynamic>>>(
            stream:controlFirestore.collection('rooms').where('systemOwned',isEqualTo:true).limit(50).snapshots(),
            builder:(context,snap){
              if(snap.connectionState==ConnectionState.waiting)return const Padding(padding:EdgeInsets.all(18),child:CircularProgressIndicator());
              if(snap.hasError)return Padding(padding:const EdgeInsets.all(16),child:Text('تعذر تحميل الغرف الرسمية: ${snap.error}'));
              final docs=snap.data?.docs??[];
              if(docs.isEmpty)return const ListTile(title:Text('لا توجد غرف إدارية/رسمية حتى الآن.'));
              return Column(children:docs.map((doc){
                final d=doc.data();
                final id=(d['publicId']??'').toString();
                final type=(d['roomType']??d['type']??'official').toString();
                return ListTile(
                  leading:Icon(type=='administrative'?Icons.admin_panel_settings:Icons.verified_rounded,color:const Color(0xFFD7B85A)),
                  title:Text((d['name']??d['title']??'غرفة رسمية').toString(),style:const TextStyle(fontWeight:FontWeight.w800)),
                  subtitle:Text('ID: ${id.isEmpty?'—':id} • النوع: $type'),
                  trailing:const Icon(Icons.tune_rounded),
                  onTap:id.isEmpty?null:() async {
                    publicId.text=id;
                    await lookup();
                  },
                );
              }).toList());
            },
          ),
        ],
      )),
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
          const Text('الغرفة الرسمية ملك Shadow Live. يمكنك تعديل بياناتها والـHost والنوع والخصوصية من هنا.',style:TextStyle(color:Color(0xFFAAA3B8),fontSize:12)),
          const SizedBox(height:12),
          if(official)...[
            TextField(controller:roomName,decoration:const InputDecoration(labelText:'اسم الغرفة',border:OutlineInputBorder())),
            const SizedBox(height:10),
            DropdownButtonFormField<String>(
              initialValue:officialType,
              decoration:const InputDecoration(labelText:'نوع الغرفة',border:OutlineInputBorder()),
              items:const[
                DropdownMenuItem(value:'official',child:Text('رسمية')),
                DropdownMenuItem(value:'administrative',child:Text('إدارية')),
                DropdownMenuItem(value:'customer_service',child:Text('خدمة عملاء')),
              ],
              onChanged:busy?null:(v){if(v!=null)setState(()=>officialType=v);},
            ),
            const SizedBox(height:10),
            TextField(controller:hostUid,decoration:const InputDecoration(labelText:'Host UID',hintText:'اختياري',border:OutlineInputBorder(),prefixIcon:Icon(Icons.record_voice_over_outlined))),
            const SizedBox(height:10),
            TextField(controller:roomCategory,decoration:const InputDecoration(labelText:'التصنيف',border:OutlineInputBorder())),
            const SizedBox(height:10),
            TextField(controller:roomDescription,maxLines:2,decoration:const InputDecoration(labelText:'الوصف',border:OutlineInputBorder())),
            const SizedBox(height:10),
            TextField(controller:roomCover,decoration:const InputDecoration(labelText:'رابط الغلاف',border:OutlineInputBorder())),
            const SizedBox(height:10),
            TextField(controller:roomTags,decoration:const InputDecoration(labelText:'الوسوم — افصل بفاصلة',border:OutlineInputBorder())),
            SwitchListTile(
              contentPadding:EdgeInsets.zero,
              title:const Text('غرفة مخفية'),
              subtitle:const Text('إخفاؤها من الاكتشاف العام.'),
              value:hiddenOfficialRoom,
              onChanged:busy?null:(v)=>setState(()=>hiddenOfficialRoom=v),
            ),
            SizedBox(width:double.infinity,child:FilledButton.icon(
              onPressed:busy?null:()=>execute('updateOfficialRoom',extra:{
                'name':roomName.text.trim(),
                'hostUid':hostUid.text.trim(),
                'officialType':officialType,
                'category':roomCategory.text.trim(),
                'description':roomDescription.text.trim(),
                'coverImageUrl':roomCover.text.trim(),
                'tags':roomTags.text.split(',').map((e)=>e.trim()).where((e)=>e.isNotEmpty).toList(),
                'visibility':hiddenOfficialRoom?'hidden':'public',
              }),
              icon:const Icon(Icons.edit_note_rounded),
              label:const Text('حفظ بيانات الغرفة الإدارية'),
            )),
            const SizedBox(height:10),
          ]else...[
            TextField(controller:hostUid,decoration:const InputDecoration(labelText:'Host UID',hintText:'اختياري',border:OutlineInputBorder(),prefixIcon:Icon(Icons.record_voice_over_outlined))),
            const SizedBox(height:10),
          ],
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
        const SizedBox(height:8),
        SizedBox(
          width:double.infinity,
          child:FilledButton.icon(
            onPressed:busy?null:() async {
              await saveOverrides();
              if(!mounted||room==null)return;
              final currentPolicy=room!['policy'] is Map<String,dynamic>
                  ? room!['policy'] as Map<String,dynamic>
                  : <String,dynamic>{};
              if(currentPolicy['official']==true){
                await execute('setOfficialRoom',extra:{
                  'enabled':true,
                  'officialType':(currentPolicy['type']??'official').toString(),
                  'hostUid':hostUid.text.trim(),
                });
              }
            },
            icon:busy
                ? const SizedBox(width:18,height:18,child:CircularProgressIndicator(strokeWidth:2))
                : const Icon(Icons.save_rounded),
            label:Text(busy?'جار الحفظ...':'حفظ جميع التغييرات'),
          ),
        ),
      ],
    ]);
  }
}

class FinancePage extends StatelessWidget {
  const FinancePage({super.key});

  @override
  Widget build(BuildContext context) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Row(
            children: [
              Icon(
                Icons.account_balance_wallet_outlined,
                size: 28,
                color: Color(0xFFD7B85A),
              ),
              SizedBox(width: 10),
              Text(
                'المالية والاقتصاد',
                style: TextStyle(fontSize: 25, fontWeight: FontWeight.w900),
              ),
            ],
          ),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: const Icon(
                Icons.hub_outlined,
                color: Color(0xFFD7B85A),
              ),
              trailing: const Icon(Icons.chevron_left),
              title: const Text(
                'Economy Control',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: const Text(
                'الشحن + الهدايا + النسب + الأرصدة + السجلات + أقفال الطوارئ من صفحة واحدة',
              ),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const EconomyControlPage(),
                ),
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(
                Icons.sports_esports_rounded,
                color: Color(0xFFD7B85A),
              ),
              trailing: const Icon(Icons.chevron_left),
              title: const Text(
                'Games Control',
                style: TextStyle(fontWeight: FontWeight.w900),
              ),
              subtitle: const Text(
                'تشغيل/إيقاف مستقل + RTP + Bet Ladder + الاحتمالات + الإحصاءات + Audit',
              ),
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const GamesControlPage(),
                ),
              ),
            ),
          ),
          _AdminCollectionTile(
            title: 'تسويات الوكالات',
            subtitle: 'agency_settlements — قراءة فقط',
            icon: Icons.payments_outlined,
            collection: 'agency_settlements',
          ),
          const Card(
            child: ListTile(
              leading: Icon(
                Icons.verified_user_outlined,
                color: Color(0xFFD7B85A),
              ),
              title: Text('العمليات المالية الحساسة Backend-only'),
              subtitle: Text(
                'تعديل الأرصدة، الشحن، الهدايا والتحويلات لا تُنفذ مباشرة من Flutter، وكل تعديل إداري مسجل في Ledger وAudit Log.',
              ),
            ),
          ),
        ],
      );
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
      stream:controlFirestore.collection(collection).limit(100).snapshots(),
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
      stream:controlFirestore.collection('admin_audit_logs').limit(100).snapshots(),
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
    final user=controlAuth.currentUser;
    if(user==null)return null;
    final snap=await controlFirestore.collection('users').doc(user.uid).get();
    return snap.data();
  }

  Future<void> _lookup() async {
    final currentId=AdminIdOverridePolicy.normalize(oldId.text);
    try{AdminIdOverridePolicy.validate(currentId);}catch(_){
      setState(()=>error='ID الغرفة الحالي يجب أن يكون رقمياً من 3 إلى 12 خانة.');return;
    }
    setState((){checking=true;error=null;roomDocId=null;roomData=null;});
    try{
      final idSnap=await controlFirestore.collection('room_ids').doc(currentId).get();
      final target=idSnap.data()?['roomId']?.toString();
      if(target==null||target.isEmpty){
        final retired=idSnap.exists&&idSnap.data()?['reserved']==true;
        throw Exception(retired?'هذا ID غرفة متقاعد ومحجوز.':'لم يتم العثور على غرفة بهذا ID.');
      }
      final roomSnap=await controlFirestore.collection('rooms').doc(target).get();
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
      final user=controlAuth.currentUser;if(user==null)throw Exception('forbidden');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('forbidden');
      final key='rid_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=shadowApiEndpoint('voice-session');
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
    final current=controlAuth.currentUser;
    if(current==null)return false;
    final snap=await controlFirestore.collection('users').doc(current.uid).get();
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
      final user=controlAuth.currentUser;if(user==null)throw Exception('not_signed_in');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('empty_token');
      final key='idcap_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=shadowApiEndpoint('set-id-management-permission');
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
    final user=controlAuth.currentUser;
    if(user==null)return null;
    final snap=await controlFirestore.collection('users').doc(user.uid).get();
    return snap.data();
  }

  Future<void> _lookup() async {
    final currentId=AdminIdOverridePolicy.normalize(oldId.text);
    try{AdminIdOverridePolicy.validate(currentId);}catch(_){
      setState(()=>error='الـID الحالي يجب أن يكون رقمياً من 3 إلى 12 خانة.');return;
    }
    setState((){checking=true;error=null;targetUid=null;targetData=null;});
    try{
      final idSnap=await controlFirestore.collection('public_ids').doc(currentId).get();
      final uid=idSnap.data()?['uid']?.toString();
      if(uid==null||uid.isEmpty){
        final retired=idSnap.exists&&idSnap.data()?['reserved']==true;
        throw Exception(retired?'هذا ID متقاعد ومحجوز وليس ID حاليًا.':'لم يتم العثور على حساب بهذا ID.');
      }
      final userSnap=await controlFirestore.collection('public_profiles').doc(uid).get();
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
      final user=controlAuth.currentUser;if(user==null)throw Exception('forbidden');
      final token=await user.getIdToken().timeout(const Duration(seconds:12));
      if(token==null||token.isEmpty)throw Exception('forbidden');
      final key='pid_${DateTime.now().millisecondsSinceEpoch}_${user.uid.substring(0,6)}';
      final apiUri=shadowApiEndpoint('change-public-id');
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
    final uid=controlAuth.currentUser?.uid;
    if(uid==null)return const Center(child:CircularProgressIndicator());
    return FutureBuilder<DocumentSnapshot<Map<String,dynamic>>>(
      future:controlFirestore.collection('users').doc(uid).get(),
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
