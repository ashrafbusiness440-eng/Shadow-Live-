import 'dart:async';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import '../../../services/navigation_service.dart';
import '../../../shared/services/firebase_service.dart';
import '../setup_route.dart';

class EmailVerificationScreen extends StatefulWidget {
  const EmailVerificationScreen({super.key});

  @override
  State<EmailVerificationScreen> createState()=>_EmailVerificationScreenState();
}

class _EmailVerificationScreenState extends State<EmailVerificationScreen> {
  bool _busy=false;
  int _cooldown=0;
  Timer? _timer;

  User? get user=>FirebaseAuth.instance.currentUser;

  @override
  void initState(){
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_){
      if(user==null && mounted){
        Navigator.of(context).pushNamedAndRemoveUntil(AppRoutes.authChoice,(_)=>false);
      }
    });
  }

  @override
  void dispose(){
    _timer?.cancel();
    super.dispose();
  }

  bool _isPasswordUser(User current)=>
      current.providerData.any((provider)=>provider.providerId=='password');

  void _startCooldown(){
    _timer?.cancel();
    setState(()=>_cooldown=60);
    _timer=Timer.periodic(const Duration(seconds:1),(timer){
      if(!mounted){timer.cancel();return;}
      if(_cooldown<=1){
        timer.cancel();
        setState(()=>_cooldown=0);
      }else{
        setState(()=>_cooldown--);
      }
    });
  }

  Future<void> _resend()async{
    final current=user;
    if(current==null||_busy||_cooldown>0)return;
    setState(()=>_busy=true);
    try{
      if(!_isPasswordUser(current)){
        await _continueAfterVerification();
        return;
      }
      await current.sendEmailVerification();
      _startCooldown();
      _message('تم إرسال رسالة تحقق جديدة إلى ${current.email??'بريدك الإلكتروني'}');
    }on FirebaseAuthException catch(e){
      final message=switch(e.code){
        'too-many-requests'=>'تم إرسال طلبات كثيرة. حاول لاحقًا.',
        'network-request-failed'=>'تحقق من اتصال الإنترنت.',
        _=>'تعذر إرسال رسالة التحقق الآن.',
      };
      _message(message);
    }finally{
      if(mounted)setState(()=>_busy=false);
    }
  }

  Future<void> _check()async{
    final current=user;
    if(current==null||_busy)return;
    setState(()=>_busy=true);
    try{
      await current.reload();
      final refreshed=FirebaseAuth.instance.currentUser;
      if(refreshed==null)throw FirebaseAuthException(code:'user-not-found');
      if(_isPasswordUser(refreshed)&&!refreshed.emailVerified){
        _message('البريد لم يتم تأكيده بعد. افتح رسالة Shadow Live واضغط رابط التحقق.');
        return;
      }
      await refreshed.getIdToken(true);
      await _continueAfterVerification();
    }on FirebaseAuthException catch(e){
      final message=e.code=='network-request-failed'
          ?'تحقق من اتصال الإنترنت.'
          :'تعذر التحقق من حالة البريد الآن.';
      _message(message);
    }finally{
      if(mounted)setState(()=>_busy=false);
    }
  }

  Future<void> _continueAfterVerification()async{
    final current=FirebaseAuth.instance.currentUser;
    if(current==null)return;
    if(_isPasswordUser(current)&&!current.emailVerified)return;
    await current.getIdToken(true);
    String destination=AppRoutes.profileSetup;
    try{
      final ref=FirebaseFirestore.instance.collection('users').doc(current.uid);
      var snapshot=await ref.get().timeout(const Duration(seconds:10));
      if(!snapshot.exists){
        await FirebaseService().createUserProfile(current.uid,{
          'email':current.email??'',
          'setupStep':'profile',
          'setupComplete':false,
        }).timeout(const Duration(seconds:12));
        snapshot=await ref.get().timeout(const Duration(seconds:10));
      }
      destination=setupDestination(snapshot.data());
    }catch(_){
      destination=AppRoutes.profileSetup;
    }
    if(!mounted)return;
    Navigator.of(context).pushNamedAndRemoveUntil(destination,(_)=>false);
  }

  Future<void> _changeAccount()async{
    if(_busy)return;
    setState(()=>_busy=true);
    try{
      await FirebaseAuth.instance.signOut();
      if(!mounted)return;
      Navigator.of(context).pushNamedAndRemoveUntil(AppRoutes.emailLogin,(_)=>false);
    }finally{
      if(mounted)setState(()=>_busy=false);
    }
  }

  void _message(String message){
    if(!mounted)return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(message)));
  }

  @override
  Widget build(BuildContext context){
    final email=user?.email??'بريدك الإلكتروني';
    return PopScope(
      canPop:false,
      child:Scaffold(
        backgroundColor:const Color(0xFF020711),
        body:Container(
          width:double.infinity,
          height:double.infinity,
          decoration:const BoxDecoration(
            gradient:RadialGradient(
              center:Alignment(.65,-.45),
              radius:1.15,
              colors:[Color(0xFF251044),Color(0xFF07111F),Color(0xFF020711)],
            ),
          ),
          child:SafeArea(
            child:Directionality(
              textDirection:TextDirection.rtl,
              child:SingleChildScrollView(
                padding:const EdgeInsets.fromLTRB(24,46,24,32),
                child:Column(
                  crossAxisAlignment:CrossAxisAlignment.stretch,
                  children:[
                    Container(
                      width:92,
                      height:92,
                      margin:const EdgeInsets.symmetric(horizontal:100),
                      decoration:BoxDecoration(
                        shape:BoxShape.circle,
                        color:const Color(0xFFFFD54A).withValues(alpha:.10),
                        border:Border.all(color:const Color(0xFFFFD54A).withValues(alpha:.45)),
                      ),
                      child:const Icon(Icons.mark_email_unread_outlined,color:Color(0xFFFFD54A),size:45),
                    ),
                    const SizedBox(height:28),
                    const Text(
                      'تأكيد البريد الإلكتروني',
                      textAlign:TextAlign.center,
                      style:TextStyle(color:Colors.white,fontSize:28,fontWeight:FontWeight.w900),
                    ),
                    const SizedBox(height:12),
                    Text(
                      'أرسلنا رسالة تحقق إلى\n$email',
                      textAlign:TextAlign.center,
                      textDirection:TextDirection.rtl,
                      style:const TextStyle(color:Colors.white70,fontSize:16,height:1.7),
                    ),
                    const SizedBox(height:10),
                    const Text(
                      'لن يتم تفعيل حساب البريد داخل Shadow Live قبل إثبات ملكية هذا البريد.',
                      textAlign:TextAlign.center,
                      style:TextStyle(color:Colors.white54,fontSize:14,height:1.6),
                    ),
                    const SizedBox(height:34),
                    SizedBox(
                      height:56,
                      child:FilledButton.icon(
                        onPressed:_busy?null:_check,
                        icon:_busy
                            ?const SizedBox(width:20,height:20,child:CircularProgressIndicator(strokeWidth:2,color:Colors.white))
                            :const Icon(Icons.verified_outlined),
                        label:const Text('تحققت من البريد — افحص الآن',style:TextStyle(fontWeight:FontWeight.w800)),
                      ),
                    ),
                    const SizedBox(height:12),
                    OutlinedButton.icon(
                      onPressed:_busy||_cooldown>0?null:_resend,
                      icon:const Icon(Icons.refresh_rounded),
                      label:Text(_cooldown>0?'إعادة الإرسال بعد $_cooldown ثانية':'إعادة إرسال رسالة التحقق'),
                    ),
                    const SizedBox(height:8),
                    TextButton(
                      onPressed:_busy?null:_changeAccount,
                      child:const Text('البريد غير صحيح؟ استخدم حسابًا آخر',style:TextStyle(color:Color(0xFFFFD54A))),
                    ),
                    const SizedBox(height:18),
                    const Text(
                      'إذا لم تجد الرسالة، افحص مجلد Spam / الرسائل غير المرغوب فيها.',
                      textAlign:TextAlign.center,
                      style:TextStyle(color:Colors.white38,fontSize:12),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
