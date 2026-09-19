import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_backend_status.dart';
void main(){
 test('demo backend is never privileged ready',(){const s=ControlBackendStatus(reachable:true,environment:'demo',version:'1',financialWritesEnabled:true,roleMutationsEnabled:true);expect(s.privilegedReady,isFalse);});
 test('production requires both protected write capabilities',(){const s=ControlBackendStatus(reachable:true,environment:'production',version:'1',financialWritesEnabled:true,roleMutationsEnabled:false);expect(s.privilegedReady,isFalse);});
}
