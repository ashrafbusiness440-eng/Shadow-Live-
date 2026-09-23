import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_security.dart';
import 'package:voice_chat_room/admin/control_reports.dart';
import 'package:voice_chat_room/admin/control_age_policy.dart';
void main(){
 test('unknown control device alerts',(){expect(ControlSecurityPolicy.requiresDeviceAlert(knownDevice:false),isTrue);});
 test('sensitive reauth expires',(){final now=DateTime(2026,9,19,12);expect(ControlSecurityPolicy.recentReauth(now.subtract(const Duration(minutes:9)),now),isTrue);expect(ControlSecurityPolicy.recentReauth(now.subtract(const Duration(minutes:11)),now),isFalse);});
 test('report workflow',(){expect(ReportPolicy.canTransition('new','under_review'),isTrue);expect(ReportPolicy.canTransition('new','actioned'),isFalse);});
 test('18 plus age gate',(){final today=DateTime(2026,9,19);expect(AgePolicy.eligible(DateTime(2008,9,19),today),isTrue);expect(AgePolicy.eligible(DateTime(2008,9,20),today),isFalse);});
}
