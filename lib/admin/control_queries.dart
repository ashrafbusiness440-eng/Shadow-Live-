import 'package:cloud_firestore/cloud_firestore.dart';
class ControlQueries {
 ControlQueries({FirebaseFirestore? firestore}):_db=firestore??FirebaseFirestore.instance;
 final FirebaseFirestore _db;
 Future<QuerySnapshot<Map<String,dynamic>>> findUserByPublicId(String id)=>_db.collection('users').where('publicId',isEqualTo:id).limit(20).get();
 Future<QuerySnapshot<Map<String,dynamic>>> findRoomByPublicId(String id)=>_db.collection('rooms').where('publicId',isEqualTo:id).limit(20).get();
 Stream<QuerySnapshot<Map<String,dynamic>>> agencies({int limit=50})=>_db.collection('agencies').limit(limit).snapshots();
 Stream<QuerySnapshot<Map<String,dynamic>>> withdrawals({int limit=50})=>_db.collection('withdrawal_requests').orderBy('createdAt',descending:true).limit(limit).snapshots();
 Stream<QuerySnapshot<Map<String,dynamic>>> settlements({int limit=50})=>_db.collection('agency_settlements').orderBy('createdAt',descending:true).limit(limit).snapshots();
 Stream<QuerySnapshot<Map<String,dynamic>>> audit({int limit=100})=>_db.collection('admin_audit_logs').orderBy('createdAt',descending:true).limit(limit).snapshots();
 Stream<QuerySnapshot<Map<String,dynamic>>> ledger({int limit=100})=>_db.collection('financial_ledger').orderBy('createdAt',descending:true).limit(limit).snapshots();
}
