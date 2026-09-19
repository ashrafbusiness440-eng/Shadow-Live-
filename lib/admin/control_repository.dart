import 'package:cloud_firestore/cloud_firestore.dart';
import 'control_access.dart';

class ControlRepository {
  ControlRepository({FirebaseFirestore? firestore}):_db=firestore??FirebaseFirestore.instance;
  final FirebaseFirestore _db;

  Future<ControlAccess?> loadAccess(String uid) async {
    final snap=await _db.collection('users').doc(uid).get();
    if(!snap.exists)return null;
    return ControlAccess.fromMap(uid,snap.data()??{});
  }

  Future<void> writeAudit({
    required String actorUid,required String action,required String targetType,
    required String targetId,String? reason,Map<String,dynamic>? before,Map<String,dynamic>? after,
  })=>_db.collection('admin_audit_logs').add({
    'actorUid':actorUid,'action':action,'targetType':targetType,'targetId':targetId,
    'reason':reason,'before':before,'after':after,'createdAt':FieldValue.serverTimestamp(),
  });

  Stream<QuerySnapshot<Map<String,dynamic>>> users({int limit=50})=>
      _db.collection('users').limit(limit).snapshots();
  Stream<QuerySnapshot<Map<String,dynamic>>> rooms({int limit=50})=>
      _db.collection('rooms').limit(limit).snapshots();
  Stream<QuerySnapshot<Map<String,dynamic>>> reports({int limit=50})=>
      _db.collection('reports').orderBy('createdAt',descending:true).limit(limit).snapshots();
}
