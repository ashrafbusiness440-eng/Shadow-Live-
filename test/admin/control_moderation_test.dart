import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_moderation.dart';
void main(){
 test('temporary moderation needs duration',(){expect(()=>ModerationAction.validate(action:ModerationAction.suspend,reason:'spam'),throwsArgumentError);});
 test('permanent ban needs reason but no duration',(){expect(()=>ModerationAction.validate(action:ModerationAction.permanentBan,reason:'abuse'),returnsNormally);});
}
