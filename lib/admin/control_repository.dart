import 'package:cloud_firestore/cloud_firestore.dart';
import 'control_access.dart';
import 'control_firebase.dart';

class ControlRepository {
  ControlRepository({FirebaseFirestore? firestore}):_db=firestore??controlFirestore;
  final FirebaseFirestore _db;

  Future<ControlAccess?> loadAccess(String uid) async {
    final snap=await _db.collection('users').doc(uid).get();
    if(!snap.exists)return null;
    return ControlAccess.fromMap(uid,snap.data()??{});
  }


  Stream<QuerySnapshot<Map<String,dynamic>>> users({int limit=50})=>
      _db.collection('users').limit(limit).snapshots();
  Stream<QuerySnapshot<Map<String,dynamic>>> rooms({int limit=50})=>
      _db.collection('rooms').limit(limit).snapshots();
  Stream<QuerySnapshot<Map<String,dynamic>>> reports({int limit=50})=>
      _db.collection('reports').orderBy('createdAt',descending:true).limit(limit).snapshots();
}
