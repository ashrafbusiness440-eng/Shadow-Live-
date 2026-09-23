import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_error_message.dart';
import 'package:voice_chat_room/admin/control_operation_codes.dart';
void main(){
 test('critical server errors have Arabic UI messages',(){
  expect(ControlErrorMessage.arabic(ControlOperationCodes.ownerProtected),contains('المالك'));
  expect(ControlErrorMessage.arabic(ControlOperationCodes.emergencyLocked),contains('الطوارئ'));
  expect(ControlErrorMessage.arabic(ControlOperationCodes.insufficientBalance),contains('الرصيد'));
 });
}
