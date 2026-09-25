import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../bloc/auth_bloc.dart';
import '../setup_route.dart';
import '../../../services/navigation_service.dart';

class EmailLoginScreen extends StatefulWidget {
  const EmailLoginScreen({super.key});
  @override State<EmailLoginScreen> createState()=>_EmailLoginScreenState();
}
class _EmailLoginScreenState extends State<EmailLoginScreen>{
 final _emailController=TextEditingController(),_passwordController=TextEditingController(),_confirmPasswordController=TextEditingController(); bool _loading=false,_obscurePassword=true,_createAccount=false;
 @override void dispose(){_emailController.dispose();_passwordController.dispose();_confirmPasswordController.dispose();super.dispose();}
 void _backToAuthChoice()=>Navigator.of(context).pushNamedAndRemoveUntil('/auth-choice',(route)=>false);
 Future<void> _resetPassword()async{final email=_emailController.text.trim();if(email.isEmpty||!email.contains('@')||!email.contains('.')){_message('أدخل بريدك الإلكتروني الصحيح أولاً');return;}setState(()=>_loading=true);try{await FirebaseAuth.instance.sendPasswordResetEmail(email:email);_message('إذا كان هذا البريد مسجلاً في Shadow Live فستصلك رسالة لإعادة تعيين كلمة المرور. افحص البريد وSpam.');}on FirebaseAuthException catch(e){var m='تعذر إرسال رابط الاستعادة الآن';if(e.code=='invalid-email')m='البريد الإلكتروني غير صحيح';if(e.code=='too-many-requests')m='طلبات كثيرة. حاول لاحقًا';if(e.code=='network-request-failed')m='تحقق من اتصال الإنترنت';_message(m);}finally{if(mounted)setState(()=>_loading=false);}}
 Future<void> _submit()async{
  final email=_emailController.text.trim(),password=_passwordController.text;
  if(email.isEmpty||!email.contains('@')||!email.contains('.')){_message('أدخل بريداً إلكترونياً صحيحاً');return;}
  if(password.length<6){_message('كلمة المرور يجب أن تكون 6 أحرف على الأقل');return;}
  if(_createAccount){
   final c=_confirmPasswordController.text;
   if(c.isEmpty){_message('أعد كتابة كلمة المرور');return;}
   if(password!=c){_message('كلمتا المرور غير متطابقتين');return;}
  }
  setState(()=>_loading=true);
  try{
   if(_createAccount){
    final cr=await FirebaseAuth.instance.createUserWithEmailAndPassword(email:email,password:password);
    final user=cr.user;
    if(user==null)throw FirebaseAuthException(code:'user-not-found');
    try{await user.sendEmailVerification();}catch(_){}
    if(!mounted)return;
    Navigator.of(context).pushNamedAndRemoveUntil(AppRoutes.emailVerification,(r)=>false);
   }else{
    final cr=await FirebaseAuth.instance.signInWithEmailAndPassword(email:email,password:password);
    final user=cr.user;
    if(user==null)throw FirebaseAuthException(code:'user-not-found');
    await user.reload();
    final current=FirebaseAuth.instance.currentUser??user;
    final passwordUser=current.providerData.any((provider)=>provider.providerId=='password');
    if(passwordUser&&!current.emailVerified){
     if(!mounted)return;
     Navigator.of(context).pushNamedAndRemoveUntil(AppRoutes.emailVerification,(r)=>false);
     return;
    }
    context.read<AuthBloc>().add(AuthCheckRequested());
   }
  }on FirebaseAuthException catch(e){
   var m='حدث خطأ، حاول مرة أخرى';
   switch(e.code){
    case'email-already-in-use':m='هذا البريد مستخدم مسبقاً';break;
    case'invalid-email':m='البريد الإلكتروني غير صحيح';break;
    case'weak-password':m='كلمة المرور ضعيفة';break;
    case'user-not-found':case'invalid-credential':m='البريد الإلكتروني أو كلمة المرور غير صحيحة';break;
    case'wrong-password':m='كلمة المرور غير صحيحة';break;
    case'too-many-requests':m='محاولات كثيرة. حاول لاحقاً';break;
    case'network-request-failed':m='تحقق من اتصال الإنترنت';break;
   }
   _message(m);
  }finally{
   if(mounted)setState(()=>_loading=false);
  }
 }
 void _message(String m){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(m)));}
 @override Widget build(BuildContext context)=>PopScope(canPop:false,onPopInvokedWithResult:(didPop,result){if(!didPop)_backToAuthChoice();},child:Scaffold(backgroundColor:const Color(0xFF020711),body:Container(width:double.infinity,height:double.infinity,decoration:const BoxDecoration(gradient:RadialGradient(center:Alignment(.65,-.45),radius:1.15,colors:[Color(0xFF251044),Color(0xFF07111F),Color(0xFF020711)])),child:SafeArea(child:SingleChildScrollView(padding:const EdgeInsets.fromLTRB(24,18,24,32),child:Directionality(textDirection:TextDirection.rtl,child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[Align(alignment:Alignment.centerLeft,child:Container(width:48,height:48,decoration:BoxDecoration(shape:BoxShape.circle,color:Colors.white.withValues(alpha:.08),border:Border.all(color:Colors.white.withValues(alpha:.22))),child:IconButton(onPressed:_loading?null:_backToAuthChoice,icon:const Icon(Icons.arrow_forward_ios_rounded,color:Colors.white,size:21)))),const SizedBox(height:35),const Icon(Icons.alternate_email_rounded,color:Color(0xFFFFD54A),size:54),const SizedBox(height:16),Text(_createAccount?'إنشاء حساب بالبريد الإلكتروني':'تسجيل الدخول بالبريد الإلكتروني',textAlign:TextAlign.center,style:const TextStyle(color:Colors.white,fontSize:27,fontWeight:FontWeight.w900)),const SizedBox(height:10),Text(_createAccount?'أنشئ حساب Shadow Live باستخدام بريدك الإلكتروني':'أدخل بريدك الإلكتروني وكلمة المرور للمتابعة',textAlign:TextAlign.center,style:const TextStyle(color:Colors.white60,fontSize:15,height:1.6)),const SizedBox(height:42),TextField(controller:_emailController,enabled:!_loading,keyboardType:TextInputType.emailAddress,textDirection:TextDirection.ltr,style:const TextStyle(color:Colors.white,fontSize:17),decoration:_decoration('البريد الإلكتروني',Icons.email_outlined)),const SizedBox(height:16),TextField(controller:_passwordController,enabled:!_loading,obscureText:_obscurePassword,textDirection:TextDirection.ltr,style:const TextStyle(color:Colors.white,fontSize:17),decoration:_decoration('كلمة المرور',Icons.lock_outline_rounded).copyWith(suffixIcon:IconButton(onPressed:_loading?null:()=>setState(()=>_obscurePassword=!_obscurePassword),icon:Icon(_obscurePassword?Icons.visibility_off_outlined:Icons.visibility_outlined,color:Colors.white54)))),if(!_createAccount)Align(alignment:Alignment.centerLeft,child:TextButton(onPressed:_loading?null:_resetPassword,child:const Text('نسيت كلمة المرور؟',style:TextStyle(color:Color(0xFFFFD54A),fontWeight:FontWeight.w700)))),if(_createAccount)...[const SizedBox(height:16),TextField(controller:_confirmPasswordController,enabled:!_loading,obscureText:_obscurePassword,style:const TextStyle(color:Colors.white,fontSize:17),decoration:_decoration('تأكيد كلمة المرور',Icons.lock_reset_rounded))],const SizedBox(height:30),SizedBox(height:58,child:DecoratedBox(decoration:BoxDecoration(borderRadius:BorderRadius.circular(16),gradient:const LinearGradient(colors:[Color(0xFF8A00FF),Color(0xFFFF00D4)]),boxShadow:const[BoxShadow(color:Color(0x558A00FF),blurRadius:20,spreadRadius:1)]),child:TextButton(onPressed:_loading?null:_submit,child:_loading?const SizedBox(width:25,height:25,child:CircularProgressIndicator(strokeWidth:2.5,color:Colors.white)):Text(_createAccount?'إنشاء الحساب':'تسجيل الدخول',style:const TextStyle(color:Colors.white,fontSize:19,fontWeight:FontWeight.w800))))),const SizedBox(height:24),TextButton(onPressed:_loading?null:()=>setState(()=>_createAccount=!_createAccount),child:Text(_createAccount?'لديك حساب بالفعل؟ تسجيل الدخول':'ليس لديك حساب؟ إنشاء حساب جديد',style:const TextStyle(color:Color(0xFFFFD54A),fontSize:15,fontWeight:FontWeight.w700)))])))))));
 InputDecoration _decoration(String hint,IconData icon)=>InputDecoration(hintText:hint,hintStyle:const TextStyle(color:Colors.white38),prefixIcon:Icon(icon,color:const Color(0xFFFFD54A)),filled:true,fillColor:const Color(0xFF0C1728),contentPadding:const EdgeInsets.symmetric(horizontal:18,vertical:19),enabledBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(16),borderSide:const BorderSide(color:Color(0xFF263A57))),disabledBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(16),borderSide:const BorderSide(color:Color(0xFF1A2940))),focusedBorder:OutlineInputBorder(borderRadius:BorderRadius.circular(16),borderSide:const BorderSide(color:Color(0xFF9D28FF),width:1.5)));
}
