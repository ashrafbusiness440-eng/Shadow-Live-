class SystemConfigPolicy {
 const SystemConfigPolicy({required this.coinsPerUsd,required this.diamondUsd,required this.minimumWithdrawalDiamonds,required this.minimumAge,required this.targetGameRtp});
 final int coinsPerUsd,minimumAge; final double diamondUsd,minimumWithdrawalDiamonds,targetGameRtp;
 void validate(){
  if(coinsPerUsd<=0||diamondUsd<=0||minimumWithdrawalDiamonds<=0)throw ArgumentError('financial values must be positive');
  if(minimumAge<18)throw ArgumentError('minimum age cannot be below launch policy');
  if(targetGameRtp<=0||targetGameRtp>=1)throw ArgumentError('RTP must be between 0 and 1');
 }
}
