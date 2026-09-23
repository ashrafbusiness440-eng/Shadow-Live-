class TrustedServerRequest {
 const TrustedServerRequest({required this.action,required this.targetId,required this.reason,required this.clientRequestId,this.payload=const {}});
 final String action,targetId,reason,clientRequestId; final Map<String,dynamic> payload;
 Map<String,dynamic> toJson()=>{'action':action,'targetId':targetId,'reason':reason,'clientRequestId':clientRequestId,'payload':payload};
}
class TrustedServerResponse {
 const TrustedServerResponse({required this.ok,required this.code,this.operationId,this.message});
 final bool ok; final String code; final String? operationId,message;
 factory TrustedServerResponse.fromJson(Map<String,dynamic> x)=>TrustedServerResponse(ok:x['ok']==true,code:'${x['code']??'unknown'}',operationId:x['operationId']?.toString(),message:x['message']?.toString());
}
