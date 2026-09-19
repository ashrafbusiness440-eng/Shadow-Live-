abstract final class PkPolicy {
 static const allowedTeamSizes={1,2,3,4};
 static const allowedMinutes={5,10,15,30};
 static const pointsPerCoin=10.0, firstGiftMultiplier=10.5;
 static void validate({required int teamSize,required int minutes}) {
  if(!allowedTeamSizes.contains(teamSize))throw ArgumentError('PK team size must be 1..4');
  if(!allowedMinutes.contains(minutes))throw ArgumentError('unsupported PK duration');
 }
 static double score({required int coins,required bool firstGift})=>coins*(firstGift?firstGiftMultiplier:pointsPerCoin);
}
