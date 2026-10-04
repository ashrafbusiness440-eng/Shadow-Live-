import 'dart:math';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import '../../utils/search_index.dart';

String generateDefaultUserPublicId(Random random) =>
    (10000000 + random.nextInt(90000000)).toString();

bool needsInitialUserPublicIdRepair(Map<String, dynamic>? data) {
  if (data == null) return false;
  final current = (data['publicId'] ?? '').toString().trim();
  if (!RegExp(r'^\d{3,7}$').hasMatch(current)) return false;
  if (data['setupComplete'] == true) return false;
  final updatedBy = (data['publicIdUpdatedBy'] ?? '').toString().trim();
  return updatedBy.isEmpty;
}

class FirebaseService {
 final FirebaseAuth _auth=FirebaseAuth.instance;final FirebaseFirestore _firestore=FirebaseFirestore.instance;
 Future<UserCredential> signInWithEmail(String email,String password)async{try{return await _auth.signInWithEmailAndPassword(email:email.trim(),password:password);}catch(e){throw _handleAuthError(e);}}
 Future<UserCredential> signUpWithEmail(String email,String password)async{try{return await _auth.createUserWithEmailAndPassword(email:email.trim(),password:password);}catch(e){throw _handleAuthError(e);}}
 Future<void> verifyPhoneNumber({required String phoneNumber,required void Function(PhoneAuthCredential credential) verificationCompleted,required void Function(FirebaseAuthException error) verificationFailed,required void Function(String verificationId,int? resendToken) codeSent,required void Function(String verificationId) codeAutoRetrievalTimeout})async{await _auth.verifyPhoneNumber(phoneNumber:phoneNumber,verificationCompleted:verificationCompleted,verificationFailed:verificationFailed,codeSent:codeSent,codeAutoRetrievalTimeout:codeAutoRetrievalTimeout);}
 Future<UserCredential> signInWithPhoneCode({required String verificationId,required String smsCode})async=>_auth.signInWithCredential(PhoneAuthProvider.credential(verificationId:verificationId,smsCode:smsCode));
 Future<UserCredential> signInAnonymously()async{try{return await _auth.signInAnonymously();}catch(e){throw _handleAuthError(e);}}
 Future<void> signOut()=>_auth.signOut();Future<void> resetPassword(String email)async{try{await _auth.setLanguageCode('ar');await _auth.sendPasswordResetEmail(email:email.trim());}catch(e){throw _handleAuthError(e);}}
 Future<void> touchLastLogin(String userId)=>updateUserProfile(userId,{'lastLoginAt':FieldValue.serverTimestamp(),'isOnline':true});

 Map<String,dynamic> _publicProfileData(String userId,Map<String,dynamic> data){
  final displayName=(data['displayName']??data['name']??'').toString();
  final username=(data['username']??'').toString();
  final publicId=(data['publicId']??'').toString();
  return {
   'uid':userId,
   'displayName':displayName,
   'username':username,
   'publicId':publicId,
   'searchTokens':buildSearchTokens([displayName,username,publicId]),
   'profileImageUrl':data['profileImageUrl']??data['photoUrl']??data['avatarUrl']??'',
   'profileImageObjectId':data['profileImageObjectId']??'',
   'profileAvatarAsset':data['profileAvatarAsset']??'',
   'coverImageUrl':data['coverImageUrl']??'',
   'coverImageObjectId':data['coverImageObjectId']??'',
   'bio':data['bio']??'',
   'location':data['location']??'',
   'moodEmoji':data['moodEmoji']??'',
   'moodText':data['moodText']??'',
   'interests':data['interests'] is List ? data['interests'] : const [],
   'vipLevel':data['effectiveVipLevel']??0,
   'effectiveVipLevel':data['effectiveVipLevel']??0,
   'vipExpiresAt':data['vipExpiresAt'],
   'badges':data['publicBadges'] is List ? data['publicBadges'] : const [],
   'isOnline':data['isOnline']??false,
  };
 }

 Future<void> _syncPublicProfile(String userId)async{
  final user=await _firestore.collection('users').doc(userId).get();
  if(!user.exists)return;
  final data=user.data()??<String,dynamic>{};
  await _firestore.collection('public_profiles').doc(userId).set({
   ..._publicProfileData(userId,data),
   'createdAt':data['createdAt']??FieldValue.serverTimestamp(),
   'updatedAt':FieldValue.serverTimestamp(),
  });
 }

 Future<String> ensurePublicId(String userId)async{
  final userRef=_firestore.collection('users').doc(userId);
  final existing=await userRef.get();
  final existingData=existing.data();
  final current=(existingData?['publicId']??'').toString().trim();
  if(current.isNotEmpty&&!needsInitialUserPublicIdRepair(existingData)){
   await _syncPublicProfile(userId);
   return current;
  }
  final random=Random.secure();
  for(var attempt=0;attempt<16;attempt++){
   final id=generateDefaultUserPublicId(random);
   final idRef=_firestore.collection('public_ids').doc(id);
   try{
    final result=await _firestore.runTransaction<String>((tx)async{
     final userSnap=await tx.get(userRef);
     final userData=userSnap.data();
     final already=(userData?['publicId']??'').toString().trim();
     final repair=needsInitialUserPublicIdRepair(userData);
     if(already.isNotEmpty&&!repair)return already;

     final roomIdRef=_firestore.collection('room_ids').doc(id);
     final oldIdRef=repair?_firestore.collection('public_ids').doc(already):null;
     final idSnap=await tx.get(idRef);
     final roomIdSnap=await tx.get(roomIdRef);
     final oldIdSnap=oldIdRef==null?null:await tx.get(oldIdRef);
     if(idSnap.exists||roomIdSnap.exists)throw StateError('collision');

     tx.set(idRef,{
      'uid':userId,
      'createdAt':FieldValue.serverTimestamp(),
     });
     tx.set(userRef,{
      'publicId':id,
      'updatedAt':FieldValue.serverTimestamp(),
     },SetOptions(merge:true));
     if(oldIdRef!=null&&oldIdSnap!.exists){
      tx.update(oldIdRef,{
       'reserved':true,
       'currentPublicId':id,
       'retiredAt':FieldValue.serverTimestamp(),
      });
     }
     return id;
    });
    await _syncPublicProfile(userId);
    return result;
   }catch(e){if(e is StateError)continue;rethrow;}
  }
  throw Exception('تعذر إنشاء ID فريد');
 }
 Map<String,dynamic> _profileDefaults(String userId)=>{'uid':userId,'role':'user','coins':0,'diamonds':0,'balance':0,'vipLevel':0,'isOnline':true,'setupStep':'profile','setupComplete':false};
 Future<void> createUserProfile(String userId,Map<String,dynamic> data)async{try{final ref=_firestore.collection('users').doc(userId);final snap=await ref.get();if(!snap.exists){await ref.set({..._profileDefaults(userId),...data,'createdAt':FieldValue.serverTimestamp(),'updatedAt':FieldValue.serverTimestamp()});}else{await ref.set({...data,'updatedAt':FieldValue.serverTimestamp()},SetOptions(merge:true));}await ensurePublicId(userId);await _syncPublicProfile(userId);}catch(e){throw Exception('Failed to create user profile: $e');}}
 Future<Map<String,dynamic>?> getUserProfile(String userId)async{try{final doc=await _firestore.collection('users').doc(userId).get();if(!doc.exists)return null;final data=doc.data();if(data!=null&&((data['publicId']==null||data['publicId'].toString().isEmpty)||needsInitialUserPublicIdRepair(data)))data['publicId']=await ensurePublicId(userId);return data;}catch(e){throw Exception('Failed to get user profile: $e');}}
 Future<void> updateUserProfile(String userId,Map<String,dynamic> data)async{try{await _firestore.collection('users').doc(userId).set({...data,'updatedAt':FieldValue.serverTimestamp()},SetOptions(merge:true));await _syncPublicProfile(userId);}catch(e){throw Exception('Failed to update user profile: $e');}}
 Future<void> updateSetupStep(String userId,String step,{bool complete=false})=>updateUserProfile(userId,{'setupStep':step,'setupComplete':complete});
 Map<String,dynamic> _roomSearchData(Map<String,dynamic> roomData){
  final name=(roomData['name']??roomData['title']??'').toString();
  final publicId=(roomData['publicId']??'').toString();
  return {...roomData,'searchTokens':buildSearchTokens([name,publicId])};
 }
 Future<String> createRoom(Map<String,dynamic> roomData)async{try{return(await _firestore.collection('rooms').add(_roomSearchData(roomData))).id;}catch(e){throw Exception('Failed to create room: $e');}}
 Stream<QuerySnapshot> getRooms()=>_firestore.collection('rooms').where('isActive',isEqualTo:true).orderBy('createdAt',descending:true).snapshots();Future<void> updateRoom(String roomId,Map<String,dynamic> data)async{try{final payload=(data.containsKey('name')||data.containsKey('title'))?_roomSearchData(data):data;await _firestore.collection('rooms').doc(roomId).update(payload);}catch(e){throw Exception('Failed to update room: $e');}}
 Exception _handleAuthError(dynamic e){if(e is FirebaseAuthException){switch(e.code){case'user-not-found':return Exception('لا يوجد حساب بهذا البريد');case'wrong-password':case'invalid-credential':return Exception('بيانات تسجيل الدخول غير صحيحة');case'email-already-in-use':return Exception('البريد مستخدم بالفعل');case'invalid-email':return Exception('البريد الإلكتروني غير صالح');case'weak-password':return Exception('كلمة المرور ضعيفة');case'too-many-requests':return Exception('محاولات كثيرة، حاول لاحقاً');case'network-request-failed':return Exception('تحقق من اتصال الإنترنت');default:return Exception(e.message??'فشل تسجيل الدخول');}}return Exception('فشل تسجيل الدخول: $e');}
 CollectionReference<Map<String,dynamic>> getCollection(String path)=>_firestore.collection(path);
}
