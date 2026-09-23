import 'control_operation_codes.dart';
abstract final class ControlErrorMessage {
 static String arabic(String code)=>switch(code){
  ControlOperationCodes.denied=>'ليس لديك صلاحية لتنفيذ هذا الإجراء',
  ControlOperationCodes.ownerProtected=>'حساب المالك محمي',
  ControlOperationCodes.reauthRequired=>'يلزم إعادة التحقق قبل تنفيذ العملية',
  ControlOperationCodes.emergencyLocked=>'العمليات الحساسة متوقفة بواسطة قفل الطوارئ',
  ControlOperationCodes.duplicate=>'تم استلام هذه العملية مسبقًا',
  ControlOperationCodes.invalidAmount=>'المبلغ غير صالح',
  ControlOperationCodes.insufficientBalance=>'الرصيد المتاح غير كافٍ',
  ControlOperationCodes.invalidTransition=>'لا يمكن الانتقال إلى هذه الحالة',
  ControlOperationCodes.backendRequired=>'الخادم الموثوق غير جاهز بعد',
  _=>'تعذر إكمال العملية',
 };
}
