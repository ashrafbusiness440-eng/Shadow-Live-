import 'package:flutter_test/flutter_test.dart';
import 'package:voice_chat_room/admin/control_games.dart';
import 'package:voice_chat_room/admin/control_lucky_gifts.dart';
import 'package:voice_chat_room/admin/control_store.dart';
void main(){
 test('games use approved bet ladders',(){expect(()=>GamePolicy.validateBet('slot',200000),returnsNormally);expect(()=>GamePolicy.validateBet('slot',300),throwsArgumentError);expect(GamePolicy.targetRtp,0.85);});
 test('lucky gifts reference',(){expect(LuckyGiftPolicy.prices.contains(50000),isTrue);expect(LuckyGiftPolicy.targetRtp,0.70);});
 test('store categories and durations',(){expect(StorePolicy.validCategory('frames'),isTrue);expect(StorePolicy.validDuration(7),isTrue);expect(StorePolicy.validDuration(null,permanent:true),isTrue);});
}
