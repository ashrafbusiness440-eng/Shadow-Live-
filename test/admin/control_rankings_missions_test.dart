import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_rankings.dart';
import 'package:voice_chat_room/admin/control_missions.dart';
void main(){
 test('ranking xp reference',(){expect(RankingPolicy.popularityXpForReceivedCoins(1000),10);expect(RankingPolicy.wealthXpForSpentCoins(1000),10);});
 test('7 day login total',(){expect(MissionPolicy.fullStreakTotal,2650);expect(MissionPolicy.rewardForLoginDay(7),1000);});
}
