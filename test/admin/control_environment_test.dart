import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_environment.dart';
import 'package:voice_chat_room/admin/control_feature_flags.dart';
import 'package:voice_chat_room/admin/control_dashboard_metrics.dart';
void main(){
 test('demo cannot perform sensitive writes',(){expect(ControlEnvironmentPolicy.allowsSensitiveWrites(ControlEnvironment.demo,trustedBackendReady:true),isFalse);});
 test('production requires trusted backend',(){expect(ControlEnvironmentPolicy.allowsSensitiveWrites(ControlEnvironment.production,trustedBackendReady:false),isFalse);expect(ControlEnvironmentPolicy.allowsSensitiveWrites(ControlEnvironment.production,trustedBackendReady:true),isTrue);});
 test('feature flags default closed',(){expect(ControlFeatureFlags.safeDefault.productionReady,isFalse);});
 test('dashboard rejects negative counts',(){expect(()=>ControlDashboardMetrics.fromCounts(users:-1,activeRooms:0,openReports:0,pendingWithdrawals:0,pendingAgencySettlements:0),throwsArgumentError);});
}
