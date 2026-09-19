import 'package:cloud_firestore/cloud_firestore.dart';

class AdminAuditEntry {
 const AdminAuditEntry({required this.id,required this.actorUid,required this.action,required this.targetType,required this.targetId,this.reason,this.createdAt});
 final String id,actorUid,action,targetType,targetId; final String? reason; final DateTime? createdAt;
 factory AdminAuditEntry.fromDoc(DocumentSnapshot<Map<String,dynamic>> d){final x=d.data()??{};return AdminAuditEntry(id:d.id,actorUid:'${x['actorUid']??''}',action:'${x['action']??''}',targetType:'${x['targetType']??''}',targetId:'${x['targetId']??''}',reason:x['reason']?.toString(),createdAt:(x['createdAt'] as Timestamp?)?.toDate());}
}
class FinancialLedgerEntry {
 const FinancialLedgerEntry({required this.id,required this.userId,required this.asset,required this.delta,required this.reason});
 final String id,userId,asset,reason; final num delta;
 factory FinancialLedgerEntry.fromDoc(DocumentSnapshot<Map<String,dynamic>> d){final x=d.data()??{};return FinancialLedgerEntry(id:d.id,userId:'${x['userId']??''}',asset:'${x['asset']??''}',delta:(x['delta'] as num?)??0,reason:'${x['reason']??''}');}
}
