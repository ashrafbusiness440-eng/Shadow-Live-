import 'dart:typed_data';
import 'dart:math';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';

class FirebaseService {
  final FirebaseAuth _auth=FirebaseAuth.instance;final FirebaseFirestore _firestore=FirebaseFirestore.instance;final FirebaseStorage _storage=FirebaseStorage.instance;
  Future<UserCredential> signInWithEmail(String email,String password)async{try{return await _auth.signInWithEmailAndPassword(email:email,password:password);}catch(e){throw _handleAuthError(e);}}
  Future<UserCredential> signUpWithEmail(String email,String password)async{try{return await _auth.createUserWithEmailAndPassword(email:email,password:password);}catch(e){throw _handleAuthError(e);}}
  Future<void> verifyPhoneNumber({required String phoneNumber,required void Function(PhoneAuthCredential credential) verificationCompleted,required void Function(FirebaseAuthException error) verificationFailed,required void Function(String verificationId,int? resendToken) codeSent,required void Function(String verificationId) codeAutoRetrievalTimeout})async{await _auth.verifyPhoneNumber(phoneNumber:phoneNumber,verificationCompleted:verificationCompleted,verificationFailed:verificationFailed,codeSent:codeSent,codeAutoRetrievalTimeout:codeAutoRetrievalTimeout);}
  Future<UserCredential> signInWithPhoneCode({required String verificationId,required String smsCode})async=>_auth.signInWithCredential(PhoneAuthProvider.credential(verificationId:verificationId,smsCode:smsCode));
  Future<UserCredential> signInAnonymously()async{try{return await _auth.signInAnonymously();}catch(e){throw _handleAuthError(e);}}
  Future<void> signOut()=>_auth.signOut();
  Future<void> resetPassword(String email)async{try{await _auth.sendPasswordResetEmail(email:email);}catch(e){throw _handleAuthError(e);}}

  Future<String> _ensurePublicId(String userId) async {
    final userRef=_firestore.collection('users').doc(userId);
    final existing=await userRef.get();final current=existing.data()?['publicId']?.toString();if(current!=null&&current.isNotEmpty)return current;
    final random=Random.secure();
    for(var attempt=0;attempt<12;attempt++){
      final id=(10000000+random.nextInt(90000000)).toString();final idRef=_firestore.collection('public_ids').doc(id);
      try{return await _firestore.runTransaction<String>((tx)async{final userSnap=await tx.get(userRef);final already=userSnap.data()?['publicId']?.toString();if(already!=null&&already.isNotEmpty)return already;final idSnap=await tx.get(idRef);if(idSnap.exists)throw StateError('collision');tx.set(idRef,{'uid':userId,'createdAt':FieldValue.serverTimestamp()});tx.set(userRef,{'publicId':id},SetOptions(merge:true));return id;});}catch(e){if(e is StateError)continue;rethrow;}
    }
    throw Exception('تعذر إنشاء ID فريد');
  }

  Future<void> createUserProfile(String userId,Map<String,dynamic> data)async{try{await _firestore.collection('users').doc(userId).set(data,SetOptions(merge:true));await _ensurePublicId(userId);}catch(e){throw Exception('Failed to create user profile: $e');}}
  Future<Map<String,dynamic>?> getUserProfile(String userId)async{try{final doc=await _firestore.collection('users').doc(userId).get();if(!doc.exists)return null;final data=doc.data();if(data!=null&&(data['publicId']==null||data['publicId'].toString().isEmpty)){data['publicId']=await _ensurePublicId(userId);}return data;}catch(e){throw Exception('Failed to get user profile: $e');}}
  Future<void> updateUserProfile(String userId,Map<String,dynamic> data)async{try{await _firestore.collection('users').doc(userId).set(data,SetOptions(merge:true));}catch(e){throw Exception('Failed to update user profile: $e');}}
  Future<String> createRoom(Map<String,dynamic> roomData)async{try{return (await _firestore.collection('rooms').add(roomData)).id;}catch(e){throw Exception('Failed to create room: $e');}}
  Stream<QuerySnapshot> getRooms()=>_firestore.collection('rooms').where('isActive',isEqualTo:true).orderBy('createdAt',descending:true).snapshots();
  Future<void> updateRoom(String roomId,Map<String,dynamic> data)async{try{await _firestore.collection('rooms').doc(roomId).update(data);}catch(e){throw Exception('Failed to update room: $e');}}
  Future<String> uploadFile(String path,List<int> data)async{try{final ref=_storage.ref().child(path);await ref.putData(Uint8List.fromList(data));return ref.getDownloadURL();}catch(e){throw Exception('Failed to upload file: $e');}}
  Future<void> deleteFile(String path)async{try{await _storage.ref().child(path).delete();}catch(e){throw Exception('Failed to delete file: $e');}}
  Exception _handleAuthError(dynamic e){if(e is FirebaseAuthException){switch(e.code){case'user-not-found':return Exception('No user found with this email');case'wrong-password':return Exception('Wrong password');case'email-already-in-use':return Exception('Email is already registered');case'invalid-email':return Exception('Invalid email address');case'weak-password':return Exception('Password is too weak');default:return Exception('Authentication failed: ${e.message}');}}return Exception('Authentication failed: $e');}
  CollectionReference<Map<String,dynamic>> getCollection(String path)=>_firestore.collection(path);
}
