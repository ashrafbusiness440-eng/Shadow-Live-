abstract final class MoneyPolicy {
 static const coinScale=1, diamondScale=100;
 static int diamondsToMinorUnits(num diamonds)=>(diamonds*diamondScale).round();
 static double diamondsFromMinorUnits(int units)=>units/diamondScale;
 static int coins(num value){
  if(value<0||value%1!=0)throw ArgumentError('coins must be a non-negative integer');
  return value.toInt();
 }
}
