import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_notifications.dart';
import 'package:voice_chat_room/admin/control_account_deletion.dart';
void main(){
 test('critical notifications cannot fully disable',(){expect(NotificationPolicy.canFullyDisable('security'),isFalse);expect(NotificationPolicy.canFullyDisable('finance'),isFalse);expect(NotificationPolicy.canFullyDisable('social'),isTrue);});
 test('pending deletion blocks sensitive ops',(){expect(AccountDeletionPolicy.sensitiveOperationsAllowed(deletionPending:true),isFalse);});
}
