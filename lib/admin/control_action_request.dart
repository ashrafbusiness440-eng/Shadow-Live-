class ControlActionRequest {
 const ControlActionRequest({required this.action,required this.targetType,required this.targetId,required this.reason,this.payload=const {}});
 final String action,targetType,targetId,reason; final Map<String,dynamic> payload;
 Map<String,dynamic> toJson()=>{'action':action,'targetType':targetType,'targetId':targetId,'reason':reason,'payload':payload};
 void validate(){
  if(action.trim().isEmpty||targetType.trim().isEmpty||targetId.trim().isEmpty)throw ArgumentError('بيانات الإجراء غير مكتملة');
  if(reason.trim().length<3)throw ArgumentError('يجب إدخال سبب واضح');
 }
}
