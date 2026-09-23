import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_action_catalog.dart';
import 'package:voice_chat_room/admin/control_action_request.dart';
import 'package:voice_chat_room/admin/control_request_validator.dart';
void main(){
 test('financial actions are marked sensitive',(){final a=ControlActionCatalog.get('adjustBalance');expect(a.financial,isTrue);expect(a.sensitive,isTrue);});
 test('financial request requires idempotency key',(){const r=ControlActionRequest(action:'adjustBalance',targetType:'user',targetId:'u',reason:'manual correction');expect(()=>ControlRequestValidator.validate(r),throwsArgumentError);});
 test('financial request with idempotency key passes contract validation',(){const r=ControlActionRequest(action:'adjustBalance',targetType:'user',targetId:'u',reason:'manual correction',payload:{'idempotencyKey':'abc'});expect(()=>ControlRequestValidator.validate(r),returnsNormally);});
}
