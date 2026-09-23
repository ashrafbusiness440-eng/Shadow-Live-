abstract final class GamePolicy {
 static const targetRtp=0.85;
 static const games={'greedy_cat','witch','slot'};
 static const greedyCatBets={200,2000,20000,200000};
 static const witchNormalBets={100,1000,10000,100000};
 static const witchAdvancedBets={200,2000,20000,200000};
 static const slotBets={200,1000,2000,5000,10000,20000,50000,100000,200000};
 static void validateBet(String game,int bet){
  if(!games.contains(game))throw ArgumentError('unsupported game');
  final ok=game=='greedy_cat'?greedyCatBets.contains(bet):game=='slot'?slotBets.contains(bet):(witchNormalBets.contains(bet)||witchAdvancedBets.contains(bet));
  if(!ok)throw ArgumentError('unsupported bet');
 }
}
