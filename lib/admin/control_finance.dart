import 'control_config.dart';

abstract final class ControlFinance {
 static int coinsForUsd(num usd)=> (usd*ControlConfig.coinsPerUsd).round();
 static int coinsForDiamonds(num diamonds)=> (diamonds*ControlConfig.coinsPerUsd).round();

 static Map<String,num> normalGiftSplit({required int coins,required bool agency}) {
  if(coins<=0) throw ArgumentError('coins must be positive');
  return agency
    ? {'recipientDiamonds':coins/ControlConfig.coinsPerUsd*0.70,'agencyDiamonds':coins/ControlConfig.coinsPerUsd*0.20,'platformUsd':coins/ControlConfig.coinsPerUsd*0.10}
    : {'recipientDiamonds':coins/ControlConfig.coinsPerUsd*0.75,'agencyDiamonds':0,'platformUsd':coins/ControlConfig.coinsPerUsd*0.25};
 }
 static Map<String,num> selfGiftSplit({required int coins,required bool agency}) {
  if(coins<=0) throw ArgumentError('coins must be positive');
  return agency
    ? {'recipientDiamonds':coins/ControlConfig.coinsPerUsd*0.65,'agencyDiamonds':coins/ControlConfig.coinsPerUsd*0.20,'platformUsd':coins/ControlConfig.coinsPerUsd*0.15}
    : {'recipientDiamonds':coins/ControlConfig.coinsPerUsd*0.70,'agencyDiamonds':0,'platformUsd':coins/ControlConfig.coinsPerUsd*0.30};
 }
}
