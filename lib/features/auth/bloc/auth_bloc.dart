import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import '../../../shared/services/firebase_service.dart';
import '../../../shared/services/storage_service.dart';

abstract class AuthEvent {}
class AuthCheckRequested extends AuthEvent {}
class SignInRequested extends AuthEvent {final String email;final String password;SignInRequested(this.email,this.password);}
class SignUpRequested extends AuthEvent {final String email;final String password;final Map<String,dynamic> userData;SignUpRequested(this.email,this.password,this.userData);}
class PhoneAuthRequested extends AuthEvent {final String phoneNumber;PhoneAuthRequested(this.phoneNumber);}
class PhoneCodeSubmitted extends AuthEvent {final String verificationId;final String smsCode;PhoneCodeSubmitted(this.verificationId,this.smsCode);}
class GoogleSignInRequested extends AuthEvent {}
class AppleSignInRequested extends AuthEvent {}
class GuestSignInRequested extends AuthEvent {}
class SignOutRequested extends AuthEvent {}
class _PhoneVerificationCompleted extends AuthEvent {final PhoneAuthCredential credential;final String phoneNumber;_PhoneVerificationCompleted(this.credential,this.phoneNumber);}
class _PhoneVerificationFailed extends AuthEvent {final FirebaseAuthException error;_PhoneVerificationFailed(this.error);}
class _PhoneCodeDispatched extends AuthEvent {final String verificationId;_PhoneCodeDispatched(this.verificationId);}

abstract class AuthState {}
class AuthInitial extends AuthState {}
class AuthLoading extends AuthState {}
class Authenticated extends AuthState {final User user;final Map<String,dynamic>? userData;Authenticated(this.user,this.userData);}
class PhoneCodeSent extends AuthState {final String verificationId;PhoneCodeSent(this.verificationId);}
class EmailVerificationRequired extends AuthState {final User user;EmailVerificationRequired(this.user);}
class Unauthenticated extends AuthState {}
class AuthError extends AuthState {final String message;AuthError(this.message);}

class AuthBloc extends Bloc<AuthEvent,AuthState>{
 final FirebaseService _firebaseService;final StorageService _storageService;ConfirmationResult? _webConfirmationResult;
 AuthBloc(this._firebaseService,this._storageService):super(AuthInitial()){
  on<AuthCheckRequested>(_onAuthCheckRequested);on<SignInRequested>(_onSignInRequested);on<SignUpRequested>(_onSignUpRequested);on<PhoneAuthRequested>(_onPhoneAuthRequested);on<PhoneCodeSubmitted>(_onPhoneCodeSubmitted);on<GoogleSignInRequested>(_onGoogleSignInRequested);on<AppleSignInRequested>(_onAppleSignInRequested);on<GuestSignInRequested>(_onGuestSignInRequested);on<SignOutRequested>(_onSignOutRequested);on<_PhoneVerificationCompleted>(_onPhoneVerificationCompleted);on<_PhoneVerificationFailed>(_onPhoneVerificationFailed);on<_PhoneCodeDispatched>(_onPhoneCodeDispatched);
 }

 bool _needsEmailVerification(User user)=>!user.isAnonymous&&user.providerData.any((p)=>p.providerId=='password')&&!user.emailVerified;
 Future<void> _sendVerification(User user)async{if(_needsEmailVerification(user))await user.sendEmailVerification();}

 Map<String,dynamic> _safeProfileSeed(Map<String,dynamic> source){
  const allowed={'displayName','username','bio','gender','birthDate','country','location','profileImage','avatarUrl','coverImage','interests','email','phone'};
  return Map.fromEntries(source.entries.where((e)=>allowed.contains(e.key)));
 }

 Future<Map<String,dynamic>> _profile(User user,{Map<String,dynamic> seed=const {}})async{
  final safeSeed=_safeProfileSeed(seed);
  var data=await _firebaseService.getUserProfile(user.uid);
  if(data==null){
   await _firebaseService.createUserProfile(user.uid,{
    ...safeSeed,'uid':user.uid,'email':user.email??safeSeed['email']??'','phone':user.phoneNumber??safeSeed['phone']??'','displayName':user.displayName??safeSeed['displayName']??'','setupStep':'profile','setupComplete':false,
   });
   data=await _firebaseService.getUserProfile(user.uid)??{};
  }else if(data['setupStep']==null||data['setupComplete']==null){
   final patch=<String,dynamic>{};
   if(data['setupStep']==null)patch['setupStep']='profile';
   if(data['setupComplete']==null)patch['setupComplete']=false;
   await _firebaseService.updateUserProfile(user.uid,patch);
   data={...data,...patch};
  }
  await _firebaseService.touchLastLogin(user.uid);
  data={...data,'isOnline':true};
  await _storageService.saveUser(data);
  return data;
 }
 Future<void> _emitUser(User user,Emitter<AuthState> emit,{Map<String,dynamic> seed=const {}})async{final data=await _profile(user,seed:seed);emit(Authenticated(user,data));}

 Future<void> _onAuthCheckRequested(AuthCheckRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final user=FirebaseAuth.instance.currentUser;if(user==null){emit(Unauthenticated());return;}if(user.isAnonymous){emit(Authenticated(user,{'uid':user.uid,'username':'ضيف','role':'guest','isGuest':true,'coins':0,'diamonds':0}));return;}await user.reload();final current=FirebaseAuth.instance.currentUser??user;if(_needsEmailVerification(current)){emit(EmailVerificationRequired(current));return;}await _emitUser(current,emit);}catch(e){emit(AuthError(e.toString()));}}

 Future<UserCredential> _providerCredential(AuthProvider provider)async{return kIsWeb?FirebaseAuth.instance.signInWithPopup(provider):FirebaseAuth.instance.signInWithProvider(provider);}
 Future<void> _onAppleSignInRequested(AppleSignInRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final p=OAuthProvider('apple.com')..addScope('email')..addScope('name');final c=await _providerCredential(p);final u=c.user;if(u==null){emit(Unauthenticated());return;}await _emitUser(u,emit);}on FirebaseAuthException catch(e){if(e.code=='popup-closed-by-user'||e.code=='cancelled-popup-request'){emit(Unauthenticated());}else{emit(AuthError('Apple: ${e.message??e.code}'));}}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onGoogleSignInRequested(GoogleSignInRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final p=GoogleAuthProvider()..setCustomParameters({'prompt':'select_account'});final c=await _providerCredential(p);final u=c.user;if(u==null){emit(Unauthenticated());return;}await _emitUser(u,emit);}on FirebaseAuthException catch(e){if(e.code=='popup-closed-by-user'||e.code=='cancelled-popup-request'){emit(Unauthenticated());}else{emit(AuthError('Google: ${e.message??e.code}'));}}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onSignInRequested(SignInRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final c=await _firebaseService.signInWithEmail(event.email,event.password);final u=c.user;if(u==null){emit(Unauthenticated());return;}await u.reload();final current=FirebaseAuth.instance.currentUser??u;if(_needsEmailVerification(current)){emit(EmailVerificationRequired(current));return;}await _emitUser(current,emit,seed:{'email':event.email});}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onSignUpRequested(SignUpRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final c=await _firebaseService.signUpWithEmail(event.email,event.password);final u=c.user;if(u==null){emit(Unauthenticated());return;}try{await _sendVerification(u);}catch(_){}emit(EmailVerificationRequired(u));}catch(e){emit(AuthError(e.toString()));}}

 Future<void> _onPhoneAuthRequested(PhoneAuthRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{if(kIsWeb){_webConfirmationResult=await FirebaseAuth.instance.signInWithPhoneNumber(event.phoneNumber);emit(PhoneCodeSent('web'));return;}await _firebaseService.verifyPhoneNumber(phoneNumber:event.phoneNumber,verificationCompleted:(credential)=>add(_PhoneVerificationCompleted(credential,event.phoneNumber)),verificationFailed:(error)=>add(_PhoneVerificationFailed(error)),codeSent:(id,_)=>add(_PhoneCodeDispatched(id)),codeAutoRetrievalTimeout:(id)=>add(_PhoneCodeDispatched(id)));}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onPhoneVerificationCompleted(_PhoneVerificationCompleted event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final c=await FirebaseAuth.instance.signInWithCredential(event.credential);final u=c.user;if(u==null){emit(Unauthenticated());return;}await _emitUser(u,emit,seed:{'phone':event.phoneNumber});}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onPhoneVerificationFailed(_PhoneVerificationFailed event,Emitter<AuthState> emit)async{emit(AuthError(event.error.message??event.error.code));}
 Future<void> _onPhoneCodeDispatched(_PhoneCodeDispatched event,Emitter<AuthState> emit)async{if(state is! Authenticated)emit(PhoneCodeSent(event.verificationId));}
 Future<void> _onPhoneCodeSubmitted(PhoneCodeSubmitted event,Emitter<AuthState> emit)async{emit(AuthLoading());try{late UserCredential c;if(kIsWeb){final result=_webConfirmationResult;if(result==null){emit(AuthError('انتهت جلسة التحقق، أعد إرسال الرمز'));return;}c=await result.confirm(event.smsCode);}else{c=await _firebaseService.signInWithPhoneCode(verificationId:event.verificationId,smsCode:event.smsCode);}final u=c.user;if(u==null){emit(Unauthenticated());return;}await _emitUser(u,emit);}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onGuestSignInRequested(GuestSignInRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final c=await _firebaseService.signInAnonymously();final u=c.user;if(u==null){emit(AuthError('تعذر إنشاء جلسة الضيف'));return;}emit(Authenticated(u,{'uid':u.uid,'username':'ضيف','role':'guest','coins':0,'diamonds':0,'balance':0,'vipLevel':0,'isOnline':true,'isGuest':true}));}catch(e){emit(AuthError(e.toString()));}}
 Future<void> _onSignOutRequested(SignOutRequested event,Emitter<AuthState> emit)async{emit(AuthLoading());try{final user=FirebaseAuth.instance.currentUser;if(user!=null&&!user.isAnonymous){try{await _firebaseService.updateUserProfile(user.uid,{'isOnline':false}).timeout(const Duration(seconds:8));}catch(_){}}await _firebaseService.signOut();await _storageService.removeUser();await _storageService.removeToken();_webConfirmationResult=null;emit(Unauthenticated());}catch(e){emit(AuthError(e.toString()));}}
}
