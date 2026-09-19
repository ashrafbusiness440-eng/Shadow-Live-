abstract final class RoomBoxPolicy {
 static const thresholds=[100000,500000,1000000,5000000];
 static int levelForCumulative(int coins){
  if(coins<0)throw ArgumentError('coins cannot be negative');
  var level=0; for(final threshold in thresholds){if(coins>=threshold)level++;} return level;
 }
 static const countdownSeconds=10;
}
