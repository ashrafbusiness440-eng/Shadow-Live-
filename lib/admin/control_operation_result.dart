class ControlOperationResult {
 const ControlOperationResult._({required this.ok,required this.code,this.message});
 final bool ok; final String code; final String? message;
 const ControlOperationResult.success([String code='ok']):this._(ok:true,code:code);
 const ControlOperationResult.failure(String code,[String? message]):this._(ok:false,code:code,message:message);
}
